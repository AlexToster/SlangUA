import { FastifyPluginAsync } from 'fastify/types/plugin';
import { FastifyRequest } from 'fastify/types/request';
import { FastifyReply } from 'fastify/types/reply';
export interface RateLimitOptions {
    windowMs?: number;
    maxRequests?: number;
    keyPrefix?: string;
}
export interface RateLimitError extends Error {
    code: string;
    statusCode: number;
    retryAfter: number;
}
/**
 * Sliding window rate limiter using Redis sorted sets.
 * Keys are based on userId (if authenticated) or IP address.
 */
export declare function createRateLimiter(options?: RateLimitOptions): (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
/**
 * Fastify plugin to register rate limiting globally or per-route.
 * Usage:
 *   await app.register(rateLimitPlugin, { windowMs: 60000, maxRequests: 100 })
 *   // Then apply to specific routes:
 *   app.post('/route', { preHandler: app.rateLimit() }, handler)
 */
export declare const rateLimitPlugin: FastifyPluginAsync<RateLimitOptions>;
//# sourceMappingURL=rate-limit.d.ts.map