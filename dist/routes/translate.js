"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.translateRoutes = void 0;
const zod_1 = require("zod");
const rate_limit_js_1 = require("../plugins/rate-limit.js");
const auth_service_js_1 = require("../services/auth.service.js");
const translation_service_js_1 = require("../services/translation.service.js");
const translateRoutes = async (app) => {
    // Create rate limiter for translate endpoint
    const translateRateLimiter = (0, rate_limit_js_1.createRateLimiter)({ windowMs: 60000, maxRequests: 30, keyPrefix: 'ratelimit:translate' });
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
    // POST /api/v1/translate - Translate text to selected slang style
    app.post('/translate', {
        schema: {
            body: zod_1.z.object({
                text: zod_1.z.string().min(1).max(5000),
                style: zod_1.z.enum(['GEN_Z', 'STREET', 'IT_SLANG']),
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
                422: zod_1.z.object({
                    error: zod_1.z.string(),
                    code: zod_1.z.string(),
                    message: zod_1.z.string(),
                }),
                429: zod_1.z.object({
                    error: zod_1.z.string(),
                    code: zod_1.z.string(),
                    message: zod_1.z.string(),
                }),
                503: zod_1.z.object({
                    error: zod_1.z.string(),
                    code: zod_1.z.string(),
                    message: zod_1.z.string(),
                }),
            },
        },
        // Apply JWT authentication first, then rate limiting (so rate limiter can key by userId)
        preHandler: [authenticate, translateRateLimiter],
    }, async (request, reply) => {
        const { text, style } = request.body;
        const userId = request.user.id;
        try {
            const result = await translation_service_js_1.translationService.translate(userId, { text, style });
            return reply.send(result);
        }
        catch (error) {
            const err = error;
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
exports.translateRoutes = translateRoutes;
//# sourceMappingURL=translate.js.map