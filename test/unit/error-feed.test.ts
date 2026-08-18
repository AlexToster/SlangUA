/**
 * The error feed without Redis.
 *
 * What matters here is what the feed refuses to become. It is capped, so a burst
 * of failures cannot fill Redis; it is normalised, so a caller cannot smuggle a
 * long message or a stray field into it; and it tolerates a record put there by
 * hand during an incident by dropping it from the view instead of failing the
 * read. The pino logs remain the archive - this is a window.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  ErrorFeedService,
  ERROR_FEED_MESSAGE_MAX,
  type ErrorFeedEntry,
} from '../../src/services/admin/error-feed.service';

const redis = vi.hoisted(() => {
  const lists = new Map<string, string[]>();
  const expiries = new Map<string, number>();
  const state: { failWith: Error | null } = { failWith: null };

  const listOf = (key: string) => {
    const existing = lists.get(key);
    if (existing) return existing;
    const created: string[] = [];
    lists.set(key, created);
    return created;
  };

  const multi = () => {
    const ops: (() => unknown)[] = [];
    const builder = {
      lpush(key: string, value: string) {
        ops.push(() => listOf(key).unshift(value));
        return builder;
      },
      ltrim(key: string, start: number, stop: number) {
        ops.push(() => lists.set(key, listOf(key).slice(start, stop + 1)));
        return builder;
      },
      expire(key: string, seconds: number) {
        ops.push(() => expiries.set(key, seconds));
        return builder;
      },
      async exec() {
        if (state.failWith) throw state.failWith;
        return ops.map((op) => [null, op()]) as [Error | null, unknown][];
      },
    };
    return builder;
  };

  return {
    lists,
    expiries,
    state,
    client: {
      multi,
      async lrange(key: string, start: number, stop: number) {
        if (state.failWith) throw state.failWith;
        return listOf(key).slice(start, stop + 1);
      },
    },
  };
});

vi.mock('../../src/lib/redis.js', () => ({
  getRedisClient: () => redis.client,
}));

const service = new ErrorFeedService();

function entry(overrides: Partial<ErrorFeedEntry> = {}): ErrorFeedEntry {
  return {
    at: '2026-08-18T10:00:00.000Z',
    method: 'POST',
    route: '/api/v1/translate/preview',
    statusCode: 503,
    code: 'AI_PROVIDERS_UNAVAILABLE',
    message: 'All providers failed',
    userId: 7,
    requestId: 'req-1',
    ...overrides,
  };
}

const stored = () => redis.lists.get('admin:errors') ?? [];

beforeEach(() => {
  redis.lists.clear();
  redis.expiries.clear();
  redis.state.failWith = null;
});

describe('ErrorFeedService.record', () => {
  it('stores the entry and reads it back unchanged', async () => {
    const failure = entry();
    await service.record(failure);

    await expect(service.list()).resolves.toEqual([failure]);
  });

  it('keeps the newest entry first', async () => {
    await service.record(entry({ requestId: 'req-1' }));
    await service.record(entry({ requestId: 'req-2' }));

    const entries = await service.list();
    expect(entries.map((item) => item.requestId)).toEqual(['req-2', 'req-1']);
  });

  it('cannot grow past the configured cap', async () => {
    // ADMIN_ERROR_FEED_MAX is 3 in the unit env.
    for (let i = 1; i <= 6; i += 1) await service.record(entry({ requestId: `req-${i}` }));

    expect(stored()).toHaveLength(3);
    const entries = await service.list();
    expect(entries.map((item) => item.requestId)).toEqual(['req-6', 'req-5', 'req-4']);
  });

  it('refreshes the whole-key TTL on every write, so a quiet week empties it', async () => {
    await service.record(entry());

    expect(redis.expiries.get('admin:errors')).toBe(604800);
  });

  it('truncates a long message instead of storing it whole', async () => {
    await service.record(entry({ message: 'x'.repeat(ERROR_FEED_MESSAGE_MAX + 50) }));

    const [first] = await service.list();
    expect(first.message).toHaveLength(ERROR_FEED_MESSAGE_MAX);
    expect(first.message?.endsWith('…')).toBe(true);
  });

  it('stores a request with no user and no error code as nulls', async () => {
    await service.record(entry({ userId: null, code: null, message: null, requestId: null }));

    const [first] = await service.list();
    expect(first.userId).toBeNull();
    expect(first.code).toBeNull();
    expect(first.message).toBeNull();
    expect(first.requestId).toBeNull();
  });

  it('writes only the whitelisted fields', async () => {
    // A caller handing over an extra field - a body, a header, a token - must not
    // be able to put it into Redis just by widening the object it passes.
    await service.record({
      ...entry(),
      ...({ originalText: 'привіт', authorization: 'Bearer secret' } as Partial<ErrorFeedEntry>),
    });

    expect(stored()[0]).not.toContain('привіт');
    expect(stored()[0]).not.toContain('Bearer');
    expect(Object.keys(JSON.parse(stored()[0]) as object).sort()).toEqual([
      'at',
      'code',
      'message',
      'method',
      'requestId',
      'route',
      'statusCode',
      'userId',
    ]);
  });
});

describe('ErrorFeedService.list', () => {
  it('clamps a request for more than the feed can hold', async () => {
    for (let i = 1; i <= 3; i += 1) await service.record(entry({ requestId: `req-${i}` }));

    await expect(service.list(999)).resolves.toHaveLength(3);
  });

  it('honours a smaller limit', async () => {
    for (let i = 1; i <= 3; i += 1) await service.record(entry({ requestId: `req-${i}` }));

    const entries = await service.list(1);
    expect(entries.map((item) => item.requestId)).toEqual(['req-3']);
  });

  it('drops a hand-written record rather than failing the read', async () => {
    await service.record(entry({ requestId: 'req-1' }));
    redis.lists.get('admin:errors')?.unshift('{not json');

    const entries = await service.list();
    expect(entries.map((item) => item.requestId)).toEqual(['req-1']);
  });

  it('propagates a Redis failure instead of reporting an empty feed', async () => {
    // An empty feed must mean "nothing failed", never "nothing could be read".
    redis.state.failWith = new Error('CONNRESET');

    await expect(service.list()).rejects.toThrow(/CONNRESET/);
  });
});
