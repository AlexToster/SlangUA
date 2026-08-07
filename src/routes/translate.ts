import { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import type { FastifyInstance } from 'fastify/types/instance';
import { createRateLimiter } from '../plugins/rate-limit.js';
import { authService } from '../services/auth.service.js';
import { translationService } from '../services/translation.service.js';
import { SlangStyle } from '@prisma/client';
import { SLANG_STYLE_VALUES } from '../constants/index.js';

export const translateRoutes: FastifyPluginAsyncZod = async (app: FastifyInstance) => {
  // Create rate limiter for translate endpoint
  const translateRateLimiter = createRateLimiter({ windowMs: 60000, maxRequests: 30, keyPrefix: 'ratelimit:translate' });

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

  // POST /api/v1/translate - Translate text to selected slang style
  app.post('/translate', {
    schema: {
      body: z.object({
        text: z.string().min(1).max(5000),
        style: z.enum(SLANG_STYLE_VALUES),
      }),
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