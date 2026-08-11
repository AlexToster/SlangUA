import { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import type { FastifyInstance } from 'fastify/types/instance';
import { createRateLimiter } from '../plugins/rate-limit.js';
import { authService } from '../services/auth.service.js';
import { translationService } from '../services/translation.service.js';
import { SlangStyle } from '@prisma/client';
import { SLANG_STYLE_VALUES } from '../constants/index.js';
import { config } from '../config/index.js';

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
  const authenticate = async (request: any, reply: any) => {
    const authHeader = request.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return reply.status(401).send({
        error: 'Unauthorized',
        code: 'MISSING_TOKEN',
        message: 'Authorization header with Bearer token required',
      });
    }

    const accessToken = authHeader.substring(7);
    const payload = await authService.verifyAccessToken(accessToken);
    
    if (!payload) {
      return reply.status(401).send({
        error: 'Unauthorized',
        code: 'INVALID_TOKEN',
        message: 'Invalid or expired access token',
      });
    }

    // Attach user to request
    request.user = {
      id: payload.userId,
      telegramId: payload.telegramId,
    };
  };

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
    409: z.object({
      error: z.string(),
      code: z.string(),
      message: z.string(),
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
          aiProvider: z.enum(['OPENAI', 'ANTHROPIC', 'GEMINI', 'OLLAMA']),
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
        error: statusCode === 400 ? 'Bad Request' :
               statusCode === 401 ? 'Unauthorized' :
               statusCode === 403 ? 'Forbidden' :
               statusCode === 422 ? 'Unprocessable Entity' :
               statusCode === 429 ? 'Too Many Requests' :
               statusCode === 503 ? 'Service Unavailable' : 'Internal Server Error',
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
        200: z.object({
          id: z.number(),
          originalText: z.string(),
          translatedText: z.string(),
          slangStyle: z.enum(SLANG_STYLE_VALUES),
          aiProvider: z.enum(['OPENAI', 'ANTHROPIC', 'GEMINI', 'OLLAMA']),
          favorite: z.boolean(),
          createdAt: z.string().datetime(),
        }),
        ...errorResponses,
      },
    },
    preHandler: [authenticate, saveRateLimiter],
  }, async (request, reply) => {
    const { previewId } = request.body as { previewId: string };
    const userId = request.user!.id;

    try {
      const result = await translationService.saveFromPreview(userId, previewId);
      return reply.send({
        ...result.translation,
        createdAt: result.translation.createdAt.toISOString(),
      });
    } catch (error) {
      const err = error as any;
      const statusCode = err.statusCode || 500;
      const code = err.code || 'INTERNAL_ERROR';
      const message = err.message || 'Save failed';

      return reply.status(statusCode).send({
        error: statusCode === 400 ? 'Bad Request' :
               statusCode === 401 ? 'Unauthorized' :
               statusCode === 403 ? 'Forbidden' :
               statusCode === 404 ? 'Not Found' :
               statusCode === 409 ? 'Conflict' :
               statusCode === 410 ? 'Gone' :
               statusCode === 422 ? 'Unprocessable Entity' :
               statusCode === 429 ? 'Too Many Requests' :
               statusCode === 503 ? 'Service Unavailable' : 'Internal Server Error',
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
        200: z.object({
          id: z.number(),
          originalText: z.string(),
          translatedText: z.string(),
          slangStyle: z.enum(SLANG_STYLE_VALUES),
          aiProvider: z.enum(['OPENAI', 'ANTHROPIC', 'GEMINI', 'OLLAMA']),
          favorite: z.boolean(),
          createdAt: z.string().datetime(),
        }),
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
      return reply.send({
        ...result,
        createdAt: result.createdAt.toISOString(),
      });
    } catch (error) {
      const err = error as any;
      const statusCode = err.statusCode || 500;
      const code = err.code || 'INTERNAL_ERROR';
      const message = err.message || 'Translation failed';

      return reply.status(statusCode).send({
        error: statusCode === 400 ? 'Bad Request' :
               statusCode === 401 ? 'Unauthorized' :
               statusCode === 422 ? 'Unprocessable Entity' :
               statusCode === 429 ? 'Too Many Requests' :
               statusCode === 503 ? 'Service Unavailable' : 'Internal Server Error',
        code,
        message,
      });
    }
  });
};
