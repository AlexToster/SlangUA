/**
 * Usage metrics without Redis.
 *
 * Three properties are worth pinning here, and none of them is "the counter goes
 * up". First, a bucket's expiry is derived from the bucket, not from the moment
 * of the write: two requests in the same minute must not extend that minute's
 * life, or a busy hour would outlive a quiet one and "the last hour" would mean
 * something different for every key. Second, an idle minute is data - the series
 * is zero-filled and always the configured length, because a graph that skips
 * quiet minutes lies about time. Third, only the internal user id is ever
 * stored: no Telegram id, no text.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { MetricsService } from '../../src/services/admin/metrics.service';

/**
 * An in-memory Redis with just the commands the service uses. Built inside
 * `vi.hoisted` because `vi.mock` runs before the module body, so a plain `const`
 * would still be in its temporal dead zone when the factory is first called.
 */
const redis = vi.hoisted(() => {
  const strings = new Map<string, number>();
  const zsets = new Map<string, Map<string, number>>();
  const expiries = new Map<string, number>();
  const state: { failCommand: string | null } = { failCommand: null };

  const zsetOf = (key: string) => {
    const existing = zsets.get(key);
    if (existing) return existing;
    const created = new Map<string, number>();
    zsets.set(key, created);
    return created;
  };

  /** Both `multi()` and `pipeline()` are the same queue; only exec() differs. */
  const queue = () => {
    const ops: (() => unknown)[] = [];
    const builder = {
      incr(key: string) {
        ops.push(() => strings.set(key, (strings.get(key) ?? 0) + 1));
        return builder;
      },
      expireat(key: string, at: number) {
        ops.push(() => expiries.set(key, at));
        return builder;
      },
      zincrby(key: string, by: number, member: string) {
        ops.push(() => zsetOf(key).set(member, (zsetOf(key).get(member) ?? 0) + by));
        return builder;
      },
      get(key: string) {
        ops.push(() => (strings.has(key) ? String(strings.get(key)) : null));
        return builder;
      },
      zcard(key: string) {
        ops.push(() => zsets.get(key)?.size ?? 0);
        return builder;
      },
      async exec() {
        if (state.failCommand === 'exec') throw new Error('EXECABORT');
        return ops.map((op) => {
          if (state.failCommand === 'get') return [new Error('LOADING Redis is loading'), null];
          return [null, op()];
        }) as [Error | null, unknown][];
      },
    };
    return builder;
  };

  return {
    strings,
    zsets,
    expiries,
    state,
    client: {
      multi: queue,
      pipeline: queue,
      async mget(keys: string[]) {
        return keys.map((key) => (strings.has(key) ? String(strings.get(key)) : null));
      },
      async zrevrange(key: string, start: number, stop: number, withScores?: string) {
        const zset: Map<string, number> = zsets.get(key) ?? new Map<string, number>();
        const entries = [...zset].sort((a, b) => b[1] - a[1]);
        const window = entries.slice(start, stop === -1 ? undefined : stop + 1);
        if (withScores !== 'WITHSCORES') return window.map(([member]) => member);
        return window.flatMap(([member, score]) => [member, String(score)]);
      },
    },
  };
});

vi.mock('../../src/lib/redis.js', () => ({
  getRedisClient: () => redis.client,
}));

const service = new MetricsService();

/** 2026-08-18T10:07:00.000Z - a fixed clock keeps every bucket name explicit. */
const NOON = Date.parse('2026-08-18T10:07:30.000Z');
const MINUTE = Math.floor(NOON / 60_000);
const DAY = '2026-08-18';

beforeEach(() => {
  redis.strings.clear();
  redis.zsets.clear();
  redis.expiries.clear();
  redis.state.failCommand = null;
});

describe('MetricsService.record', () => {
  it('counts a successful request in the minute and the UTC day', async () => {
    await service.record({ userId: 7, isError: false, at: NOON });

    expect(redis.strings.get(`metrics:req:m:${MINUTE}`)).toBe(1);
    expect(redis.strings.get(`metrics:req:d:${DAY}`)).toBe(1);
    // No error counters at all, rather than counters holding zero: a key that
    // does not exist costs nothing and reads back as 0 anyway.
    expect(redis.strings.has(`metrics:err:m:${MINUTE}`)).toBe(false);
    expect(redis.strings.has(`metrics:err:d:${DAY}`)).toBe(false);
  });

  it('counts a 5xx in both the request and the error counters', async () => {
    await service.record({ userId: 7, isError: true, at: NOON });

    expect(redis.strings.get(`metrics:req:m:${MINUTE}`)).toBe(1);
    expect(redis.strings.get(`metrics:err:m:${MINUTE}`)).toBe(1);
    expect(redis.strings.get(`metrics:err:d:${DAY}`)).toBe(1);
  });

  it('stores the internal user id and nothing else about the user', async () => {
    await service.record({ userId: 42, isError: false, at: NOON });

    const users: Map<string, number> =
      redis.zsets.get(`metrics:users:d:${DAY}`) ?? new Map<string, number>();
    expect([...users.keys()]).toEqual(['42']);
  });

  it('records an unauthenticated request without touching the user set', async () => {
    await service.record({ userId: null, isError: false, at: NOON });

    expect(redis.strings.get(`metrics:req:d:${DAY}`)).toBe(1);
    expect(redis.zsets.has(`metrics:users:d:${DAY}`)).toBe(false);
  });

  it('expires a bucket at a deadline fixed by the bucket, not by the write', async () => {
    await service.record({ userId: 1, isError: false, at: NOON });
    const minuteDeadline = redis.expiries.get(`metrics:req:m:${MINUTE}`);
    const dayDeadline = redis.expiries.get(`metrics:req:d:${DAY}`);

    // A second request 20 seconds later, still inside the same minute.
    await service.record({ userId: 1, isError: false, at: NOON + 20_000 });

    expect(redis.expiries.get(`metrics:req:m:${MINUTE}`)).toBe(minuteDeadline);
    expect(redis.expiries.get(`metrics:req:d:${DAY}`)).toBe(dayDeadline);

    // METRICS_MINUTE_SERIES_LENGTH is 5 in the unit env, plus two minutes of
    // slack, so the bucket outlives the last snapshot that can ask for it.
    expect(minuteDeadline).toBe(MINUTE * 60 + 7 * 60);
    // METRICS_RETENTION_DAYS is 3: the day ends, then three more days.
    expect(dayDeadline).toBe(Date.parse(`${DAY}T00:00:00.000Z`) / 1000 + 4 * 86400);
  });
});

