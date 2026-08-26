/**
 * Usage metrics integration tests (stage C).
 *
 * The unit test proves the arithmetic against a fake Redis. This proves the wire
 * that makes the arithmetic happen: that an ordinary request is counted by the
 * `onResponse` hook, that the panel is invisible to everyone the stage A door
 * keeps out, and - the part that is easy to get wrong - that the things which
 * must *not* be counted are not. Health probes run on a timer and would put a
 * constant floor under the graph; the panel polls itself and would inflate the
 * numbers of whoever is looking at them.
 *
 * The hook runs after the reply has been sent, so a counter may land a tick after
 * `inject()` resolves. Every assertion about a number therefore polls until the
 * number moves, and the deltas are measured against a snapshot rather than
 * against zero: minting the tokens in `beforeEach` is itself traffic.
 */

import type { FastifyInstance } from 'fastify';
import type { PrismaClient } from '@prisma/client';

const ADMIN_PASSWORD = 'test-admin-password-not-real';
const ADMIN_TELEGRAM_ID = 555000111;
const REGULAR_TELEGRAM_ID = 123456789;

/** Must match the `env` block of vitest.integration.config.mjs. */
const SERIES_LENGTH = 10;
const RETENTION_DAYS = 2;
const TOP_USERS_LIMIT = 5;

let getAppInstance: () => FastifyInstance;
let getPrismaClient: () => PrismaClient;
let truncateDatabase: () => Promise<void>;
let flushRedis: () => Promise<void>;
let generateValidInitData: (options?: any) => string;
let setMockConfig: (config: any) => void;

interface MinuteBucket {
  startedAt: string;
  requests: number;
  errors: number;
}

interface HourBucket {
  startedAt: string;
  requests: number;
  errors: number;
}

interface DayBucket {
  date: string;
  requests: number;
  errors: number;
  users: number;
  averagePerUser: number;
}

interface Metrics {
  generatedAt: string;
  retentionDays: number;
  totalUsers: number;
  perMinute: { minutes: number; series: MinuteBucket[] };
  last24h: { hours: number; requests: number; errors: number; users: number; series: HourBucket[] };
  daily: DayBucket[];
  topUsers: { userId: string; requests: number }[];
}

