"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.authRoutes = void 0;
const zod_1 = require("zod");
const rate_limit_js_1 = require("../plugins/rate-limit.js");
const auth_service_js_1 = require("../services/auth.service.js");
const authRoutes = async (app) => {
    // Create rate limiter for auth endpoint
    const authRateLimiter = (0, rate_limit_js_1.createRateLimiter)({ windowMs: 60000, maxRequests: 10, keyPrefix: 'ratelimit:auth' });
    // POST /api/v1/auth/telegram - Exchange Telegram initData for JWT tokens
    app.post('/auth/telegram', {
        schema: {
            body: zod_1.z.object({
                initData: zod_1.z.string(),
            }),
            response: {
                200: zod_1.z.object({
                    accessToken: zod_1.z.string(),
                    refreshToken: zod_1.z.string(),
                }),
                400: zod_1.z.object({
                    error: zod_1.z.string(),
                    code: zod_1.z.string(),
                    message: zod_1.z.string(),
                }),
                401: zod_1.z.object({
                    error: zod_1.z.string(),
                    code: zod_1.z.string(),
                    message: zod_1.z.string(),
                }),
                429: zod_1.z.object({
                    error: zod_1.z.string(),
                    code: zod_1.z.string(),
                    message: zod_1.z.string(),
                }),
            },
        },
        // Apply rate limiting: stricter limit for auth endpoint
        preHandler: authRateLimiter,
    }, async (request, reply) => {
        const { initData } = request.body;
        try {
            const tokens = await auth_service_js_1.authService.authenticateWithTelegram(initData);
            return reply.send(tokens);
        }
        catch (error) {
            const message = error instanceof Error ? error.message : 'Telegram authentication failed';
            if (message === 'Expired auth_date') {
                return reply.status(401).send({
                    error: 'Unauthorized',
                    code: 'AUTH_DATE_EXPIRED',
                    message: 'Authentication data has expired',
                });
            }
            if (message === 'Invalid HMAC signature') {
                return reply.status(401).send({
                    error: 'Unauthorized',
                    code: 'INVALID_HMAC',
                    message: 'Invalid Telegram data signature',
                });
            }
            if (message === 'No user data in initData' || message === 'Invalid initData format') {
                return reply.status(400).send({
                    error: 'Bad Request',
                    code: 'INVALID_INIT_DATA',
                    message: 'Invalid or missing Telegram initData',
                });
            }
            return reply.status(401).send({
                error: 'Unauthorized',
                code: 'TELEGRAM_AUTH_FAILED',
                message,
            });
        }
    });
    // POST /api/v1/auth/refresh - Rotate refresh token, issue new JWT access token
    app.post('/auth/refresh', {
        schema: {
            body: zod_1.z.object({
                refreshToken: zod_1.z.string(),
            }),
            response: {
                200: zod_1.z.object({
                    accessToken: zod_1.z.string(),
                    refreshToken: zod_1.z.string(),
                }),
                400: zod_1.z.object({
                    error: zod_1.z.string(),
                    code: zod_1.z.string(),
                    message: zod_1.z.string(),
                }),
                401: zod_1.z.object({
                    error: zod_1.z.string(),
                    code: zod_1.z.string(),
                    message: zod_1.z.string(),
                }),
                429: zod_1.z.object({
                    error: zod_1.z.string(),
                    code: zod_1.z.string(),
                    message: zod_1.z.string(),
                }),
            },
        },
    }, async (request, reply) => {
        const { refreshToken } = request.body;
        if (!refreshToken) {
            return reply.status(400).send({
                error: 'Bad Request',
                code: 'MISSING_REFRESH_TOKEN',
                message: 'Refresh token is required',
            });
        }
        try {
            const tokens = await auth_service_js_1.authService.refreshTokens(refreshToken);
            return reply.send(tokens);
        }
        catch (error) {
            const message = error instanceof Error ? error.message : 'Token refresh failed';
            if (message === 'Invalid refresh token') {
                return reply.status(401).send({
                    error: 'Unauthorized',
                    code: 'INVALID_REFRESH_TOKEN',
                    message: 'Invalid or revoked refresh token',
                });
            }
            if (message === 'Refresh token expired') {
                return reply.status(401).send({
                    error: 'Unauthorized',
                    code: 'REFRESH_TOKEN_EXPIRED',
                    message: 'Refresh token has expired',
                });
            }
            return reply.status(401).send({
                error: 'Unauthorized',
                code: 'TOKEN_REFRESH_FAILED',
                message,
            });
        }
    });
    // POST /api/v1/auth/logout - Invalidate current refresh token
    app.post('/auth/logout', {
        schema: {
            response: {
                204: zod_1.z.null(),
                401: zod_1.z.object({
                    error: zod_1.z.string(),
                    code: zod_1.z.string(),
                    message: zod_1.z.string(),
                }),
            },
        },
        // Require JWT authentication
        preHandler: async (request, reply) => {
            const authHeader = request.headers.authorization;
            if (!authHeader || !authHeader.startsWith('Bearer ')) {
                return reply.status(401).send({
                    error: 'Unauthorized',
                    code: 'MISSING_TOKEN',
                    message: 'Authorization header with Bearer token required',
                });
            }
        },
    }, async (request, reply) => {
        const authHeader = request.headers.authorization;
        const accessToken = authHeader?.substring(7); // Remove 'Bearer '
        if (!accessToken) {
            return reply.status(401).send({
                error: 'Unauthorized',
                code: 'MISSING_TOKEN',
                message: 'Authorization header with Bearer token required',
            });
        }
        try {
            await auth_service_js_1.authService.logout(accessToken);
            return reply.status(204).send();
        }
        catch (error) {
            const message = error instanceof Error ? error.message : 'Logout failed';
            return reply.status(401).send({
                error: 'Unauthorized',
                code: 'LOGOUT_FAILED',
                message,
            });
        }
    });
};
exports.authRoutes = authRoutes;
//# sourceMappingURL=auth.js.map