describe('MetricsService.snapshot', () => {
  it('returns the configured number of minutes, oldest first, gaps as zeros', async () => {
    await service.record({ userId: 1, isError: false, at: NOON });
    await service.record({ userId: 1, isError: true, at: NOON - 2 * 60_000 });

    const snapshot = await service.snapshot(NOON);

    expect(snapshot.perMinute.minutes).toBe(5);
    expect(snapshot.perMinute.series).toHaveLength(5);
    expect(snapshot.perMinute.series.map((bucket) => bucket.requests)).toEqual([0, 0, 1, 0, 1]);
    expect(snapshot.perMinute.series.map((bucket) => bucket.errors)).toEqual([0, 0, 1, 0, 0]);
    // Oldest first, and every label is a whole minute.
    expect(snapshot.perMinute.series[0].startedAt).toBe(
      new Date((MINUTE - 4) * 60_000).toISOString()
    );
    expect(snapshot.perMinute.series[0].startedAt.endsWith(':00.000Z')).toBe(true);
  });

  it('puts today first and averages requests over the users seen', async () => {
    await service.record({ userId: 1, isError: false, at: NOON });
    await service.record({ userId: 1, isError: false, at: NOON });
    await service.record({ userId: 2, isError: true, at: NOON });
    // Yesterday, so the row order is observable.
    await service.record({ userId: 5, isError: false, at: NOON - 86_400_000 });

    const snapshot = await service.snapshot(NOON);

    expect(snapshot.daily).toHaveLength(3);
    expect(snapshot.daily[0]).toEqual({
      date: DAY,
      requests: 3,
      errors: 1,
      users: 2,
      averagePerUser: 1.5,
    });
    expect(snapshot.daily[1].date).toBe('2026-08-17');
    expect(snapshot.daily[1].requests).toBe(1);
    // A day with no traffic is a row of zeros, not a missing entry.
    expect(snapshot.daily[2]).toEqual({
      date: '2026-08-16',
      requests: 0,
      errors: 0,
      users: 0,
      averagePerUser: 0,
    });
  });

  it('ranks today the heaviest users and honours the configured cap', async () => {
    await service.record({ userId: 1, isError: false, at: NOON });
    for (let i = 0; i < 3; i += 1) await service.record({ userId: 2, isError: false, at: NOON });
    for (let i = 0; i < 2; i += 1) await service.record({ userId: 3, isError: false, at: NOON });

    const snapshot = await service.snapshot(NOON);

    // METRICS_TOP_USERS_LIMIT is 2 in the unit env.
    expect(snapshot.topUsers).toEqual([
      { userId: '2', requests: 3 },
      { userId: '3', requests: 2 },
    ]);
  });

  it('reports no traffic as zeros rather than as an empty page', async () => {
    const snapshot = await service.snapshot(NOON);

    expect(snapshot.perMinute.series.every((bucket) => bucket.requests === 0)).toBe(true);
    expect(snapshot.daily.every((day) => day.requests === 0 && day.averagePerUser === 0)).toBe(true);
    expect(snapshot.topUsers).toEqual([]);
    expect(snapshot.retentionDays).toBe(3);
    expect(snapshot.generatedAt).toBe(new Date(NOON).toISOString());
  });

  it('fails instead of reading a broken pipeline command as zero', async () => {
    // "No data" and "no traffic" look identical on a dashboard and mean opposite
    // things, so a failed read must not be smoothed into a number.
    redis.state.failCommand = 'get';

    await expect(service.snapshot(NOON)).rejects.toThrow(/LOADING/);
  });

  it('propagates a failed transaction', async () => {
    redis.state.failCommand = 'exec';

    await expect(service.snapshot(NOON)).rejects.toThrow(/EXECABORT/);
  });
});
