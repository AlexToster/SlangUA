import { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import type { FastifyInstance } from 'fastify/types/instance';
import { createRateLimiter } from '../plugins/rate-limit.js';
import { translationService } from '../services/translation.service.js';
import { SlangStyle, Translation } from '@prisma/client';
import { SLANG_STYLE_VALUES, PROVIDER_ID_PATTERN } from '../constants/index.js';
import { config } from '../config/index.js';
import { authenticate } from '../plugins/authenticate.js';

/**
 * One mapping for the HTTP reason phrase, shared by all handlers in this file.
 * The three inline ternary chains it replaces each covered a different subset of
 * statuses, so a 404/409/410 from the service was serialized as
 * "Internal Server Error" even though the schema declared those codes.
 */
const HTTP_ERROR_NAMES: Record<number, string> = {
  400: 'Bad Request',
  401: 'Unauthorized',
  403: 'Forbidden',
  404: 'Not Found',
  409: 'Conflict',
  410: 'Gone',
  422: 'Unprocessable Entity',
  429: 'Too Many Requests',
  503: 'Service Unavailable',
};

function httpErrorName(statusCode: number): string {
  return HTTP_ERROR_NAMES[statusCode] ?? 'Internal Server Error';
}

/**
 * The serializer only needs the fields the API exposes, so it is typed
 * structurally: `TranslationService.translate()` returns a projection
 * (no userId/previewId/styleVersion), while `saveFromPreview()` returns a full row.
 */
type SerializableTranslation = Pick<
  Translation,
  'id' | 'originalText' | 'translatedText' | 'slangStyle' | 'providerId' | 'favorite' | 'createdAt'
>;

function serializeTranslation(translation: SerializableTranslation) {
  return {
    id: translation.id,
    originalText: translation.originalText,
    translatedText: translation.translatedText,
    slangStyle: translation.slangStyle,
    providerId: translation.providerId,
    favorite: translation.favorite,
    createdAt: translation.createdAt.toISOString(),
  };
}

/** Shape of a persisted translation, shared by the 200 and 409 responses. */
const translationSchema = z.object({
  id: z.number(),
  originalText: z.string(),
  translatedText: z.string(),
  slangStyle: z.enum(SLANG_STYLE_VALUES),
  // Not an enum: the set of configured AI instances is a deployment concern
  // (see AI_EXTRA_INSTANCES), so the contract constrains the shape of the id,
  // not the list of ids.
  providerId: z.string().regex(PROVIDER_ID_PATTERN),
  favorite: z.boolean(),
  createdAt: z.string().datetime(),
});

export const translateRoutes: FastifyPluginAsyncZod = async (app: FastifyInstance) => {
  // Create separate rate limiters for preview, save, and persistent translate
  const previewRateLimiter = createRateLimiter({
    windowMs: config.PREVIEW_RATE_LIMIT_WINDOW_MS,
    maxRequests: config.PREVIEW_RATE_LIMIT_MAX_REQUESTS,
    keyPrefix: config.PREVIEW_RATE_LIMIT_KEY_PREFIX,
  });

  const saveRateLimiter = createRateLimiter({
    windowMs: config.SAVE_RATE_LIMIT_WINDOW_MS,
    maxRequests: config.SAVE_RATE_LIMIT_MAX_REQUESTS,
    keyPrefix: config.SAVE_RATE_LIMIT_KEY_PREFIX,
  });

  const translateRateLimiter = createRateLimiter({
    windowMs: config.RATE_LIMIT_WINDOW_MS,
    maxRequests: config.RATE_LIMIT_MAX_REQUESTS,
    keyPrefix: 'ratelimit:translate',
  });

  // JWT authentication middleware
  // Request body schema for preview and translate
  // Note: Text validation (1-1000 grapheme clusters, no whitespace-only) is done in service layer
  // using Intl.Segmenter for proper Unicode grapheme cluster counting
  const translateBodySchema = z.object({
    text: z.string(),
    style: z.enum(SLANG_STYLE_VALUES),
  });

  // Request body schema for save (only previewId)
  const saveBodySchema = z.object({
    previewId: z.string().uuid(),
  });

  // Common error responses
  const errorResponses = {
    400: z.object({
      error: z.string(),
      code: z.string(),
      message: z.string(),
    }),
    401: z.object({
      error: z.string(),
      code: z.string(),
      message: z.string(),
    }),
    403: z.object({
      error: z.string(),
      code: z.string(),
      message: z.string(),
    }),
    404: z.object({
      error: z.string(),
      code: z.string(),
      message: z.string(),
    }),
    // A duplicate save is a conflict, but the row the first save produced is
    // still the answer the client wants; the service attaches it to the error.
    409: z.object({
      error: z.string(),
      code: z.string(),
      message: z.string(),
      translation: translationSchema.optional(),
    }),
    410: z.object({
      error: z.string(),
      code: z.string(),
      message: z.string(),
    }),
    422: z.object({
      error: z.string(),
      code: z.string(),
      message: z.string(),
    }),
    429: z.object({
      error: z.string(),
      code: z.string(),
      message: z.string(),
    }),
    503: z.object({
      error: z.string(),
      code: z.string(),
      message: z.string(),
    }),
  };

  // POST /api/v1/translate/preview - Translate text for preview (no persistence)
  // Returns previewId for subsequent save
  app.post('/translate/preview', {
    schema: {
      body: translateBodySchema,
      response: {
        200: z.object({
          originalText: z.string(),
          translatedText: z.string(),
          slangStyle: z.enum(SLANG_STYLE_VALUES),
          providerId: z.string().regex(PROVIDER_ID_PATTERN),
          previewId: z.string().uuid(),
        }),
        ...errorResponses,
      },
    },
    // Apply JWT authentication first, then rate limiting (so rate limiter can key by userId)
    preHandler: [authenticate, previewRateLimiter],
  }, async (request, reply) => {
    const { text, style } = request.body as { text: string; style: SlangStyle };
    const userId = request.user!.id;

    try {
      const result = await translationService.translatePreview(userId, { text, style });
      return reply.send(result);
    } catch (error) {
      const err = error as any;
      const statusCode = err.statusCode || 500;
      const code = err.code || 'INTERNAL_ERROR';
      const message = err.message || 'Translation failed';

      return reply.status(statusCode).send({
        error: httpErrorName(statusCode),
        code,
        message,
      });
    }
  });

  // POST /api/v1/translate/save - Save translation from preview
  // Body: { previewId }
  // - Verifies preview ownership and TTL
  // - Creates Translation with exact text from preview (no LLM call)
  // - Idempotent: duplicate save returns 409 PREVIEW_ALREADY_SAVED
  // - Does NOT accept originalText or translatedText from client
  app.post('/translate/save', {
    schema: {
      body: saveBodySchema,
      response: {
        200: translationSchema,
        ...errorResponses,
      },
    },
    preHandler: [authenticate, saveRateLimiter],
  }, async (request, reply) => {
    const { previewId } = request.body as { previewId: string };
    const userId = request.user!.id;

    try {
      const result = await translationService.saveFromPreview(userId, previewId);
      return reply.send(serializeTranslation(result.translation));
    } catch (error) {
      const err = error as any;
      const statusCode = err.statusCode || 500;
      const code = err.code || 'INTERNAL_ERROR';
      const message = err.message || 'Save failed';

      // A duplicate save is not a lost result: return the row the first save
      // created so the client can render it instead of re-running the preview.
      const existing = err.existingTranslation as Translation | undefined;
      if (statusCode === 409 && existing) {
        return reply.status(409).send({
          error: httpErrorName(409),
          code,
          message,
          translation: serializeTranslation(existing),
        });
      }

      return reply.status(statusCode).send({
        error: httpErrorName(statusCode),
        code,
        message,
      });
    }
  });

  // POST /api/v1/translate - Translate text to selected slang style and persist (direct path)
  app.post('/translate', {
    schema: {
      body: translateBodySchema,
      response: {
        200: translationSchema,
        ...errorResponses,
      },
    },
    // Apply JWT authentication first, then rate limiting (so rate limiter can key by userId)
    preHandler: [authenticate, translateRateLimiter],
  }, async (request, reply) => {
    const { text, style } = request.body as { text: string; style: SlangStyle };
    const userId = request.user!.id;

    try {
      const result = await translationService.translate(userId, { text, style });
      return reply.send(serializeTranslation(result));
    } catch (error) {
      const err = error as any;
      const statusCode = err.statusCode || 500;
      const code = err.code || 'INTERNAL_ERROR';
      const message = err.message || 'Translation failed';

      return reply.status(statusCode).send({
        error: httpErrorName(statusCode),
        code,
        message,
      });
    }
  });
};
