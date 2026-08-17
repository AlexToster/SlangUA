import { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import type { FastifyInstance } from 'fastify/types/instance';
import { createRateLimiter } from '../plugins/rate-limit.js';
import { loadRegistry, type RegistryEntry } from '../style-engine/loader.js';
import { userService } from '../services/user.service.js';
import { SLANG_STYLE_VALUES } from '../constants/index.js';
import { authenticate } from '../plugins/authenticate.js';

export const stylesRoutes: FastifyPluginAsyncZod = async (app: FastifyInstance) => {
  // Rate limiter for styles endpoint (30 requests/minute)
  const stylesRateLimiter = createRateLimiter({ windowMs: 60000, maxRequests: 30, keyPrefix: 'ratelimit:styles' });

  // JWT authentication middleware
    // GET /api/v1/styles - Get available styles for the authenticated user
  app.get('/styles', {
    schema: {
      response: {
        200: z.array(z.object({
          id: z.enum(SLANG_STYLE_VALUES),
          title: z.string(),
          ageRestricted: z.boolean(),
        })),
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
    preHandler: [authenticate, stylesRateLimiter],
  }, async (request, reply) => {
    const userId = request.user!.id;

    // Get user profile to check ageConfirmedAdult
    const profile = await userService.getProfile(userId);

    if (!profile) {
      return reply.status(404).send({
        error: 'Not Found',
        code: 'USER_NOT_FOUND',
        message: 'User not found',
      });
    }

    // Load all styles from registry
    const registry: Record<string, RegistryEntry> = await loadRegistry();

    // Return all enabled styles with ageRestricted flag; frontend handles locking
    const allStyles = Object.values(registry)
      .filter((entry) => entry.enabled)
      .map((entry) => ({
        id: entry.id.toUpperCase(),
        title: entry.title,
        ageRestricted: entry.ageRestricted,
      }));

    return allStyles;
  });
};
