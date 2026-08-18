/**
 * The operator kill-switch, read and written without Redis.
 *
 * The property that matters here is the direction of every doubt: presence of a
 * field in the hash disables the provider, and nothing about the *value* of that
 * field may ever turn the switch back on. Unreadable JSON, a hand-typed `1` from
 * an incident shell, missing metadata - all of them still mean "no traffic".
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ProviderSwitchService } from '../../src/services/ai/provider-switch.service';

/**
 * An in-memory stand-in for the one Redis hash the service touches. It has to be
 * built inside `vi.hoisted` because `vi.mock` runs before the module body: a
 * plain `const` above would still be in its temporal dead zone when the mock
 * factory is first called.
 */
const redis = vi.hoisted(() => {
  const hash = new Map<string, string>();
  const state: { failWith: Error | null } = { failWith: null };

  return {
    hash,
    state,
    client: {
      hgetall: async () => {
        if (state.failWith) throw state.failWith;
        return Object.fromEntries(hash);
      },
      hset: async (_key: string, field: string, value: string) => {
        if (state.failWith) throw state.failWith;
        hash.set(field, value);
        return 1;
      },
      hdel: async (_key: string, field: string) => {
        if (state.failWith) throw state.failWith;
        return hash.delete(field) ? 1 : 0;
      },
    },
  };
});

// The service asks for the shared client lazily, so mocking the module means no
// ioredis instance is ever constructed and nothing tries to connect.
vi.mock('../../src/lib/redis.js', () => ({
  getRedisClient: () => redis.client,
}));

const service = new ProviderSwitchService();

beforeEach(() => {
  redis.hash.clear();
  redis.state.failWith = null;
});

describe('ProviderSwitchService.list', () => {
  it('reports nothing disabled when the hash is empty', async () => {
    await expect(service.list()).resolves.toEqual(new Map());
  });

  it('treats an unreadable record as disabled with no details', async () => {
    // `HSET ai:provider:disabled openai 1` typed by hand during an incident.
    redis.hash.set('openai', '1');

    const disabled = await service.list();

    expect(disabled.has('openai')).toBe(true);
    expect(disabled.get('openai')).toEqual({ by: null, at: null, reason: null });
  });

  it('drops metadata of the wrong type instead of the whole record', async () => {
    redis.hash.set('gemini', JSON.stringify({ by: 42, at: null, reason: ['nope'] }));

    const disabled = await service.list();

    expect(disabled.has('gemini')).toBe(true);
    expect(disabled.get('gemini')).toEqual({ by: null, at: null, reason: null });
  });

  it('keeps the metadata of a well-formed record', async () => {
    redis.hash.set(
      'openai',
      JSON.stringify({ by: '777', at: '2026-08-18T10:00:00.000Z', reason: 'bill' })
    );

    await expect(service.list()).resolves.toEqual(
      new Map([['openai', { by: '777', at: '2026-08-18T10:00:00.000Z', reason: 'bill' }]])
    );
  });

  it('propagates a Redis failure instead of answering "nothing is disabled"', async () => {
    // Fail-closed: the caller turns this into the same 503 it already returns
    // when no provider can serve a request. Resolving to an empty map would send
    // traffic exactly where an operator forbade it.
    redis.state.failWith = new Error('READONLY You cannot write against a read only replica');

    await expect(service.list()).rejects.toThrow(/READONLY/);
  });
});

describe('ProviderSwitchService.disable', () => {
  it('records who flipped the switch and when', async () => {
    const before = Date.now();
    const record = await service.disable('openai', '777', 'key leaked');

    expect(record.by).toBe('777');
    expect(record.reason).toBe('key leaked');
    expect(new Date(record.at as string).getTime()).toBeGreaterThanOrEqual(before);

    // Written as JSON under the provider id, so list() reads back the same thing.
    await expect(service.list()).resolves.toEqual(new Map([['openai', record]]));
  });

  it('stores a blank note as no note at all', async () => {
    const record = await service.disable('gemini', '777', '   ');

    expect(record.reason).toBeNull();
  });

  it('trims the note', async () => {
    const record = await service.disable('gemini', '777', '  bill ran away  ');

    expect(record.reason).toBe('bill ran away');
  });

  it('is idempotent and refreshes the provenance', async () => {
    const first = await service.disable('openai', '111', 'first');
    const second = await service.disable('openai', '222', 'second');

    const disabled = await service.list();
    expect(disabled.size).toBe(1);
    expect(disabled.get('openai')).toEqual(second);
    expect(second.by).not.toBe(first.by);
  });
});

describe('ProviderSwitchService.enable', () => {
  it('removes the switch', async () => {
    await service.disable('openai', '777', null);
    await service.enable('openai', '777');

    await expect(service.list()).resolves.toEqual(new Map());
  });

  it('is a no-op for a provider that was never switched off', async () => {
    await expect(service.enable('groq', '777')).resolves.toBeUndefined();
    await expect(service.list()).resolves.toEqual(new Map());
  });

  it('leaves other providers switched off', async () => {
    await service.disable('openai', '777', null);
    await service.disable('gemini', '777', null);
    await service.enable('openai', '777');

    const disabled = await service.list();
    expect([...disabled.keys()]).toEqual(['gemini']);
  });
});
