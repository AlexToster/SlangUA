/**
 * KeyPool unit tests.
 *
 * The pool is the piece that decides whether a free-tier deployment survives a
 * spent key, so its bookkeeping is worth pinning down: round-robin order,
 * cooldown windows, cooldown extension, and the "everything is parked" answer.
 */

import { describe, it, expect } from 'vitest';
import {
  KeyPool,
  InMemoryKeyCooldownStore,
  parseKeyList,
  type KeyCooldownMs,
} from '../../src/services/ai/key-pool';

const COOLDOWNS: KeyCooldownMs = { rate: 60_000, quota: 3_600_000, invalid: 3_600_000 };

/** A pool with a clock the test controls, so nothing has to wait. */
function makePool(keys: string[], startAt = 1_000_000) {
  let now = startAt;
  const pool = new KeyPool({
    id: 'test-pool',
    keys,
    cooldownMs: COOLDOWNS,
    store: new InMemoryKeyCooldownStore(),
    now: () => now,
  });

  return {
    pool,
    advance(ms: number) {
      now += ms;
    },
  };
}

describe('parseKeyList', () => {
  it('returns an empty list for an unset value', () => {
    expect(parseKeyList(undefined)).toEqual([]);
    expect(parseKeyList('')).toEqual([]);
  });

  it('splits on commas and trims each entry', () => {
    expect(parseKeyList('a, b ,c')).toEqual(['a', 'b', 'c']);
  });

  it('drops empty entries so a trailing comma is harmless', () => {
    expect(parseKeyList('a,,b,')).toEqual(['a', 'b']);
  });

  it('collapses duplicates, which would otherwise be penalized twice for one limit', () => {
    expect(parseKeyList('a,b,a')).toEqual(['a', 'b']);
  });
});

describe('KeyPool', () => {
  it('reports its size and hands out keys round-robin', async () => {
    const { pool } = makePool(['k1', 'k2', 'k3']);
    expect(pool.size).toBe(3);

    const leases = [await pool.next(), await pool.next(), await pool.next(), await pool.next()];

    expect(leases.map((l) => l?.index)).toEqual([0, 1, 2, 0]);
    expect(leases.map((l) => l?.key)).toEqual(['k1', 'k2', 'k3', 'k1']);
  });

  it('is empty when no key is configured', async () => {
    const { pool } = makePool([]);
    expect(pool.size).toBe(0);
    expect(await pool.next()).toBeNull();
    expect(await pool.retryAfterMs()).toBe(0);
  });

  it('skips a parked key and returns to it once the cooldown elapses', async () => {
    const { pool, advance } = makePool(['k1', 'k2']);

    await pool.penalize(0, 'rate');

    expect((await pool.next())?.index).toBe(1);
    expect((await pool.next())?.index).toBe(1);

    advance(COOLDOWNS.rate + 1);
    expect((await pool.next())?.index).toBe(0);
  });

  it('returns null and a positive retryAfterMs when every key is parked', async () => {
    const { pool, advance } = makePool(['k1', 'k2']);

    await pool.penalize(0, 'quota');
    advance(1_000);
    await pool.penalize(1, 'rate');

    expect(await pool.next()).toBeNull();
    // The soonest key back is the rate-limited one, penalized 1s later.
    expect(await pool.retryAfterMs()).toBe(COOLDOWNS.rate);
  });

  it('reports retryAfterMs 0 while any key is still usable', async () => {
    const { pool } = makePool(['k1', 'k2']);
    await pool.penalize(0, 'quota');
    expect(await pool.retryAfterMs()).toBe(0);
  });

  it('never shortens an existing cooldown', async () => {
    const { pool, advance } = makePool(['k1']);

    await pool.penalize(0, 'quota');
    await pool.penalize(0, 'rate');

    advance(COOLDOWNS.rate + 1);
    expect(await pool.next()).toBeNull();

    advance(COOLDOWNS.quota);
    expect((await pool.next())?.index).toBe(0);
  });

  it('ignores a penalty for an index outside the pool', async () => {
    const { pool } = makePool(['k1']);
    await pool.penalize(7, 'quota');
    expect((await pool.next())?.index).toBe(0);
  });

  it('shares cooldown state between pools that describe the same account', async () => {
    const store = new InMemoryKeyCooldownStore();
    const now = () => 1_000_000;
    const options = { keys: ['k1', 'k2'], cooldownMs: COOLDOWNS, store, now };

    const first = new KeyPool({ id: 'gemini', ...options });
    const second = new KeyPool({ id: 'gemini', ...options });

    await first.penalize(0, 'quota');

    expect((await second.next())?.index).toBe(1);
  });

  it('keeps pools with different ids independent', async () => {
    const store = new InMemoryKeyCooldownStore();
    const now = () => 1_000_000;
    const options = { keys: ['k1', 'k2'], cooldownMs: COOLDOWNS, store, now };

    const gemini = new KeyPool({ id: 'gemini', ...options });
    const openai = new KeyPool({ id: 'openai', ...options });

    await gemini.penalize(0, 'quota');

    expect((await openai.next())?.index).toBe(0);
  });
});
