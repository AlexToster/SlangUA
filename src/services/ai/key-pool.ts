/**
 * API Key Pool
 *
 * A provider may be configured with several API keys (a comma-separated
 * `*_API_KEY`). When one key hits a rate limit or burns through its quota the
 * pool parks that key for a cooldown and hands out the next one, so a single
 * exhausted free-tier key no longer costs the whole provider.
 *
 * Two rules this module exists to enforce:
 *
 * 1. **A key is never used as an identifier.** Cooldowns are keyed by pool id +
 *    key index, so a raw secret can never end up as a Redis key, a log field or
 *    a metric label.
 * 2. **Cooldown state is swappable.** The in-memory store below is per-process,
 *    which is correct for a single instance. `KeyCooldownStore` is the seam a
 *    Redis-backed store plugs into when the API runs on more than one node,
 *    without touching the adapters.
 */

/**
 * Why a key was parked.
 *
 * - `rate`: a short-term limit (requests per minute). Comes back quickly.
 * - `quota`: a budget is spent (daily cap, credits at zero). Comes back slowly.
 * - `invalid`: the key was rejected as such - revoked, expired, mistyped. Parked
 *   like `quota` so one bad key in a pool does not fail every request that lands
 *   on it, but logged at error level because it is a configuration problem, not
 *   a load problem.
 */
export type KeyExhaustionKind = 'rate' | 'quota' | 'invalid';

export type KeyCooldownMs = Record<KeyExhaustionKind, number>;

/**
 * Where per-key cooldowns live. Implementations must accept an unknown
 * (poolId, index) pair and answer 0 - "not cooling down".
 */
export interface KeyCooldownStore {
  getCooldownUntil(poolId: string, index: number): Promise<number>;
  setCooldownUntil(poolId: string, index: number, untilMs: number): Promise<void>;
}

/**
 * Process-local cooldown store. Sufficient while the API runs as one process;
 * with several nodes each would learn about an exhausted key on its own.
 */
export class InMemoryKeyCooldownStore implements KeyCooldownStore {
  private readonly cooldowns = new Map<string, number>();

  private static field(poolId: string, index: number): string {
    return `${poolId}#${index}`;
  }

  async getCooldownUntil(poolId: string, index: number): Promise<number> {
    return this.cooldowns.get(InMemoryKeyCooldownStore.field(poolId, index)) ?? 0;
  }

  async setCooldownUntil(poolId: string, index: number, untilMs: number): Promise<void> {
    this.cooldowns.set(InMemoryKeyCooldownStore.field(poolId, index), untilMs);
  }
}

/**
 * The default store. Shared on purpose: two adapter instances that were handed
 * the same pool id describe the same upstream account, so they should observe
 * the same cooldowns.
 */
export const defaultKeyCooldownStore = new InMemoryKeyCooldownStore();

export interface KeyPoolOptions {
  /** Pool identifier - the provider instance id. Never a key value. */
  id: string;
  keys: string[];
  cooldownMs: KeyCooldownMs;
  store?: KeyCooldownStore;
  /** Injectable clock, so tests do not have to wait out a cooldown. */
  now?: () => number;
}

/**
 * One key handed out for a single attempt. `index` is what gets penalized; the
 * caller never has to pass the secret back.
 */
export interface LeasedKey {
  index: number;
  key: string;
}

/**
 * Split a comma-separated key list. Empty entries are dropped and duplicates
 * collapsed, because a duplicated key would be penalized twice for the same
 * upstream limit and make the pool look larger than it is.
 */
export function parseKeyList(raw?: string): string[] {
  if (!raw) {
    return [];
  }

  const seen = new Set<string>();
  for (const candidate of raw.split(',')) {
    const key = candidate.trim();
    if (key.length > 0) {
      seen.add(key);
    }
  }

  return [...seen];
}

export class KeyPool {
  readonly id: string;

  private readonly keys: string[];
  private readonly cooldownMs: KeyCooldownMs;
  private readonly store: KeyCooldownStore;
  private readonly now: () => number;

  /** Round-robin position, so load spreads instead of hammering the first key. */
  private cursor = 0;

  constructor(options: KeyPoolOptions) {
    this.id = options.id;
    this.keys = [...options.keys];
    this.cooldownMs = options.cooldownMs;
    this.store = options.store ?? defaultKeyCooldownStore;
    this.now = options.now ?? (() => Date.now());
  }

  get size(): number {
    return this.keys.length;
  }

  /**
   * Lease the next key that is not cooling down, or null when every key is
   * parked. Scans at most `size` positions, so an exhausted pool costs no
   * network call at all - unlike a circuit breaker, which only learns after a
   * failed request.
   */
  async next(): Promise<LeasedKey | null> {
    const total = this.keys.length;
    if (total === 0) {
      return null;
    }

    const now = this.now();

    for (let offset = 0; offset < total; offset++) {
      const index = (this.cursor + offset) % total;
      const until = await this.store.getCooldownUntil(this.id, index);

      if (until <= now) {
        this.cursor = (index + 1) % total;
        return { index, key: this.keys[index] };
      }
    }

    return null;
  }

  /**
   * Park a key. Cooldowns extend rather than shorten: a key already sidelined
   * for a spent quota must not be brought back early by a later rate limit.
   */
  async penalize(index: number, kind: KeyExhaustionKind): Promise<void> {
    if (index < 0 || index >= this.keys.length) {
      return;
    }

    const until = this.now() + this.cooldownMs[kind];
    const current = await this.store.getCooldownUntil(this.id, index);

    if (until > current) {
      await this.store.setCooldownUntil(this.id, index, until);
    }
  }

  /**
   * Milliseconds until the earliest key comes back, for the caller's
   * `retryAfterMs`. 0 means a key is available right now.
   */
  async retryAfterMs(): Promise<number> {
    if (this.keys.length === 0) {
      return 0;
    }

    const now = this.now();
    let earliest = Number.POSITIVE_INFINITY;

    for (let index = 0; index < this.keys.length; index++) {
      const until = await this.store.getCooldownUntil(this.id, index);
      if (until <= now) {
        return 0;
      }
      earliest = Math.min(earliest, until);
    }

    return Math.max(0, earliest - now);
  }
}
