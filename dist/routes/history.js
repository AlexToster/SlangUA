"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.historyRoutes = void 0;
const zod_1 = require("zod");
const history_service_js_1 = require("../services/history.service.js");
const auth_service_js_1 = require("../services/auth.service.js");
const rate_limit_js_1 = require("../plugins/rate-limit.js");
const historyRoutes = async (app) => {
    // Rate limiters for history endpoints (60 requests/minute)
    const historyRateLimiter = (0, rate_limit_js_1.createRateLimiter)({ windowMs: 60000, maxRequests: 60, keyPrefix: 'ratelimit:history' });
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
    // GET /api/v1/history - Paginated list of user's translations
    app.get('/history', {
        schema: {
            querystring: zod_1.z.object({
                cursor: zod_1.z.string().optional(),
                limit: zod_1.z.coerce.number().int().min(1).max(100).default(20),
                favorite: zod_1.z.coerce.boolean().optional(),
                search: zod_1.z.string().optional(),
            }),
            response: {
                200: zod_1.z.object({
                    data: zod_1.z.array(zod_1.z.object({
                        id: zod_1.z.number(),
                        originalText: zod_1.z.string(),
                        translatedText: zod_1.z.string(),
                        slangStyle: zod_1.z.enum(['GEN_Z', 'STREET', 'IT_SLANG']),
                        aiProvider: zod_1.z.enum(['OPENAI', 'ANTHROPIC', 'GEMINI', 'OLLAMA']),
                        favorite: zod_1.z.boolean(),
                        createdAt: zod_1.z.string().datetime(),
                    })),
                    nextCursor: zod_1.z.string().nullable(),
                    totalCount: zod_1.z.number().int(),
                }),
                401: zod_1.z.object({
                    error: zod_1.z.string(),
                    code: zod_1.z.string(),
                    message: zod_1.z.string(),
                }),
            },
        },
        preHandler: [authenticate, historyRateLimiter],
    }, async (request, reply) => {
        const userId = request.user.id;
        const { cursor, limit, favorite, search } = request.query;
        const result = await history_service_js_1.historyService.getHistory({
            userId,
            cursor,
            limit,
            favorite,
            search,
        });
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
            params: zod_1.z.object({
                id: zod_1.z.coerce.number().int(),
            }),
            response: {
                200: zod_1.z.object({
                    id: zod_1.z.number(),
                    originalText: zod_1.z.string(),
                    translatedText: zod_1.z.string(),
                    slangStyle: zod_1.z.enum(['GEN_Z', 'STREET', 'IT_SLANG']),
                    aiProvider: zod_1.z.enum(['OPENAI', 'ANTHROPIC', 'GEMINI', 'OLLAMA']),
                    favorite: zod_1.z.boolean(),
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
        preHandler: [authenticate, historyRateLimiter],
    }, async (request, reply) => {
        const userId = request.user.id;
        const { id } = request.params;
        const result = await history_service_js_1.historyService.toggleFavorite(userId, id);
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
            params: zod_1.z.object({
                id: zod_1.z.coerce.number().int(),
            }),
            response: {
                204: zod_1.z.null(),
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
        preHandler: [authenticate, historyRateLimiter],
    }, async (request, reply) => {
        const userId = request.user.id;
        const { id } = request.params;
        const deleted = await history_service_js_1.historyService.deleteTranslation(userId, id);
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
exports.historyRoutes = historyRoutes;
//# sourceMappingURL=history.js.map