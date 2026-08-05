import 'dotenv/config';
import fastify from 'fastify';
import { serializerCompiler, validatorCompiler, ZodTypeProvider } from 'fastify-type-provider-zod';
import { config } from './config/index.js';
import { authRoutes } from './routes/auth.js';
import { translateRoutes } from './routes/translate.js';
import { historyRoutes } from './routes/history.js';
import { userRoutes } from './routes/user.js';
import { connectRedis, disconnectRedis } from './lib/redis.js';
import { rateLimitPlugin } from './plugins/rate-limit.js';

// Import types from fastify submodules
import type { FastifyInstance } from 'fastify/types/instance';
import type { FastifyError } from '@fastify/error';
import type { FastifyReply } from 'fastify/types/reply';
import type { FastifyRequest } from 'fastify/types/request';

// Type assertion for fastify factory function
const fastifyFactory = fastify as unknown as (opts?: Record<string, unknown>) => FastifyInstance & { withTypeProvider: <T>() => FastifyInstance & { withTypeProvider: <T>() => FastifyInstance } };

export async function buildApp(): Promise<FastifyInstance> {
  const app = fastifyFactory({
    logger: {
      level: config.LOG_LEVEL,
      transport: config.NODE_ENV === 'development' ? {
        target: 'pino-pretty',
        options: {
          colorize: true,
          translateTime: 'HH:MM:ss Z',
          ignore: 'pid,hostname',
        },
      } : undefined,
    },
    trustProxy: config.TRUST_PROXY,
  }).withTypeProvider<ZodTypeProvider>();

  // Zod validation compiler
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  // Connect to Redis
  await connectRedis();

  // Register rate limit plugin with default config
  await app.register(rateLimitPlugin, {
    windowMs: config.RATE_LIMIT_WINDOW_MS,
    maxRequests: config.RATE_LIMIT_MAX_REQUESTS,
  });

  // Global error handler
  app.setErrorHandler((error: FastifyError, request: FastifyRequest, reply: FastifyReply) => {
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
      message: config.NODE_ENV === 'development' ? error.message : 'An unexpected error occurred',
    });
  });

  // Health check route (ops utility, not in API docs) - no rate limiting
  app.get('/health', async () => {
    return { status: 'ok', timestamp: new Date().toISOString() };
  });

  // Register route plugins with /api/v1 prefix
  await app.register(authRoutes, { prefix: '/api/v1' });
  await app.register(translateRoutes, { prefix: '/api/v1' });
  await app.register(historyRoutes, { prefix: '/api/v1' });
  await app.register(userRoutes, { prefix: '/api/v1' });

  // Graceful shutdown
  const close = async () => {
    await disconnectRedis();
    await app.close();
  };
  process.on('SIGTERM', close);
  process.on('SIGINT', close);

  return app;
}

export async function start(): Promise<void> {
  const app = await buildApp();

  try {
    await app.listen({ port: config.PORT, host: config.HOST });
    app.log.info(`🚀 Server listening on http://${config.HOST}:${config.PORT}`);
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
}

// Start if run directly
if (require.main === module) {
  start();
}