import 'dotenv/config';
import fastify from 'fastify';
import { serializerCompiler, validatorCompiler, ZodTypeProvider } from 'fastify-type-provider-zod';
import { config } from './config/index.js';
import { authRoutes } from './routes/auth.js';
import { translateRoutes } from './routes/translate.js';
import { historyRoutes } from './routes/history.js';
import { userRoutes } from './routes/user.js';
import { stylesRoutes } from './routes/styles.js';
import { shareRoutes } from './routes/share.js';
import { connectRedis, disconnectRedis, getRedisClient } from './lib/redis.js';
import { prisma } from './lib/prisma.js';
import { createRateLimiter } from './plugins/rate-limit.js';
import { initializeStyleEngine } from './style-engine/loader.js';
import cors from '@fastify/cors';

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

  // CORS - must be registered before routes to handle preflight requests
  await app.register(cors, {
    origin: config.CORS_ALLOWED_ORIGINS.split(',').map(s => s.trim()),
    credentials: true,
  });

  // Redis is required: the API must not accept LLM-capable requests without rate limiting.
  await connectRedis();

  // Validate and preload immutable Style Engine assets before accepting traffic.
  await initializeStyleEngine();

  const globalRateLimiter = createRateLimiter({
    windowMs: config.GLOBAL_RATE_LIMIT_WINDOW_MS,
    maxRequests: config.GLOBAL_RATE_LIMIT_MAX_REQUESTS,
    keyPrefix: 'ratelimit:global',
  });

  // A coarse IP limit covers every public route, including future routes and the
  // Telegram webhook. Authenticated endpoints retain their stricter per-user limits.
  // Only the liveness probe is exempt: it touches nothing. `/health/ready` stays
  // limited because it queries Postgres and pings Redis, and a probe interval of
  // seconds is orders of magnitude below the limit anyway.
  app.addHook('onRequest', async (request, reply) => {
    if (request.url.split('?')[0] === '/health') return;
    await globalRateLimiter(request, reply);
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

    // Rate limiter unavailable (fail-closed)
    if (error.code === 'RATE_LIMITER_UNAVAILABLE') {
      return reply.status(503).send({
        error: 'Service Unavailable',
        code: 'RATE_LIMITER_UNAVAILABLE',
        message: 'Rate limiting temporarily unavailable. Please try again later.',
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

  // Liveness probe (ops utility, not in API docs) - no rate limiting.
  // Answers as long as the process is running; says nothing about dependencies.
  app.get('/health', async () => {
    return { status: 'ok', timestamp: new Date().toISOString() };
  });

  // Readiness probe: 200 only while both backing stores answer. Without Redis the
  // rate limiter fails closed and every LLM-capable route returns 503, so an
  // instance in that state must be taken out of rotation rather than kept serving.
  app.get('/health/ready', async (request: FastifyRequest, reply: FastifyReply) => {
    const check = async (name: 'database' | 'redis', probe: () => Promise<unknown>) => {
      try {
        await probe();
        return true;
      } catch (err) {
        request.log.warn({ err, check: name }, 'Readiness check failed');
        return false;
      }
    };

    const [database, redis] = await Promise.all([
      // A one-row indexed read rather than `$queryRaw('SELECT 1')`: it proves the
      // connection round-trips without putting raw SQL outside a migration, and it
      // stays cheap as the table grows (unlike a count). An empty table returns
      // null, which is still a healthy answer.
      check('database', () => prisma.user.findFirst({ select: { id: true } })),
      check('redis', () => getRedisClient().ping()),
    ]);

    const ready = database && redis;
    return reply.status(ready ? 200 : 503).send({
      status: ready ? 'ok' : 'degraded',
      checks: {
        database: database ? 'up' : 'down',
        redis: redis ? 'up' : 'down',
      },
      timestamp: new Date().toISOString(),
    });
  });

  // Register route plugins with /api/v1 prefix
  await app.register(authRoutes, { prefix: '/api/v1' });
  await app.register(translateRoutes, { prefix: '/api/v1' });
  await app.register(historyRoutes, { prefix: '/api/v1' });
  await app.register(userRoutes, { prefix: '/api/v1' });
  await app.register(stylesRoutes, { prefix: '/api/v1' });
  await app.register(shareRoutes, { prefix: '/api/v1' });

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
