"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildApp = buildApp;
exports.start = start;
require("dotenv/config");
const fastify_1 = __importDefault(require("fastify"));
const fastify_type_provider_zod_1 = require("fastify-type-provider-zod");
const index_js_1 = require("./config/index.js");
const auth_js_1 = require("./routes/auth.js");
const translate_js_1 = require("./routes/translate.js");
const history_js_1 = require("./routes/history.js");
const user_js_1 = require("./routes/user.js");
const redis_js_1 = require("./lib/redis.js");
const rate_limit_js_1 = require("./plugins/rate-limit.js");
// Type assertion for fastify factory function
const fastifyFactory = fastify_1.default;
async function buildApp() {
    const app = fastifyFactory({
        logger: {
            level: index_js_1.config.LOG_LEVEL,
            transport: index_js_1.config.NODE_ENV === 'development' ? {
                target: 'pino-pretty',
                options: {
                    colorize: true,
                    translateTime: 'HH:MM:ss Z',
                    ignore: 'pid,hostname',
                },
            } : undefined,
        },
        trustProxy: index_js_1.config.TRUST_PROXY,
    }).withTypeProvider();
    // Zod validation compiler
    app.setValidatorCompiler(fastify_type_provider_zod_1.validatorCompiler);
    app.setSerializerCompiler(fastify_type_provider_zod_1.serializerCompiler);
    // Connect to Redis
    await (0, redis_js_1.connectRedis)();
    // Register rate limit plugin with default config
    await app.register(rate_limit_js_1.rateLimitPlugin, {
        windowMs: index_js_1.config.RATE_LIMIT_WINDOW_MS,
        maxRequests: index_js_1.config.RATE_LIMIT_MAX_REQUESTS,
    });
    // Global error handler
    app.setErrorHandler((error, request, reply) => {
        request.log.error(error, 'Request error');
        // Validation errors from Zod
        if (error.validation) {
            return reply.status(400).send({
                error: 'Validation Error',
                code: 'VALIDATION_ERROR',
                message: error.message,
            });
        }
        // Fastify validation errors
        if (error.code === 'FST_ERR_VALIDATION') {
            return reply.status(400).send({
                error: 'Validation Error',
                code: 'VALIDATION_ERROR',
                message: error.message,
            });
        }
        // JWT errors
        if (error.code === 'FST_JWT_AUTHORIZATION_TOKEN_EXPIRED' || error.code === 'FST_JWT_AUTHORIZATION_TOKEN_INVALID') {
            return reply.status(401).send({
                error: 'Unauthorized',
                code: 'TOKEN_INVALID',
                message: 'Invalid or expired access token',
            });
        }
        // Rate limit errors
        if (error.code === 'RATE_LIMIT_EXCEEDED') {
            return reply.status(429).send({
                error: 'Too Many Requests',
                code: 'RATE_LIMIT_EXCEEDED',
                message: 'Rate limit exceeded. Please try again later.',
            });
        }
        // Not found
        if (error.statusCode === 404 || error.code === 'FST_ERR_NOT_FOUND') {
            return reply.status(404).send({
                error: 'Not Found',
                code: 'NOT_FOUND',
                message: 'Resource not found',
            });
        }
        // Forbidden
        if (error.statusCode === 403) {
            return reply.status(403).send({
                error: 'Forbidden',
                code: 'FORBIDDEN',
                message: 'Access denied',
            });
        }
        // Unprocessable entity (semantic validation)
        if (error.statusCode === 422) {
            return reply.status(422).send({
                error: 'Unprocessable Entity',
                code: 'SEMANTIC_VALIDATION_ERROR',
                message: error.message,
            });
        }
        // Service unavailable (AI providers exhausted)
        if (error.statusCode === 503) {
            return reply.status(503).send({
                error: 'Service Unavailable',
                code: 'AI_PROVIDERS_UNAVAILABLE',
                message: 'All AI providers are currently unavailable. Please try again later.',
            });
        }
        // Default internal server error
        const statusCode = error.statusCode || 500;
        return reply.status(statusCode).send({
            error: 'Internal Server Error',
            code: 'INTERNAL_ERROR',
            message: index_js_1.config.NODE_ENV === 'development' ? error.message : 'An unexpected error occurred',
        });
    });
    // Health check route (ops utility, not in API docs) - no rate limiting
    app.get('/health', async () => {
        return { status: 'ok', timestamp: new Date().toISOString() };
    });
    // Register route plugins with /api/v1 prefix
    await app.register(auth_js_1.authRoutes, { prefix: '/api/v1' });
    await app.register(translate_js_1.translateRoutes, { prefix: '/api/v1' });
    await app.register(history_js_1.historyRoutes, { prefix: '/api/v1' });
    await app.register(user_js_1.userRoutes, { prefix: '/api/v1' });
    // Graceful shutdown
    const close = async () => {
        await (0, redis_js_1.disconnectRedis)();
        await app.close();
    };
    process.on('SIGTERM', close);
    process.on('SIGINT', close);
    return app;
}
async function start() {
    const app = await buildApp();
    try {
        await app.listen({ port: index_js_1.config.PORT, host: index_js_1.config.HOST });
        app.log.info(`🚀 Server listening on http://${index_js_1.config.HOST}:${index_js_1.config.PORT}`);
    }
    catch (err) {
        app.log.error(err);
        process.exit(1);
    }
}
// Start if run directly
if (require.main === module) {
    start();
}
//# sourceMappingURL=app.js.map