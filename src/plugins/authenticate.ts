import type { FastifyReply } from 'fastify/types/reply';
import type { FastifyRequest } from 'fastify/types/request';
import { authService } from '../services/auth.service.js';

/**
 * JWT bearer authentication preHandler.
 *
 * Single source of truth: every protected route imports this instead of
 * re-declaring its own copy. The five inline copies that used to live in
 * src/routes/* had already drifted apart (different error codes for a missing
 * versus an invalid token), which is exactly the kind of divergence an auth
 * check must not have.
 *
 * On success it attaches `request.user`; on failure it replies 401 and the
 * route handler never runs.
 */
export async function authenticate(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const authHeader = request.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return reply.status(401).send({
      error: 'Unauthorized',
      code: 'MISSING_TOKEN',
      message: 'Authorization header with Bearer token required',
    });
  }

  const accessToken = authHeader.substring(7);
  const payload = await authService.verifyAccessToken(accessToken);

  if (!payload) {
    return reply.status(401).send({
      error: 'Unauthorized',
      code: 'INVALID_TOKEN',
      message: 'Invalid or expired access token',
    });
  }

  request.user = {
    id: payload.userId,
    telegramId: payload.telegramId,
  };
}
