import { FastifyPluginAsync } from 'fastify/types/plugin';
import { FastifyRequest } from 'fastify/types/request';
import { FastifyReply } from 'fastify/types/reply';
import { FastifyInstance } from 'fastify/types/instance';
import { getRedisClient } from '../lib/redis.js';
import { config } from '../config/index.js';

export interface RateLimitOptions {
  windowMs?: number;
  maxRequests?: number;
  keyPrefix?: string;
}

const DEFAULT_WINDOW_MS = config.RATE_LIMIT_WINDOW_MS;
const DEFAULT_MAX_REQUESTS = config.RATE_LIMIT_MAX_REQUESTS;
const DEFAULT_KEY_PREFIX = 'ratelimit';

export interface RateLimitError extends Error {
  code: string;
  statusCode: number;
  retryAfter: number;
}

/**
 * Sliding window rate limiter using Redis sorted sets.
 * Keys are based on userId (if authenticated) or IP address.
 */
export function createRateLimiter(options: RateLimitOptions = {}) {
  const windowMs = options.windowMs ?? DEFAULT_WINDOW_MS;
  const maxRequests = options.maxRequests ?? DEFAULT_MAX_REQUESTS;
  const keyPrefix = options.keyPrefix ?? DEFAULT_KEY_PREFIX;

  return async function rateLimitHook(request: FastifyRequest, reply: FastifyReply) {
    const redis = getRedisClient();
    const now = Date.now();
    const windowStart = now - windowMs;

    // Determine rate limit key: userId if authenticated, otherwise IP
    let identifier: string;
    const req = request as FastifyRequest & {
      user?: { id: string | number };
      ip?: string;
      log?: { warn: (meta: unknown, msg: string) => void };
    };
    const user = req.user;
    if (user?.id != null) {
      identifier = `user:${user.id}`;
    } else {
      const ip = req.ip || 'unknown';
      identifier = `ip:${ip}`;
    }

    const key = `${keyPrefix}:${identifier}`;

    try {
      // Use a Redis transaction for atomicity
      const multi = redis.multi();

      // Remove expired entries (older than windowStart)
      multi.zremrangebyscore(key, 0, windowStart);

      // Count current requests in window
      multi.zcard(key);

      // Add current request with timestamp as score
      multi.zadd(key, now, `${now}:${Math.random()}`);

      // Set expiry on the key to auto-cleanup
      multi.pexpire(key, windowMs);

      const results = await multi.exec();

      if (!results) {
        throw new Error('Redis transaction failed');
      }

      // results[1] is the zcard count (before adding current request)
      const currentCount = (results[1] as [Error | null, number])[1] ?? 0;

      // Check if limit exceeded
      if (currentCount >= maxRequests) {
        // Get the oldest entry to calculate retry-after
        const oldest = await redis.zrange(key, 0, 0, 'WITHSCORES');
        let retryAfterMs = windowMs;
        if (oldest.length >= 2) {
          const oldestTimestamp = parseInt(oldest[1], 10);
          retryAfterMs = Math.max(0, oldestTimestamp + windowMs - now);
        }

        const error = new Error('Rate limit exceeded') as RateLimitError;
        error.code = 'RATE_LIMIT_EXCEEDED';
        error.statusCode = 429;
        error.retryAfter = Math.ceil(retryAfterMs / 1000);
        throw error;
      }

      // Set rate limit headers
      const remaining = Math.max(0, maxRequests - currentCount - 1);
      reply.header('X-RateLimit-Limit', maxRequests.toString());
      reply.header('X-RateLimit-Remaining', remaining.toString());
      reply.header('X-RateLimit-Reset', Math.ceil((now + windowMs) / 1000).toString());
    } catch (err) {
      // If Redis is unavailable, we fail open (allow request) but log the error
      if (err instanceof Error && 'code' in err && (err as RateLimitError).code === 'RATE_LIMIT_EXCEEDED') {
        const rateLimitErr = err as RateLimitError;
        reply.header('Retry-After', rateLimitErr.retryAfter.toString());
        throw err;
      }
      req.log?.warn({ err }, 'Rate limiter error, failing open');
    }
  };
}

/**
 * Fastify plugin to register rate limiting globally or per-route.
 * Usage:
 *   await app.register(rateLimitPlugin, { windowMs: 60000, maxRequests: 100 })
 *   // Then apply to specific routes:
 *   app.post('/route', { preHandler: app.rateLimit() }, handler)
 */
export const rateLimitPlugin: FastifyPluginAsync<RateLimitOptions> = async (app: FastifyInstance, options: RateLimitOptions) => {
  const limiter = createRateLimiter(options);

  // Decorate app with rateLimit function for per-route usage
  app.decorate('rateLimit', (routeOptions?: RateLimitOptions) => {
    const routeLimiter = createRateLimiter({ ...options, ...routeOptions });
    return routeLimiter;
  });

  // Also expose the default limiter
  app.decorate('defaultRateLimit', limiter);
};
