/**
 * Observability: the one place where finished requests are counted and failures
 * are pushed onto the admin error feed.
 *
 * It hangs on `onResponse` rather than `onRequest` or `preHandler` for two
 * reasons. The measurement needs the status code, which only exists once the
 * reply is out; and nothing here may ever delay or fail a request - by the time
 * this hook runs the client already has its answer, so a Redis problem can cost
 * us a data point and nothing else.
 *
 * That is why both writes are fail-open, which is the opposite of the rate
 * limiter's fail-closed rule and does not contradict it: the limiter decides
 * whether a request may proceed and therefore must refuse when it cannot
 * decide, while this hook only describes what already happened. A Redis outage
 * is announced loudly enough elsewhere - the limiter answers 503, the readiness
 * probe goes degraded - so the failure is logged at debug level here instead of
 * doubling the log volume of an outage with one warning per request.
 */

import { FastifyInstance } from 'fastify/types/instance';
import { FastifyRequest } from 'fastify/types/request';
import { metricsService } from '../services/admin/metrics.service.js';
import { errorFeedService } from '../services/admin/error-feed.service.js';

/** Status code from which a response counts as our failure, not the client's. */
const ERROR_STATUS_FLOOR = 500;

/**
 * Which requests are measured. Three exclusions, each for its own reason:
 *
 * - `OPTIONS`: CORS preflights are browser bookkeeping, and counting them would
 *   double every number the panel shows for a Mini App request.
 * - `/health*`: probes run on a fixed interval, so including them would put a
 *   constant floor under the graph and hide what real traffic does.
 * - `/api/v1/admin/*`: the panel polls itself. Counting its own reads would let
 *   an operator watching the metrics page inflate the metrics page.
 */
export function isMeasurableRequest(method: string, url: string): boolean {
  if (method === 'OPTIONS') return false;

  const path = url.split('?')[0];
  if (path === '/health' || path.startsWith('/health/')) return false;
  if (path === '/api/v1/admin' || path.startsWith('/api/v1/admin/')) return false;

  return true;
}

/**
 * The route pattern, never the concrete url: `request.routeOptions.url` is
 * `/api/v1/history/:id`, while `request.url` would carry the record id itself.
 * An unmatched request has no pattern, and its path is safe by definition.
 */
function routeLabelOf(request: FastifyRequest): string {
  const routeOptions = (request as FastifyRequest & { routeOptions?: { url?: string } }).routeOptions;
  return routeOptions?.url ?? request.url.split('?')[0];
}

/**
 * Leaves the error feed the two fields it is allowed to store. Called from
 * wherever a 5xx reply is produced - the global error handler, and the few
 * handlers that answer 5xx themselves and therefore never reach it - because the
 * `onResponse` hook runs after the reply and no longer has the error.
 *
 * Deliberately two strings rather than the error object: passing the error would
 * invite somebody to widen this later into a stack, a request body or a
 * translation, none of which may reach Redis. The technical message is kept even
 * in production, where the client is told nothing: it is readable only behind
 * both admin factors, and telling an operator what actually failed is the whole
 * point of the feed.
 */
export function captureErrorSnapshot(
  request: FastifyRequest,
  code: string,
  message?: string | null
): void {
  request.errorSnapshot = { code, message: message || null };
}

export function registerObservability(app: FastifyInstance): void {
  app.addHook('onResponse', async (request, reply) => {
    if (!isMeasurableRequest(request.method, request.url)) return;

    const isError = reply.statusCode >= ERROR_STATUS_FLOOR;
    const userId = request.user?.id ?? null;

    try {
      await metricsService.record({ userId, isError });
    } catch (err) {
      request.log.debug({ err }, 'Metrics write failed; the reply was already sent');
    }

    if (!isError) return;

    try {
      // The snapshot is whatever produced the reply left behind. A 5xx sent by
      // code that captures nothing is still recorded - the status code is the
      // fact that matters, the code and message are commentary.
      await errorFeedService.record({
        at: new Date().toISOString(),
        method: request.method,
        route: routeLabelOf(request),
        statusCode: reply.statusCode,
        code: request.errorSnapshot?.code ?? null,
        message: request.errorSnapshot?.message ?? null,
        userId,
        requestId: typeof request.id === 'string' ? request.id : String(request.id),
      });
    } catch (err) {
      request.log.debug({ err }, 'Error feed write failed; the reply was already sent');
    }
  });
}