describe('Admin usage metrics integration tests', () => {
  let app: FastifyInstance;
  let adminToken: string;
  let userToken: string;
  let stepUp: string;
  let userId: number;

  async function login(telegramId: number, firstName: string): Promise<string> {
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/telegram',
      payload: { initData: generateValidInitData({ user: { id: telegramId, first_name: firstName } }) },
    });
    expect(response.statusCode).toBe(200);
    return JSON.parse(response.body).accessToken;
  }

  async function openAdminSession(accessToken: string): Promise<string> {
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/admin/session',
      headers: { authorization: `Bearer ${accessToken}` },
      payload: { password: ADMIN_PASSWORD },
    });
    expect(response.statusCode).toBe(200);
    return JSON.parse(response.body).token;
  }

  /** The panel's own read. Excluded from the counters, so calling it is free. */
  async function metrics(): Promise<Metrics> {
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/admin/metrics',
      headers: { authorization: `Bearer ${adminToken}`, 'x-admin-token': stepUp },
    });
    expect(response.statusCode).toBe(200);
    return JSON.parse(response.body) as Metrics;
  }

  /**
   * Polls the panel until it agrees. The `onResponse` hook writes after the reply
   * is out, so "the counter has not moved yet" and "the counter never moves" are
   * different failures and only one of them deserves a red test.
   */
  async function waitForMetrics(predicate: (value: Metrics) => boolean): Promise<Metrics> {
    let last: Metrics | null = null;
    for (let attempt = 0; attempt < 20; attempt += 1) {
      last = await metrics();
      if (predicate(last)) return last;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    throw new Error(`The metric never arrived. Last snapshot: ${JSON.stringify(last)}`);
  }

  async function preview() {
    return app.inject({
      method: 'POST',
      url: '/api/v1/translate/preview',
      headers: { authorization: `Bearer ${userToken}` },
      payload: { text: 'Привіт, як справи?', style: 'GEN_Z' },
    });
  }

  const today = () => new Date().toISOString().slice(0, 10);

  beforeAll(async () => {
    await import('./setup-test-context.js').then((m) => m.setup());

    const testContext = await import('./test-context.js');
    getAppInstance = testContext.getAppInstance;
    getPrismaClient = testContext.getPrismaClient;
    truncateDatabase = testContext.truncateDatabase;
    flushRedis = testContext.flushRedis;

    const telegramInitData = await import('../helpers/telegram-initdata.js');
    generateValidInitData = telegramInitData.generateValidInitData;

    const mockOllama = await import('../helpers/mock-ollama-server.js');
    setMockConfig = mockOllama.setMockConfig;

    app = getAppInstance();
  });

  beforeEach(async () => {
    // Flushing Redis clears the counters as well as the session store, so the
    // tokens must be minted afterwards - and those two logins are themselves
    // counted, which is why every assertion below is a delta.
    await flushRedis();
    await truncateDatabase();
    setMockConfig({ shouldFail: false });

    adminToken = await login(ADMIN_TELEGRAM_ID, 'Admin');
    userToken = await login(REGULAR_TELEGRAM_ID, 'Test');
    stepUp = await openAdminSession(adminToken);

    // The user row survives truncation (only Translation and RefreshToken are
    // truncated), so this id is stable across the whole file.
    const user = await getPrismaClient().user.findUniqueOrThrow({
      where: { telegramId: String(REGULAR_TELEGRAM_ID) },
      select: { id: true },
    });
    userId = user.id;
  });

  describe('GET /admin/metrics', () => {
    it('answers with the shape the panel draws, sized by configuration', async () => {
      const snapshot = await metrics();

      expect(Date.parse(snapshot.generatedAt)).not.toBeNaN();
      expect(snapshot.retentionDays).toBe(RETENTION_DAYS);
      expect(snapshot.perMinute.minutes).toBe(SERIES_LENGTH);
      // Always the full window, even with no traffic: a graph that skips quiet
      // minutes lies about time.
      expect(snapshot.perMinute.series).toHaveLength(SERIES_LENGTH);
      expect(snapshot.daily).toHaveLength(RETENTION_DAYS);
      expect(snapshot.daily[0].date).toBe(today());
      // The rolling window is fixed at 24 hours, not configurable: the heading
      // the panel prints would otherwise be a lie in some deployment.
      expect(snapshot.last24h.hours).toBe(24);
      expect(snapshot.last24h.series).toHaveLength(24);
    });

    it('labels every hour bucket on the hour, oldest first, ending with now', async () => {
      const { series } = (await metrics()).last24h;

      for (const bucket of series) {
        expect(bucket.startedAt).toMatch(/:00:00\.000Z$/);
      }
      const timestamps = series.map((bucket) => Date.parse(bucket.startedAt));
      for (let i = 1; i < timestamps.length; i += 1) {
        expect(timestamps[i] - timestamps[i - 1]).toBe(3_600_000);
      }
      // The current hour is the last bucket, which is what makes the window
      // roll instead of ending at midnight.
      const currentHour = Math.floor(Date.now() / 3_600_000) * 3_600_000;
      expect(timestamps[23]).toBe(currentHour);
    });

    it('counts a real request in the rolling window as well as the day', async () => {
      const before = await metrics();
      expect((await preview()).statusCode).toBe(200);

      const after = await waitForMetrics(
        (snapshot) => snapshot.last24h.requests === before.last24h.requests + 1
      );

      // The same request, in the newest hour bucket and in the window total.
      expect(after.last24h.series[23].requests).toBe(before.last24h.series[23].requests + 1);
      expect(after.last24h.users).toBeGreaterThanOrEqual(1);
      expect(after.daily[0].requests).toBe(before.daily[0].requests + 1);
    });

    it('counts every account ever created, from the database and not from Redis', async () => {
      // Redis buckets expire; accounts do not. The two logins in beforeEach are
      // the floor here, and the figure must not move when traffic does.
      const before = await metrics();
      expect(before.totalUsers).toBe(await getPrismaClient().user.count());
      expect(before.totalUsers).toBeGreaterThanOrEqual(2);

      expect((await preview()).statusCode).toBe(200);
      const after = await waitForMetrics(
        (snapshot) => snapshot.daily[0].requests > before.daily[0].requests
      );

      // More traffic from the same people is not more people.
      expect(after.totalUsers).toBe(before.totalUsers);
    });

    it('labels every minute bucket on the minute, oldest first', async () => {
      const { series } = (await metrics()).perMinute;

      for (const bucket of series) {
        expect(bucket.startedAt).toMatch(/:00\.000Z$/);
      }
      const timestamps = series.map((bucket) => Date.parse(bucket.startedAt));
      const ascending = [...timestamps].sort((a, b) => a - b);
      expect(timestamps).toEqual(ascending);
      // Consecutive minutes, no gaps.
      for (let i = 1; i < timestamps.length; i += 1) {
        expect(timestamps[i] - timestamps[i - 1]).toBe(60_000);
      }
    });

    it('counts a real request in the minute series and the day', async () => {
      const before = await metrics();
      expect((await preview()).statusCode).toBe(200);

      const after = await waitForMetrics(
        (snapshot) => snapshot.daily[0].requests === before.daily[0].requests + 1
      );

      // The same request, counted once in each resolution.
      const sum = (series: MinuteBucket[]) => series.reduce((total, b) => total + b.requests, 0);
      expect(sum(after.perMinute.series)).toBe(sum(before.perMinute.series) + 1);
      expect(after.daily[0].errors).toBe(before.daily[0].errors);
    });

    it('counts a 5xx as both a request and an error', async () => {
      setMockConfig({ shouldFail: true });
      const before = await metrics();

      const response = await preview();
      expect(response.statusCode).toBe(503);

      const after = await waitForMetrics(
        (snapshot) => snapshot.daily[0].errors === before.daily[0].errors + 1
      );
      // An error is a request that failed, not a separate kind of event.
      expect(after.daily[0].requests).toBe(before.daily[0].requests + 1);
    });

    it('does not count a 4xx as an error', async () => {
      const before = await metrics();

      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/translate/preview',
        headers: { authorization: `Bearer ${userToken}` },
        payload: { text: '', style: 'GEN_Z' },
      });
      expect(response.statusCode).toBe(400);

      const after = await waitForMetrics(
        (snapshot) => snapshot.daily[0].requests === before.daily[0].requests + 1
      );
      // A rejected payload is the client's mistake and says nothing about our
      // health, so it moves the traffic line and not the error line.
      expect(after.daily[0].errors).toBe(before.daily[0].errors);
    });

    it('ranks the user by internal id and averages over the users it saw', async () => {
      const before = await metrics();
      expect((await preview()).statusCode).toBe(200);
      expect((await preview()).statusCode).toBe(200);

      const after = await waitForMetrics(
        (snapshot) => snapshot.daily[0].requests >= before.daily[0].requests + 2
      );

      const row = after.topUsers.find((entry) => entry.userId === String(userId));
      expect(row).toBeDefined();
      expect(row!.requests).toBeGreaterThanOrEqual(2);
      expect(after.topUsers.length).toBeLessThanOrEqual(TOP_USERS_LIMIT);
      // Descending, so the panel can render the list as it arrives.
      const counts = after.topUsers.map((entry) => entry.requests);
      expect(counts).toEqual([...counts].sort((a, b) => b - a));

      expect(after.daily[0].users).toBeGreaterThanOrEqual(1);
      // Rounded to two decimals, exactly as the service computes it.
      expect(after.daily[0].averagePerUser).toBe(
        Math.round((after.daily[0].requests / after.daily[0].users) * 100) / 100
      );
    });

    it('does not count itself', async () => {
      // Otherwise an operator watching the load page would be watching himself.
      const first = await metrics();
      await metrics();
      await metrics();
      const last = await metrics();

      expect(last.daily[0].requests).toBe(first.daily[0].requests);
      expect(last.topUsers.map((entry) => entry.userId)).not.toContain(String(userId));
    });

    it('does not count health probes', async () => {
      const before = await metrics();

      expect((await app.inject({ method: 'GET', url: '/health' })).statusCode).toBe(200);
      await app.inject({ method: 'GET', url: '/health/ready' });

      // Nothing to wait for, so give a late write time to arrive and prove it
      // never does.
      await new Promise((resolve) => setTimeout(resolve, 300));
      const after = await metrics();
      expect(after.daily[0].requests).toBe(before.daily[0].requests);
    });

    it('does not count a CORS preflight', async () => {
      const before = await metrics();

      await app.inject({
        method: 'OPTIONS',
        url: '/api/v1/translate/preview',
        headers: {
          origin: 'http://localhost:5173',
          'access-control-request-method': 'POST',
        },
      });

      await new Promise((resolve) => setTimeout(resolve, 300));
      const after = await metrics();
      // A preflight would double every number a Mini App request produces.
      expect(after.daily[0].requests).toBe(before.daily[0].requests);
    });

    it('never carries a Telegram id or request text', async () => {
      expect((await preview()).statusCode).toBe(200);
      await waitForMetrics((snapshot) => snapshot.daily[0].requests > 0);

      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/admin/metrics',
        headers: { authorization: `Bearer ${adminToken}`, 'x-admin-token': stepUp },
      });

      expect(response.body).not.toContain(String(REGULAR_TELEGRAM_ID));
      expect(response.body).not.toContain(String(ADMIN_TELEGRAM_ID));
      expect(response.body).not.toContain('Привіт');
      expect(response.body).not.toMatch(/api[_-]?key/i);
    });
  });

  describe('the door in front of the metrics', () => {
    it('is invisible to an authenticated non-admin', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/admin/metrics',
        headers: { authorization: `Bearer ${userToken}`, 'x-admin-token': stepUp },
      });

      expect(response.statusCode).toBe(404);
      expect(JSON.parse(response.body)).toEqual({
        message: 'Route GET:/api/v1/admin/metrics not found',
        error: 'Not Found',
        statusCode: 404,
      });
    });

    it('answers 404 with no credentials at all', async () => {
      const response = await app.inject({ method: 'GET', url: '/api/v1/admin/metrics' });

      expect(response.statusCode).toBe(404);
    });

    it('demands the step-up token from an allowlisted admin', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/admin/metrics',
        headers: { authorization: `Bearer ${adminToken}` },
      });

      expect(response.statusCode).toBe(401);
      expect(JSON.parse(response.body).code).toBe('ADMIN_SESSION_REQUIRED');
    });

    it('stops answering once the panel is locked', async () => {
      await app.inject({
        method: 'DELETE',
        url: '/api/v1/admin/session',
        headers: { authorization: `Bearer ${adminToken}`, 'x-admin-token': stepUp },
      });

      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/admin/metrics',
        headers: { authorization: `Bearer ${adminToken}`, 'x-admin-token': stepUp },
      });

      expect(response.statusCode).toBe(401);
      expect(JSON.parse(response.body).code).toBe('ADMIN_SESSION_INVALID');
    });
  });
});
