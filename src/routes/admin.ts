/**
 * Admin API (stages A-D: access, the operator kill-switch, and the two
 * observability views).
 *
 * Every route here is invisible to anyone who is not on the ADMIN_TELEGRAM_IDS
 * allowlist - see src/plugins/require-admin.ts for why that is a 404 and not a
 * 403. Stage A built the door and one read-only view; stage B added the first
 * capability that changes runtime behaviour: switching an AI provider off.
 * Stages C and D add usage metrics and the error feed, both read-only and both
 * served from Redis counters written by the onResponse hook in
 * src/plugins/observability.ts.
 */

import { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import type { FastifyInstance } from 'fastify/types/instance';
import { createRateLimiter } from '../plugins/rate-limit.js';
import { requireAdmin, requireAdminSession } from '../plugins/require-admin.js';
import { adminAuthService } from '../services/admin/admin-auth.service.js';
import { metricsService } from '../services/admin/metrics.service.js';
import { errorFeedService } from '../services/admin/error-feed.service.js';
import { userService } from '../services/user.service.js';
import { aiService } from '../services/ai/ai.service.js';
import {
  providerSwitchService,
  PROVIDER_DISABLE_REASON_MAX,
} from '../services/ai/provider-switch.service.js';
import { PROVIDER_ID_PATTERN } from '../constants/index.js';
import { config } from '../config/index.js';

/** Shared error body, identical to the rest of the API. */
const errorBody = z.object({
  error: z.string(),
  code: z.string(),
  message: z.string(),
});

/** One provider row, health merged with operator intent. */
const providerEntry = z.object({
  id: z.string(),
  available: z.boolean(),
  configured: z.boolean(),
  priority: z.number(),
  disabled: z.boolean(),
  disabledAt: z.string().nullable(),
  disabledBy: z.string().nullable(),
  disabledReason: z.string().nullable(),
});

/**
 * Fastify's own not-found body. Declared as a response schema so the serializer
 * does not reshape it - the whole point is that it matches an unregistered route
 * exactly.
 */
const notFoundBody = z.object({
  message: z.string(),
  error: z.string(),
  statusCode: z.number(),
});

/** One minute of traffic. Zero-filled: an idle minute is data, not a gap. */
const metricsMinuteBucket = z.object({
  startedAt: z.string(),
  requests: z.number(),
  errors: z.number(),
});

/** One hour of traffic inside the rolling window. Zero-filled like the minutes. */
const metricsHourBucket = z.object({
  startedAt: z.string(),
  requests: z.number(),
  errors: z.number(),
});

/** One UTC day. `averagePerUser` is 0 when nobody authenticated that day. */
const metricsDayBucket = z.object({
  date: z.string(),
  requests: z.number(),
  errors: z.number(),
  users: z.number(),
  averagePerUser: z.number(),
});

/**
 * The internal user id only, and as a string: the panel needs to tell heavy
 * users apart, not to identify them, so no Telegram id and no username ever
 * reaches this row.
 */
const metricsTopUser = z.object({
  userId: z.string(),
  requests: z.number(),
});

/**
 * One failure. Everything here is either a status code, a route pattern or a
 * technical message - never a request body, a header or translated text.
 */
const errorFeedEntry = z.object({
  at: z.string(),
  method: z.string(),
  route: z.string(),
  statusCode: z.number(),
  code: z.string().nullable(),
  message: z.string().nullable(),
  userId: z.number().nullable(),
  requestId: z.string().nullable(),
});

export const adminRoutes: FastifyPluginAsyncZod = async (app: FastifyInstance) => {
  // Password attempts get their own budget: the global 100/min is no obstacle to
  // guessing. Both limiters run after the allowlist gate, so they are keyed by
  // the admin's own user id and a stranger can never consume them.
  const loginRateLimiter = createRateLimiter({
    windowMs: config.ADMIN_LOGIN_RATE_LIMIT_WINDOW_MS,
    maxRequests: config.ADMIN_LOGIN_RATE_LIMIT_MAX,
    keyPrefix: 'ratelimit:admin-login',
  });
  const adminRateLimiter = createRateLimiter({
    windowMs: config.ADMIN_RATE_LIMIT_WINDOW_MS,
    maxRequests: config.ADMIN_RATE_LIMIT_MAX_REQUESTS,
    keyPrefix: 'ratelimit:admin',
  });

  // POST /api/v1/admin/session - exchange the admin password for a session token
  app.post('/admin/session', {
    schema: {
      body: z.object({
        // Upper bound only to keep an absurd payload out of the KDF; the real
        // policy (minimum length) lives in the hash generator.
        password: z.string().min(1).max(512),
      }),
      response: {
        200: z.object({
          token: z.string(),
          expiresAt: z.string(),
          absoluteExpiresAt: z.string(),
        }),
        401: errorBody,
        404: notFoundBody,
        429: errorBody,
        503: errorBody,
      },
    },
    // The gate is an onRequest hook so that the 404 for non-admins is decided
    // before the body is parsed or validated - otherwise an invalid password
    // field would produce a 400 that confirms the route exists.
    onRequest: requireAdmin,
    preHandler: loginRateLimiter,
  }, async (request, reply) => {
    const { password } = request.body as { password: string };
    const user = request.user!;

    const result = await adminAuthService.login(user.id, user.telegramId, password);

    if (!result.ok) {
      // One answer for both a wrong password and a lockout: telling them apart
      // would confirm that the earlier guesses were being counted, and the
      // Retry-After header already carries everything a client needs.
      if (result.reason === 'locked_out') {
        reply.header('Retry-After', Math.ceil(result.retryAfterMs / 1000).toString());
      }
      return reply.status(401).send({
        error: 'Unauthorized',
        code: 'ADMIN_PASSWORD_INVALID',
        message: 'Incorrect password',
      });
    }

    return reply.send({
      token: result.session.token,
      expiresAt: new Date(result.session.expiresAt).toISOString(),
      absoluteExpiresAt: new Date(result.session.absoluteExpiresAt).toISOString(),
    });
  });

  // DELETE /api/v1/admin/session - close the admin session (leaves the Telegram
  // login untouched, so this is "lock the panel", not "log out")
  app.delete('/admin/session', {
    schema: {
      response: {
        204: z.null(),
        401: errorBody,
        404: notFoundBody,
        429: errorBody,
        503: errorBody,
      },
    },
    onRequest: requireAdminSession,
    preHandler: adminRateLimiter,
  }, async (request, reply) => {
    await adminAuthService.revokeSession(request.adminSession!.token);
    return reply.status(204).send();
  });

  // GET /api/v1/admin/overview - AI provider chain: health plus operator intent
  app.get('/admin/overview', {
    schema: {
      response: {
        200: z.object({
          admin: z.object({
            telegramId: z.string(),
            sessionExpiresAt: z.string(),
            sessionAbsoluteExpiresAt: z.string(),
          }),
          providers: z.array(providerEntry),
          generatedAt: z.string(),
        }),
        401: errorBody,
        404: notFoundBody,
        429: errorBody,
        503: errorBody,
      },
    },
    onRequest: requireAdminSession,
    preHandler: adminRateLimiter,
  }, async (request, reply) => {
    const session = request.adminSession!;

    return reply.send({
      admin: {
        telegramId: request.user!.telegramId,
        sessionExpiresAt: new Date(session.expiresAt).toISOString(),
        sessionAbsoluteExpiresAt: new Date(session.absoluteExpiresAt).toISOString(),
      },
      providers: await aiService.getProviderOverview(),
      generatedAt: new Date().toISOString(),
    });
  });

  // PATCH /api/v1/admin/providers/:providerId - the operator kill-switch
  app.patch('/admin/providers/:providerId', {
    schema: {
      params: z.object({
        // Shape only. Whether this id means anything in this deployment is
        // answered against the live provider list below.
        providerId: z.string().regex(PROVIDER_ID_PATTERN),
      }),
      body: z.object({
        disabled: z.boolean(),
        // Optional: during an incident, typing a justification is friction. When
        // given it is stored with the switch, because a switch nobody can explain
        // months later tends to be flipped back by guesswork.
        reason: z.string().max(PROVIDER_DISABLE_REASON_MAX).nullish(),
      }),
      response: {
        200: z.object({
          providers: z.array(providerEntry),
          generatedAt: z.string(),
        }),
        400: errorBody,
        401: errorBody,
        404: notFoundBody,
        429: errorBody,
        503: errorBody,
      },
    },
    onRequest: requireAdminSession,
    preHandler: adminRateLimiter,
  }, async (request, reply) => {
    const { providerId } = request.params as { providerId: string };
    const { disabled, reason } = request.body as { disabled: boolean; reason?: string | null };
    const telegramId = request.user!.telegramId;

    // An id this deployment has never heard of is a 400, not a 404. On these
    // routes a 404 means "there is no admin panel for you", and the client is
    // built to answer one by asking for the password again - so reusing it for a
    // typo would send the operator through a pointless step-up and hide the real
    // mistake. Currently switched-off ids count as known even if the instance was
    // meanwhile unconfigured, otherwise a stale switch could never be cleared.
    const known = await aiService.getProviderOverview();
    if (!known.some((entry) => entry.id === providerId)) {
      return reply.status(400).send({
        error: 'Bad Request',
        code: 'ADMIN_PROVIDER_UNKNOWN',
        message: `Unknown provider instance: ${providerId}`,
      });
    }

    if (disabled) {
      await providerSwitchService.disable(providerId, telegramId, reason ?? null);
    } else {
      await providerSwitchService.enable(providerId, telegramId);
    }

    // The whole list, not just the row that changed: switching one provider off
    // changes what the rest of the chain means, and the panel must not have to
    // infer that.
    const providers = await aiService.getProviderOverview();
    const usable = providers.filter((entry) => entry.available && !entry.disabled);
    if (usable.length === 0) {
      request.log.error(
        { by: telegramId, providerId, disabled },
        'No usable AI provider is left after an operator switch; translation will answer 503',
      );
    }

    return reply.send({
      providers,
      generatedAt: new Date().toISOString(),
    });
  });

  // GET /api/v1/admin/metrics - request volume, the rolling day, and today's
  // heaviest users
  app.get('/admin/metrics', {
    schema: {
      response: {
        200: z.object({
          generatedAt: z.string(),
          retentionDays: z.number(),
          /** Accounts that have ever existed - from Postgres, not from Redis. */
          totalUsers: z.number(),
          perMinute: z.object({
            minutes: z.number(),
            series: z.array(metricsMinuteBucket),
          }),
          last24h: z.object({
            hours: z.number(),
            requests: z.number(),
            errors: z.number(),
            users: z.number(),
            series: z.array(metricsHourBucket),
          }),
          daily: z.array(metricsDayBucket),
          topUsers: z.array(metricsTopUser),
        }),
        401: errorBody,
        404: notFoundBody,
        429: errorBody,
        503: errorBody,
      },
    },
    onRequest: requireAdminSession,
    preHandler: adminRateLimiter,
  }, async (_request, reply) => {
    // The service reads Redis and lets a failure propagate: a page of zeros
    // would read as "no traffic" rather than "no data". In practice a Redis
    // outage is answered by the admin rate limiter with 503 before this handler
    // is ever reached.
    //
    // The account total is the one figure here that does not come from Redis, so
    // it is fetched beside the snapshot rather than inside it - the metrics
    // service stays a Redis reader.
    const [snapshot, totalUsers] = await Promise.all([
      metricsService.snapshot(),
      userService.countAll(),
    ]);

    return reply.send({ ...snapshot, totalUsers });
  });

  // GET /api/v1/admin/errors - the last few 5xx responses, newest first
  app.get('/admin/errors', {
    schema: {
      querystring: z.object({
        // Clamped to ADMIN_ERROR_FEED_MAX rather than rejected above it: the
        // client cannot know a deployment's cap, and asking for more than exists
        // is not a client error.
        limit: z.coerce.number().int().min(1).optional(),
      }),
      response: {
        200: z.object({
          generatedAt: z.string(),
          max: z.number(),
          retentionSeconds: z.number(),
          entries: z.array(errorFeedEntry),
        }),
        400: errorBody,
        401: errorBody,
        404: notFoundBody,
        429: errorBody,
        503: errorBody,
      },
    },
    onRequest: requireAdminSession,
    preHandler: adminRateLimiter,
  }, async (request, reply) => {
    const { limit } = request.query as { limit?: number };

    return reply.send({
      generatedAt: new Date().toISOString(),
      // Echoed so the panel can say "the last 100 failures, kept for 7 days"
      // without hardcoding this deployment's configuration.
      max: config.ADMIN_ERROR_FEED_MAX,
      retentionSeconds: config.ADMIN_ERROR_FEED_TTL_SECONDS,
      entries: await errorFeedService.list(limit),
    });
  });
};
