/**
 * The admin error feed: the last few 5xx responses, newest first.
 *
 * This is a window, not an archive. The pino logs remain the record of what
 * happened - they carry the stack, the full message and every request field.
 * The feed exists so an operator can see "something is broken right now"
 * without shell access, and it is deliberately built so that it cannot grow:
 * every write trims the list to `ADMIN_ERROR_FEED_MAX` and refreshes a TTL on
 * the whole key, so a quiet week empties it by itself. There is no delete
 * endpoint - nothing an operator could clear that would not come back on the
 * next failure, and a "clear" button on a diagnostic view mostly invites hiding
 * the evidence.
 *
 * What an entry may contain is limited on purpose: the route *pattern*, never
 * the concrete path (which carries record ids), the internal user id, never a
 * Telegram id, and a truncated technical message. No request body, no
 * translation text, no header. A feed that quoted user text would turn an
 * observability view into a copy of the data the preview/save split exists to
 * keep out of places it does not belong.
 */

import { getRedisClient } from '../../lib/redis.js';
import { config } from '../../config/index.js';

/** One Redis list, newest entry at the head. */
const ERROR_FEED_KEY = 'admin:errors';

/** Upper bound on the stored message, mirrored by the route's Zod schema. */
export const ERROR_FEED_MESSAGE_MAX = 300;

export interface ErrorFeedEntry {
  /** ISO-8601 moment the reply was sent. */
  at: string;
  method: string;
  /**
   * The registered route pattern (`/api/v1/history/:id`), or the path when
   * Fastify matched nothing. Never the concrete url with its parameters.
   */
  route: string;
  statusCode: number;
  /** Our application error code, when the handler produced one. */
  code: string | null;
  /** Technical message, truncated. Provider and framework text only. */
  message: string | null;
  /** Internal user id, or null for an unauthenticated request. */
  userId: number | null;
  /** Fastify request id, so the operator can find the full entry in the logs. */
  requestId: string | null;
}

function truncate(value: string): string {
  return value.length > ERROR_FEED_MESSAGE_MAX
    ? `${value.slice(0, ERROR_FEED_MESSAGE_MAX - 1)}…`
    : value;
}

/** Accepts anything the caller has, and stores only fields of the right shape. */
function normalize(entry: ErrorFeedEntry): ErrorFeedEntry {
  return {
    at: entry.at,
    method: entry.method,
    route: entry.route,
    statusCode: Number.isFinite(entry.statusCode) ? Math.trunc(entry.statusCode) : 0,
    code: entry.code ? truncate(entry.code) : null,
    message: entry.message ? truncate(entry.message) : null,
    userId: entry.userId ?? null,
    requestId: entry.requestId ?? null,
  };
}

function parseEntry(raw: string): ErrorFeedEntry | null {
  try {
    const parsed = JSON.parse(raw) as Partial<ErrorFeedEntry>;
    if (typeof parsed.at !== 'string' || typeof parsed.statusCode !== 'number') return null;
    return {
      at: parsed.at,
      method: typeof parsed.method === 'string' ? parsed.method : 'UNKNOWN',
      route: typeof parsed.route === 'string' ? parsed.route : 'unknown',
      statusCode: parsed.statusCode,
      code: typeof parsed.code === 'string' ? parsed.code : null,
      message: typeof parsed.message === 'string' ? parsed.message : null,
      userId: typeof parsed.userId === 'number' ? parsed.userId : null,
      requestId: typeof parsed.requestId === 'string' ? parsed.requestId : null,
    };
  } catch {
    // A hand-written or half-written entry is dropped from the view rather than
    // failing the whole request: the logs still hold the real thing.
    return null;
  }
}

export class ErrorFeedService {
  /**
   * Appends one failure. Errors propagate; the observability hook that calls
   * this decides that losing a feed entry is preferable to breaking a reply
   * that has already been sent.
   */
  async record(entry: ErrorFeedEntry): Promise<void> {
    const max = config.ADMIN_ERROR_FEED_MAX;

    await getRedisClient()
      .multi()
      .lpush(ERROR_FEED_KEY, JSON.stringify(normalize(entry)))
      .ltrim(ERROR_FEED_KEY, 0, max - 1)
      .expire(ERROR_FEED_KEY, config.ADMIN_ERROR_FEED_TTL_SECONDS)
      .exec();
  }

  /** Newest first. A Redis failure propagates - an empty feed must mean empty. */
  async list(limit?: number): Promise<ErrorFeedEntry[]> {
    const max = config.ADMIN_ERROR_FEED_MAX;
    const count = Math.min(limit ?? max, max);
    const raw = await getRedisClient().lrange(ERROR_FEED_KEY, 0, count - 1);

    const entries: ErrorFeedEntry[] = [];
    for (const item of raw) {
      const parsed = parseEntry(item);
      if (parsed) entries.push(parsed);
    }
    return entries;
  }
}

export const errorFeedService = new ErrorFeedService();
