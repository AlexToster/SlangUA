import { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import type { FastifyInstance } from 'fastify/types/instance';
import { userService } from '../services/user.service.js';
import { createRateLimiter } from '../plugins/rate-limit.js';
import { SLANG_STYLE_VALUES } from '../constants/index.js';
import { authenticate } from '../plugins/authenticate.js';
import { adminAuthService } from '../services/admin/admin-auth.service.js';
import { sttService } from '../services/stt/stt.service.js';

export const userRoutes: FastifyPluginAsyncZod = async (app: FastifyInstance) => {
  // Rate limiters for user endpoints (30 requests/minute)
  const userRateLimiter = createRateLimiter({ windowMs: 60000, maxRequests: 30, keyPrefix: 'ratelimit:user' });

  // JWT authentication middleware
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
          ageConfirmedAdult: z.boolean(),
          // Derived from deployment config, never stored on the user row: it
          // tells the client whether to show the admin entry point. False for
          // everyone on a deployment without ADMIN_TELEGRAM_IDS.
          isAdmin: z.boolean(),
          // Also deployment-derived: true only when STT_API_KEY is configured.
          // The client hides the microphone button when false, so a deployment
          // without voice input never offers a control that would 503.
          voiceInputAvailable: z.boolean(),
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
      ageConfirmedAdult: profile.ageConfirmedAdult,
      isAdmin: adminAuthService.hasAdminAccess(profile.telegramId),
      voiceInputAvailable: sttService.isAvailable(),
      createdAt: profile.createdAt.toISOString(),
    };
  });

  // PATCH /api/v1/user/me - Update application-level preferences
  app.patch('/user/me', {
    schema: {
      body: z.object({
        defaultSlangStyle: z.enum(SLANG_STYLE_VALUES).nullable().optional(),
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
          ageConfirmedAdult: z.boolean(),
          // Same field as in GET: the client replaces its cached profile with
          // this response, so omitting it here would hide the admin button
          // until the next full reload.
          isAdmin: z.boolean(),
          // Same field as in GET: the client replaces its cached profile with
          // this response, so omitting it would hide the microphone until the
          // next full reload.
          voiceInputAvailable: z.boolean(),
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
    const body = request.body as { defaultSlangStyle?: (typeof SLANG_STYLE_VALUES)[number] | null; ageConfirmedAdult?: boolean };

    try {
      const updatedProfile = await userService.updatePreferences(userId, body);

      return {
        telegramId: updatedProfile.telegramId,
        username: updatedProfile.username,
        firstName: updatedProfile.firstName,
        lastName: updatedProfile.lastName,
        languageCode: updatedProfile.languageCode,
        defaultSlangStyle: updatedProfile.defaultSlangStyle,
        ageConfirmedAdult: updatedProfile.ageConfirmedAdult,
        isAdmin: adminAuthService.hasAdminAccess(updatedProfile.telegramId),
        voiceInputAvailable: sttService.isAvailable(),
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
