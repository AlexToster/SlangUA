import { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import type { FastifyInstance } from 'fastify/types/instance';
import { Prisma } from '@prisma/client';
import { createRateLimiter } from '../plugins/rate-limit.js';
import { authService } from '../services/auth.service.js';
import { config } from '../config/index.js';
import { randomBytes, timingSafeEqual } from 'node:crypto';

const REFRESH_COOKIE = 'slangua_refresh';
const CSRF_COOKIE = 'slangua_csrf';

function refreshTtlSeconds(): number {
  const match = /^(\d+)([smhd])$/.exec(config.JWT_REFRESH_TTL);
  if (!match) throw new Error('JWT_REFRESH_TTL must use s, m, h, or d units');
  const multipliers = { s: 1, m: 60, h: 3600, d: 86400 } as const;
  return Number(match[1]) * multipliers[match[2] as keyof typeof multipliers];
}

function serializeCookie(name: string, value: string, httpOnly: boolean, maxAge = refreshTtlSeconds(), path = '/api/v1/auth'): string {
  const attributes = [`${name}=${encodeURIComponent(value)}`, `Path=${path}`, `Max-Age=${maxAge}`, 'SameSite=Lax'];
  if (config.NODE_ENV === 'production') attributes.push('Secure');
  if (httpOnly) attributes.push('HttpOnly');
  return attributes.join('; ');
}

function readCookie(header: string | undefined, name: string): string | undefined {
  const cookie = header?.split(';').map((part) => part.trim()).find((part) => part.startsWith(`${name}=`));
  return cookie ? decodeURIComponent(cookie.slice(name.length + 1)) : undefined;
}

function validCsrf(request: any): boolean {
  const cookie = readCookie(request.headers.cookie, CSRF_COOKIE);
  const header = request.headers['x-csrf-token'];
  if (!cookie || typeof header !== 'string') return false;
  const left = Buffer.from(cookie);
  const right = Buffer.from(header);
  return left.length === right.length && timingSafeEqual(left, right);
}

function setSessionCookies(reply: any, refreshToken: string): void {
  const csrfToken = randomBytes(32).toString('base64url');
  reply.header('Set-Cookie', [
    serializeCookie(REFRESH_COOKIE, refreshToken, true),
    serializeCookie(CSRF_COOKIE, csrfToken, false, refreshTtlSeconds(), '/'),
  ]);
}

function clearSessionCookies(reply: any): void {
  reply.header('Set-Cookie', [
    serializeCookie(REFRESH_COOKIE, '', true, 0),
    serializeCookie(CSRF_COOKIE, '', false, 0, '/'),
  ]);
}

export const authRoutes: FastifyPluginAsyncZod = async (app: FastifyInstance) => {
  // Token-minting endpoints, keyed by IP (no authenticated user exists yet), so
  // they carry their own tighter budget rather than the generic per-user limit.
  const authRateLimiter = createRateLimiter({
    windowMs: config.AUTH_RATE_LIMIT_WINDOW_MS,
    maxRequests: config.AUTH_RATE_LIMIT_MAX_REQUESTS,
    keyPrefix: 'ratelimit:auth'
  });
  const refreshRateLimiter = createRateLimiter({
    windowMs: config.REFRESH_RATE_LIMIT_WINDOW_MS,
    maxRequests: config.REFRESH_RATE_LIMIT_MAX_REQUESTS,
    keyPrefix: 'ratelimit:refresh'
  });

  // POST /api/v1/auth/telegram - Exchange Telegram initData for JWT tokens
  app.post('/auth/telegram', {
    schema: {
      body: z.object({
        initData: z.string(),
      }),
      response: {
        200: z.object({
          accessToken: z.string(),
        }),
        400: z.object({
          error: z.string(),
          code: z.string(),
          message: z.string(),
        }),
        401: z.object({
          error: z.string(),
          code: z.string(),
          message: z.string(),
        }),
        429: z.object({
          error: z.string(),
          code: z.string(),
          message: z.string(),
        }),
        503: z.object({
          error: z.string(),
          code: z.string(),
          message: z.string(),
        }),
      },
    },
    preHandler: authRateLimiter,
  }, async (request, reply) => {
    const { initData } = request.body as { initData: string };
    
    try {
      const tokens = await authService.authenticateWithTelegram(initData);
      setSessionCookies(reply, tokens.refreshToken);
      return reply.send({ accessToken: tokens.accessToken });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Telegram authentication failed';
      
      if (message === 'Expired auth_date') {
        return reply.status(401).send({
          error: 'Unauthorized',
          code: 'AUTH_DATE_EXPIRED',
          message: 'Authentication data has expired',
        });
      }
      
      if (message === 'Invalid auth_date') {
        return reply.status(401).send({
          error: 'Unauthorized',
          code: 'AUTH_DATE_INVALID',
          message: 'Invalid authentication date',
        });
      }
      
      if (message === 'auth_date is too far in the future') {
        return reply.status(401).send({
          error: 'Unauthorized',
          code: 'AUTH_DATE_FUTURE',
          message: 'Authentication date is too far in the future',
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
      body: z.object({}).strict(),
      response: {
        200: z.object({
          accessToken: z.string(),
        }),
        400: z.object({
          error: z.string(),
          code: z.string(),
          message: z.string(),
        }),
        401: z.object({
          error: z.string(),
          code: z.string(),
          message: z.string(),
        }),
        403: z.object({
          error: z.string(),
          code: z.string(),
          message: z.string(),
        }),
        429: z.object({
          error: z.string(),
          code: z.string(),
          message: z.string(),
        }),
        503: z.object({
          error: z.string(),
          code: z.string(),
          message: z.string(),
        }),
      },
    },
    preHandler: refreshRateLimiter,
  }, async (request, reply) => {
    const refreshToken = readCookie(request.headers.cookie, REFRESH_COOKIE);
    
    if (!refreshToken) {
      return reply.status(400).send({
        error: 'Bad Request',
        code: 'MISSING_REFRESH_TOKEN',
        message: 'Refresh token cookie is required',
      });
    }
    if (!validCsrf(request)) {
      return reply.status(403).send({
        error: 'Forbidden',
        code: 'CSRF_VALIDATION_FAILED',
        message: 'A valid CSRF token is required',
      });
    }
    
    try {
      const tokens = await authService.refreshTokens(refreshToken);
      setSessionCookies(reply, tokens.refreshToken);
      return reply.send({ accessToken: tokens.accessToken });
    } catch (error) {
      // Prisma P2025 = "Record to delete does not exist" — happens when
      // concurrent request already rotated this refresh token.
      // Treat it the same as "Invalid refresh token" so callers can't
      // distinguish "never existed" from "already used".
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025') {
        return reply.status(401).send({
          error: 'Unauthorized',
          code: 'INVALID_REFRESH_TOKEN',
          message: 'Invalid or revoked refresh token',
        });
      }

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
        204: z.null(),
        401: z.object({
          error: z.string(),
          code: z.string(),
          message: z.string(),
        }),
        500: z.object({
          error: z.string(),
          code: z.string(),
          message: z.string(),
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
      await authService.logout(accessToken);
      clearSessionCookies(reply);
      return reply.status(204).send();
    } catch (error) {
      // Only a bad/expired token is a 401. A database or Redis failure is not the
      // client's fault and must not be reported as an auth problem, nor echo the
      // raw error message back.
      const statusCode = (error as { statusCode?: number } | null)?.statusCode;
      if (statusCode === 401) {
        return reply.status(401).send({
          error: 'Unauthorized',
          code: 'INVALID_TOKEN',
          message: 'Access token is invalid or expired',
        });
      }

      request.log.error({ err: error }, 'Logout failed');
      return reply.status(500).send({
        error: 'Internal Server Error',
        code: 'LOGOUT_FAILED',
        message: 'Logout could not be completed. Please try again.',
      });
    }
  });
};
