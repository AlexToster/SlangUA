/**
 * Operator kill-switch for AI provider instances.
 *
 * The circuit breaker in `AIService` answers "is this provider failing?". This
 * answers a different question - "does the operator want traffic going there at
 * all?" - and the two must not share a mechanism: a breaker heals itself after
 * a cooldown, while a switch flipped because a key leaked, a bill ran away or a
 * model started producing garbage must stay flipped until a human flips it back.
 *
 * State lives in Redis, never in the process:
 * - a restart must not silently re-enable a provider somebody deliberately shut
 *   off, which is exactly what an in-memory flag would do;
 * - a second replica must not disagree about what is switched off.
 *
 * There is no TTL. An expiring kill-switch would resurrect a provider at an
 * arbitrary moment with nobody watching; the record carries who flipped it and
 * when instead, so a stale switch can be explained rather than merely outlived.
 */

import { getRedisClient } from '../../lib/redis.js';
import { logger } from '../../lib/logger.js';

/** One Redis hash: field = provider instance id, value = the JSON record below. */
const DISABLED_KEY = 'ai:provider:disabled';

/** Upper bound on the operator note, mirrored by the route's Zod schema. */
export const PROVIDER_DISABLE_REASON_MAX = 200;

/**
 * Why a provider is switched off. Every field is nullable on purpose: a record
 * written by hand (`HSET ai:provider:disabled openai 1` during an incident, with
 * no panel at hand) must still disable the provider. Presence of the field is
 * the switch; the metadata is documentation.
 */
export interface ProviderDisableRecord {
  /** Telegram id of the operator who flipped it, when known. */
  by: string | null;
  /** ISO-8601 moment it was flipped, when known. */
  at: string | null;
  /** Free-form operator note, when given. */
  reason: string | null;
}

const UNKNOWN_RECORD: ProviderDisableRecord = { by: null, at: null, reason: null };

function parseRecord(providerId: string, raw: string): ProviderDisableRecord {
  try {
    const parsed = JSON.parse(raw) as Partial<ProviderDisableRecord>;
    if (!parsed || typeof parsed !== 'object') {
      return UNKNOWN_RECORD;
    }
    return {
      by: typeof parsed.by === 'string' ? parsed.by : null,
      at: typeof parsed.at === 'string' ? parsed.at : null,
      reason: typeof parsed.reason === 'string' ? parsed.reason : null,
    };
  } catch {
    // Unreadable metadata is not permission to send traffic. The provider stays
    // disabled and the operator sees an entry with no details rather than a
    // provider that quietly came back.
    logger.warn({ providerId }, 'Provider kill-switch: unreadable record, treating the provider as disabled');
    return UNKNOWN_RECORD;
  }
}

export class ProviderSwitchService {
  /**
   * Every provider currently switched off.
   *
   * A Redis failure propagates instead of resolving to "nothing is disabled":
   * the caller cannot know whether a provider was shut off, and guessing "no"
   * would send traffic exactly where an operator forbade it. Callers on the
   * translation path turn that into the same 503 the service already returns
   * when no provider can serve a request - and those requests have already
   * passed a Redis-backed rate limiter, so a Redis outage was never going to let
   * them through anyway.
   */
  async list(): Promise<Map<string, ProviderDisableRecord>> {
    const raw = await getRedisClient().hgetall(DISABLED_KEY);
    const disabled = new Map<string, ProviderDisableRecord>();

    for (const [providerId, value] of Object.entries(raw ?? {})) {
      disabled.set(providerId, parseRecord(providerId, value));
    }

    return disabled;
  }

  /** Switch a provider off. Idempotent; a repeat call refreshes who and when. */
  async disable(providerId: string, by: string, reason: string | null): Promise<ProviderDisableRecord> {
    const record: ProviderDisableRecord = {
      by,
      at: new Date().toISOString(),
      reason: reason && reason.trim() !== '' ? reason.trim() : null,
    };

    await getRedisClient().hset(DISABLED_KEY, providerId, JSON.stringify(record));
    logger.warn({ providerId, by: record.by, reason: record.reason }, 'AI provider switched OFF by an operator');

    return record;
  }

  /** Switch a provider back on. Idempotent; an unknown id is a no-op. */
  async enable(providerId: string, by: string): Promise<void> {
    await getRedisClient().hdel(DISABLED_KEY, providerId);
    logger.warn({ providerId, by }, 'AI provider switched ON by an operator');
  }
}

export const providerSwitchService = new ProviderSwitchService();
