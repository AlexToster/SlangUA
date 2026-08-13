import { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import type { FastifyInstance } from 'fastify/types/instance';
import { historyService } from '../services/history.service.js';
import { authService } from '../services/auth.service.js';
import { createRateLimiter } from '../plugins/rate-limit.js';
import { SLANG_STYLE_VALUES, AI_PROVIDER_VALUES } from '../constants/index.js';
import { config } from '../config/index.js';

export const historyRoutes: FastifyPluginAsyncZod = async (app: FastifyInstance) => {
  // Rate limiters for history endpoints
  const historyRateLimiter = createRateLimiter({
    windowMs: config.RATE_LIMIT_WINDOW_MS,
    maxRequests: config.RATE_LIMIT_MAX_REQUESTS,
    keyPrefix: 'ratelimit:history'
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

  // GET /api/v1/history - Paginated list of user's translations
  app.get('/history', {
    schema: {
      querystring: z.object({
        cursor: z.string().optional(),
        limit: z.coerce.number().int().min(1).max(100).default(20),
        favorite: z.coerce.boolean().optional(),
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
    };
  });

  // PATCH /api/v1/history/:id/favorite - Toggle favorite flag
  app.patch('/history/:id/favorite', {
    schema: {
      params: z.object({
        id: z.coerce.number().int(),
      }),
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

    const result = await historyService.toggleFavorite(userId, id);

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
