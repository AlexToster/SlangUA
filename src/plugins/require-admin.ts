/**
 * Admin gate hooks.
 *
 * Both are `onRequest` hooks, not `preHandler` ones, and that is not a detail:
 * Fastify parses and validates the body *before* preHandler, so a stranger
 * posting `{"password":""}` to /admin/session would have been answered 400
 * VALIDATION_ERROR - which confirms the route exists just as plainly as a 403
 * would. Running at onRequest means the 404 is decided before the body is even
 * read, so a malformed payload, a wrong content-type and a valid one are all
 * answered identically.
 *
 * Two properties matter here, and both are about what a *non*-admin learns:
 *
 * 1. Every rejection is a 404 whose body is byte-for-byte Fastify's own
 *    "route not found" payload. Not 401, not 403 - those would confirm that
 *    /api/v1/admin/* exists and that a password is the only thing missing. To
 *    anyone who is not on the allowlist, the admin API is indistinguishable
 *    from an unregistered path.
 * 2. The JWT is verified here rather than by the shared `authenticate`
 *    preHandler, because `authenticate` answers 401 on a missing or bad token -
 *    which would leak exactly what point 1 hides. The duplication is the price
 *    of that; it is two calls into the same `authService`.
 *
 * `requireAdmin` establishes identity. `requireAdminSession` additionally
 * demands a valid `X-Admin-Token`, and is the one every admin route except the
 * login endpoint uses. Both set `request.user`, so the per-user rate limiters
 * that follow in `preHandler` are keyed by the admin's own id.
 */

import type { FastifyReply } from 'fastify/types/reply';
import type { FastifyRequest } from 'fastify/types/request';
import { authService } from '../services/auth.service.js';
import { adminAuthService } from '../services/admin/admin-auth.service.js';

export const ADMIN_TOKEN_HEADER = 'x-admin-token';

/** Fastify's default not-found body, reproduced field for field and in order. */
function replyNotFound(request: FastifyRequest, reply: FastifyReply) {
  return reply.status(404).send({
    message: `Route ${request.raw.method}:${request.raw.url} not found`,
    error: 'Not Found',
    statusCode: 404,
  });
}

/**
 * Resolves the caller and confirms allowlist membership. Returns false when it
 * has already answered 404, so the caller must not touch the reply afterwards.
 * On success `request.user` is set exactly as `authenticate` would have set it,
 * so admin routes and the rate limiter see the usual shape.
 */
async function resolveAdmin(request: FastifyRequest, reply: FastifyReply): Promise<boolean> {
  // A deployment without ADMIN_TELEGRAM_IDS has no admin panel at all.
  if (!adminAuthService.isConfigured()) {
    await replyNotFound(request, reply);
    return false;
  }

  const authHeader = request.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    await replyNotFound(request, reply);
    return false;
  }

  const payload = await authService.verifyAccessToken(authHeader.substring(7));
  if (!payload || !adminAuthService.isAdminTelegramId(payload.telegramId)) {
    await replyNotFound(request, reply);
    return false;
  }

  request.user = {
    id: payload.userId,
    telegramId: payload.telegramId,
  };
  return true;
}

/** Identity only. Used by the login endpoint, which has no session yet. */
export async function requireAdmin(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  await resolveAdmin(request, reply);
}

/**
 * Identity plus a live admin session. The 401 here is safe: it is only ever
 * reached by a caller who has already proven they are on the allowlist.
 */
export async function requireAdminSession(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  if (!(await resolveAdmin(request, reply))) {
    return;
  }

  const header = request.headers[ADMIN_TOKEN_HEADER];
  const token = typeof header === 'string' ? header.trim() : '';
  if (!token) {
    return reply.status(401).send({
      error: 'Unauthorized',
      code: 'ADMIN_SESSION_REQUIRED',
      message: 'Admin password confirmation is required',
    });
  }

  const session = await adminAuthService.verifySession(token, request.user!.id);
  if (!session) {
    return reply.status(401).send({
      error: 'Unauthorized',
      code: 'ADMIN_SESSION_INVALID',
      message: 'Admin session is missing, expired or invalid',
    });
  }

  request.adminSession = session;
}
