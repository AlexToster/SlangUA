import { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import type { FastifyInstance } from 'fastify/types/instance';
import { historyService } from '../services/history.service.js';
import { createRateLimiter } from '../plugins/rate-limit.js';
import { SLANG_STYLE_VALUES, AI_PROVIDER_VALUES, HISTORY_MAX_ENTRIES } from '../constants/index.js';
import { config } from '../config/index.js';
import { authenticate } from '../plugins/authenticate.js';

export const historyRoutes: FastifyPluginAsyncZod = async (app: FastifyInstance) => {
  // Rate limiters for history endpoints
  const historyRateLimiter = createRateLimiter({
    windowMs: config.RATE_LIMIT_WINDOW_MS,
    maxRequests: config.RATE_LIMIT_MAX_REQUESTS,
    keyPrefix: 'ratelimit:history'
  });

  // JWT authentication middleware
  // GET /api/v1/history - Paginated list of user's translations
  app.get('/history', {
    schema: {
      querystring: z.object({
        cursor: z.string().optional(),
        limit: z.coerce.number().int().min(1).max(100).default(20),
        // NOT z.coerce.boolean(): Boolean('false') === true, so `?favorite=false`
        // used to be read as "only favorites". Query values are strings.
        favorite: z.enum(['true', 'false']).transform(v => v === 'true').optional(),
        search: z.string().optional(),
      }),
      response: {
        200: z.object({
          data: z.array(z.object({
            id: z.number(),
            originalText: z.string(),
            translatedText: z.string(),
            slangStyle: z.enum(SLANG_STYLE_VALUES),
            aiProvider: z.enum(AI_PROVIDER_VALUES),
            favorite: z.boolean(),
            createdAt: z.string().datetime(),
          })),
          nextCursor: z.string().nullable(),
          totalCount: z.number().int(),
          // Server-owned history cap, echoed so the UI can render "5/100"
          // without hardcoding the number.
          totalLimit: z.number().int(),
        }),
        401: z.object({
          error: z.string(),
          code: z.string(),
          message: z.string(),
        }),
        400: z.object({
          error: z.string(),
          code: z.string(),
          message: z.string(),
        }),
        503: z.object({
          error: z.string(),
          code: z.string(),
          message: z.string(),
        }),
      },
    },
    preHandler: [authenticate, historyRateLimiter],
  }, async (request, reply) => {
    const userId = request.user!.id;
    const { cursor, limit, favorite, search } = request.query as { cursor?: string; limit?: number; favorite?: boolean; search?: string };

    let result;
    try {
      result = await historyService.getHistory({
        userId,
        cursor,
        limit,
        favorite,
        search,
      });
    } catch (error) {
      const err = error as Error & { code?: string; statusCode?: number };
      if (err.code === 'INVALID_CURSOR') {
        return reply.status(400).send({
          error: 'Bad Request',
          code: 'INVALID_CURSOR',
          message: err.message,
        });
      }
      throw error;
    }

    return {
      data: result.data.map(t => ({
        id: t.id,
        originalText: t.originalText,
        translatedText: t.translatedText,
        slangStyle: t.slangStyle,
        aiProvider: t.aiProvider,
        favorite: t.favorite,
        createdAt: t.createdAt.toISOString(),
      })),
      nextCursor: result.nextCursor,
      totalCount: result.totalCount,
      totalLimit: HISTORY_MAX_ENTRIES,
    };
  });

  // PATCH /api/v1/history/:id/favorite - Set (or toggle, when body is omitted) favorite flag
  app.patch('/history/:id/favorite', {
    schema: {
      params: z.object({
        id: z.coerce.number().int(),
      }),
      // Optional body. `{ "favorite": true|false }` sets the value and is
      // idempotent; an omitted body keeps the legacy toggle behaviour.
      body: z.object({
        favorite: z.boolean(),
      }).optional(),
      response: {
        200: z.object({
          id: z.number(),
          originalText: z.string(),
          translatedText: z.string(),
          slangStyle: z.enum(SLANG_STYLE_VALUES),
          aiProvider: z.enum(AI_PROVIDER_VALUES),
          favorite: z.boolean(),
          createdAt: z.string().datetime(),
        }),
        401: z.object({
          error: z.string(),
          code: z.string(),
          message: z.string(),
        }),
        404: z.object({
          error: z.string(),
          code: z.string(),
          message: z.string(),
        }),
        503: z.object({
          error: z.string(),
          code: z.string(),
          message: z.string(),
        }),
      },
    },
    preHandler: [authenticate, historyRateLimiter],
  }, async (request, reply) => {
    const userId = request.user!.id;
    const { id } = request.params as { id: number };
    const body = request.body as { favorite: boolean } | undefined;

    const result = await historyService.setFavorite(userId, id, body?.favorite);

    if (!result) {
      return reply.status(404).send({
        error: 'Not Found',
        code: 'NOT_FOUND',
        message: 'Translation not found',
      });
    }

    return {
      id: result.id,
      originalText: result.originalText,
      translatedText: result.translatedText,
      slangStyle: result.slangStyle,
      aiProvider: result.aiProvider,
      favorite: result.favorite,
      createdAt: result.createdAt.toISOString(),
    };
  });

  // DELETE /api/v1/history - Remove every translation of the current user.
  // Registered before the parameterised route for readability only; Fastify
  // matches the static path regardless of declaration order.
  app.delete('/history', {
    schema: {
      response: {
        // Deliberately 200 with a body rather than 204: the client reports how
        // many entries were removed, and the operation is idempotent (an empty
        // history yields deletedCount 0, never an error).
        200: z.object({
          deletedCount: z.number().int(),
        }),
        401: z.object({
          error: z.string(),
          code: z.string(),
          message: z.string(),
        }),
        503: z.object({
          error: z.string(),
          code: z.string(),
          message: z.string(),
        }),
      },
    },
    preHandler: [authenticate, historyRateLimiter],
  }, async (request) => {
    const userId = request.user!.id;

    const deletedCount = await historyService.clearHistory(userId);

    return { deletedCount };
  });

  // DELETE /api/v1/history/:id - Delete a translation record
  app.delete('/history/:id', {
    schema: {
      params: z.object({
        id: z.coerce.number().int(),
      }),
      response: {
        204: z.null(),
        401: z.object({
          error: z.string(),
          code: z.string(),
          message: z.string(),
        }),
        404: z.object({
          error: z.string(),
          code: z.string(),
          message: z.string(),
        }),
        503: z.object({
          error: z.string(),
          code: z.string(),
          message: z.string(),
        }),
      },
    },
    preHandler: [authenticate, historyRateLimiter],
  }, async (request, reply) => {
    const userId = request.user!.id;
    const { id } = request.params as { id: number };

    const deleted = await historyService.deleteTranslation(userId, id);

    if (!deleted) {
      return reply.status(404).send({
        error: 'Not Found',
        code: 'NOT_FOUND',
        message: 'Translation not found',
      });
    }

    return reply.status(204).send();
  });
};
