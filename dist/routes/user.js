"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.userRoutes = void 0;
const zod_1 = require("zod");
const auth_service_js_1 = require("../services/auth.service.js");
const user_service_js_1 = require("../services/user.service.js");
const rate_limit_js_1 = require("../plugins/rate-limit.js");
const userRoutes = async (app) => {
    // Rate limiters for user endpoints (30 requests/minute)
    const userRateLimiter = (0, rate_limit_js_1.createRateLimiter)({ windowMs: 60000, maxRequests: 30, keyPrefix: 'ratelimit:user' });
    // JWT authentication middleware
    const authenticate = async (request, reply) => {
        const authHeader = request.headers.authorization;
        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            return reply.status(401).send({
                error: 'Unauthorized',
                code: 'MISSING_TOKEN',
                message: 'Authorization header with Bearer token required',
            });
        }
        const accessToken = authHeader.substring(7);
        const payload = await auth_service_js_1.authService.verifyAccessToken(accessToken);
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
                200: zod_1.z.object({
                    telegramId: zod_1.z.string(),
                    username: zod_1.z.string().nullable(),
                    firstName: zod_1.z.string().nullable(),
                    lastName: zod_1.z.string().nullable(),
                    languageCode: zod_1.z.string().nullable(),
                    defaultSlangStyle: zod_1.z.enum(['GEN_Z', 'STREET', 'IT_SLANG']).nullable(),
                    notificationsEnabled: zod_1.z.boolean(),
                    createdAt: zod_1.z.string().datetime(),
                }),
                401: zod_1.z.object({
                    error: zod_1.z.string(),
                    code: zod_1.z.string(),
                    message: zod_1.z.string(),
                }),
                404: zod_1.z.object({
                    error: zod_1.z.string(),
                    code: zod_1.z.string(),
                    message: zod_1.z.string(),
                }),
            },
        },
        preHandler: [authenticate, userRateLimiter],
    }, async (request, reply) => {
        const userId = request.user.id;
        const profile = await user_service_js_1.userService.getProfile(userId);
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
            createdAt: profile.createdAt.toISOString(),
        };
    });
    // PATCH /api/v1/user/me - Update application-level preferences
    app.patch('/user/me', {
        schema: {
            body: zod_1.z.object({
                defaultSlangStyle: zod_1.z.enum(['GEN_Z', 'STREET', 'IT_SLANG']).optional(),
                notificationsEnabled: zod_1.z.boolean().optional(),
            }).passthrough(),
            response: {
                200: zod_1.z.object({
                    telegramId: zod_1.z.string(),
                    username: zod_1.z.string().nullable(),
                    firstName: zod_1.z.string().nullable(),
                    lastName: zod_1.z.string().nullable(),
                    languageCode: zod_1.z.string().nullable(),
                    defaultSlangStyle: zod_1.z.enum(['GEN_Z', 'STREET', 'IT_SLANG']).nullable(),
                    notificationsEnabled: zod_1.z.boolean(),
                    createdAt: zod_1.z.string().datetime(),
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
                404: zod_1.z.object({
                    error: zod_1.z.string(),
                    code: zod_1.z.string(),
                    message: zod_1.z.string(),
                }),
            },
        },
        preHandler: [authenticate, userRateLimiter],
    }, async (request, reply) => {
        const userId = request.user.id;
        const body = request.body;
        try {
            const updatedProfile = await user_service_js_1.userService.updatePreferences(userId, body);
            return {
                telegramId: updatedProfile.telegramId,
                username: updatedProfile.username,
                firstName: updatedProfile.firstName,
                lastName: updatedProfile.lastName,
                languageCode: updatedProfile.languageCode,
                defaultSlangStyle: updatedProfile.defaultSlangStyle,
                notificationsEnabled: updatedProfile.notificationsEnabled,
                createdAt: updatedProfile.createdAt.toISOString(),
            };
        }
        catch (error) {
            const err = error;
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
exports.userRoutes = userRoutes;
//# sourceMappingURL=user.js.map