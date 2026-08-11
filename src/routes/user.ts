import { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import type { FastifyInstance } from 'fastify/types/instance';
import { authService } from '../services/auth.service.js';
import { userService } from '../services/user.service.js';
import { createRateLimiter } from '../plugins/rate-limit.js';
import { SLANG_STYLE_VALUES } from '../constants/index.js';

export const userRoutes: FastifyPluginAsyncZod = async (app: FastifyInstance) => {
  // Rate limiters for user endpoints (30 requests/minute)
  const userRateLimiter = createRateLimiter({ windowMs: 60000, maxRequests: 30, keyPrefix: 'ratelimit:user' });

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

  // GET /api/v1/user/me - Current user's profile
  app.get('/user/me', {
    schema: {
      response: {
        200: z.object({
          telegramId: z.string(),
          username: z.string().nullable(),
          firstName: z.string().nullable(),
          lastName: z.string().nullable(),
          languageCode: z.string().nullable(),
          defaultSlangStyle: z.enum(SLANG_STYLE_VALUES).nullable(),
          notificationsEnabled: z.boolean(),
          ageConfirmedAdult: z.boolean(),
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
    preHandler: [authenticate, userRateLimiter],
  }, async (request, reply) => {
    const userId = request.user!.id;

    const profile = await userService.getProfile(userId);

    if (!profile) {
      return reply.status(404).send({
        error: 'Not Found',
        code: 'USER_NOT_FOUND',
        message: 'User not found',
      });
    }

    return {
      telegramId: profile.telegramId,
      username: profile.username,
      firstName: profile.firstName,
      lastName: profile.lastName,
      languageCode: profile.languageCode,
      defaultSlangStyle: profile.defaultSlangStyle,
      notificationsEnabled: profile.notificationsEnabled,
      ageConfirmedAdult: profile.ageConfirmedAdult,
      createdAt: profile.createdAt.toISOString(),
    };
  });

  // PATCH /api/v1/user/me - Update application-level preferences
  app.patch('/user/me', {
    schema: {
      body: z.object({
        defaultSlangStyle: z.enum(SLANG_STYLE_VALUES).nullable().optional(),
        notificationsEnabled: z.boolean().optional(),
        ageConfirmedAdult: z.boolean().optional(),
      }).strict(),
      response: {
        200: z.object({
          telegramId: z.string(),
          username: z.string().nullable(),
          firstName: z.string().nullable(),
          lastName: z.string().nullable(),
          languageCode: z.string().nullable(),
          defaultSlangStyle: z.enum(SLANG_STYLE_VALUES).nullable(),
          notificationsEnabled: z.boolean(),
          ageConfirmedAdult: z.boolean(),
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
    preHandler: [authenticate, userRateLimiter],
  }, async (request, reply) => {
    const userId = request.user!.id;
    const body = request.body as { defaultSlangStyle?: (typeof SLANG_STYLE_VALUES)[number] | null; notificationsEnabled?: boolean; ageConfirmedAdult?: boolean };

    try {
      const updatedProfile = await userService.updatePreferences(userId, body);

      return {
        telegramId: updatedProfile.telegramId,
        username: updatedProfile.username,
        firstName: updatedProfile.firstName,
        lastName: updatedProfile.lastName,
        languageCode: updatedProfile.languageCode,
        defaultSlangStyle: updatedProfile.defaultSlangStyle,
        notificationsEnabled: updatedProfile.notificationsEnabled,
        ageConfirmedAdult: updatedProfile.ageConfirmedAdult,
        createdAt: updatedProfile.createdAt.toISOString(),
      };
    } catch (error) {
      const err = error as Error & { code?: string; statusCode?: number };
      
      if (err.code === 'IMMUTABLE_FIELD') {
        return reply.status(400).send({
          error: 'Bad Request',
          code: 'IMMUTABLE_FIELD',
          message: err.message,
        });
      }

      if (err.code === 'USER_NOT_FOUND') {
        return reply.status(404).send({
          error: 'Not Found',
          code: 'USER_NOT_FOUND',
          message: err.message,
        });
      }

      throw error;
    }
  });
};
