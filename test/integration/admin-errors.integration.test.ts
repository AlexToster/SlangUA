/**
 * Error feed integration tests (stage D).
 *
 * Two questions, and the second one matters more than the first. Does a real
 * failure reach the feed - and does anything else? The feed is the one place
 * where an operator reads what the client was not told, so what it may contain is
 * a whitelist: a status code, a route pattern, our own error code, a truncated
 * technical message, the internal user id and the request id. Not the text
 * somebody asked to translate, not a Telegram id, not a header.
 *
 * A failure is produced the way it happens in production - the mock provider is
 * told to fail, so `POST /translate/preview` answers 503 through the handler's
 * own catch block rather than through the global error handler. That path is the
 * common one, and it is exactly the path that used to leave the feed a bare 5xx
 * with no cause.
 */

import type { FastifyInstance } from 'fastify';
import type { PrismaClient } from '@prisma/client';

const ADMIN_PASSWORD = 'test-admin-password-not-real';
const ADMIN_TELEGRAM_ID = 555000111;
const REGULAR_TELEGRAM_ID = 123456789;

/** Must match the `env` block of vitest.integration.config.mjs. */
const FEED_MAX = 5;
const FEED_TTL_SECONDS = 3600;

/** The text of the request that fails. Must never appear in the feed. */
const SECRET_TEXT = 'Це приватний текст користувача';

let getAppInstance: () => FastifyInstance;
let getPrismaClient: () => PrismaClient;
let getRedisUrl: () => string;
let truncateDatabase: () => Promise<void>;
let flushRedis: () => Promise<void>;
let generateValidInitData: (options?: any) => string;
let setMockConfig: (config: any) => void;

interface FeedEntry {
  at: string;
  method: string;
  route: string;
  statusCode: number;
  code: string | null;
  message: string | null;
  userId: number | null;
  requestId: string | null;
}

interface Feed {
  generatedAt: string;
  max: number;
  retentionSeconds: number;
  entries: FeedEntry[];
}

describe('Admin error feed integration tests', () => {
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

  async function readFeed(query = ''): Promise<Feed> {
    const response = await app.inject({
      method: 'GET',
      url: `/api/v1/admin/errors${query}`,
      headers: { authorization: `Bearer ${adminToken}`, 'x-admin-token': stepUp },
    });
    expect(response.statusCode).toBe(200);
    return JSON.parse(response.body) as Feed;
  }

  /** The feed is written on `onResponse`, so it can land after inject resolves. */
  async function waitForFeed(count: number): Promise<Feed> {
    let last: Feed | null = null;
    for (let attempt = 0; attempt < 20; attempt += 1) {
      last = await readFeed();
      if (last.entries.length >= count) return last;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    throw new Error(`The feed never reached ${count} entries. Last read: ${JSON.stringify(last)}`);
  }

  /** One failing translation: the realistic 5xx of this application. */
  async function failingPreview(text = SECRET_TEXT) {
    setMockConfig({ shouldFail: true });
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/translate/preview',
      headers: { authorization: `Bearer ${userToken}` },
      payload: { text, style: 'GEN_Z' },
    });
    expect(response.statusCode).toBe(503);
    return response;
  }

  beforeAll(async () => {
    await import('./setup-test-context.js').then((m) => m.setup());

    const testContext = await import('./test-context.js');
    getAppInstance = testContext.getAppInstance;
    getPrismaClient = testContext.getPrismaClient;
    getRedisUrl = testContext.getRedisUrl;
    truncateDatabase = testContext.truncateDatabase;
    flushRedis = testContext.flushRedis;

    const telegramInitData = await import('../helpers/telegram-initdata.js');
    generateValidInitData = telegramInitData.generateValidInitData;

    const mockOllama = await import('../helpers/mock-ollama-server.js');
    setMockConfig = mockOllama.setMockConfig;

    app = getAppInstance();
  });

  beforeEach(async () => {
    await flushRedis();
    await truncateDatabase();
    setMockConfig({ shouldFail: false });

    adminToken = await login(ADMIN_TELEGRAM_ID, 'Admin');
    userToken = await login(REGULAR_TELEGRAM_ID, 'Test');
    stepUp = await openAdminSession(adminToken);

    const user = await getPrismaClient().user.findUniqueOrThrow({
      where: { telegramId: String(REGULAR_TELEGRAM_ID) },
      select: { id: true },
    });
    userId = user.id;

    // One successful translation closes the in-memory circuit breaker that the
    // failing tests open a notch. Without it the induced failures would
    // accumulate across tests and eventually take the provider out of the chain
    // for a minute, which is not what any of these tests is about.
    const warmUp = await app.inject({
      method: 'POST',
      url: '/api/v1/translate/preview',
      headers: { authorization: `Bearer ${userToken}` },
      payload: { text: 'Привіт', style: 'GEN_Z' },
    });
    expect(warmUp.statusCode).toBe(200);
  });

  describe('GET /admin/errors', () => {
    it('reports an empty feed as empty, with the configured bounds', async () => {
      const feed = await readFeed();

      expect(Date.parse(feed.generatedAt)).not.toBeNaN();
      expect(feed.max).toBe(FEED_MAX);
      expect(feed.retentionSeconds).toBe(FEED_TTL_SECONDS);
      // An empty list, not a missing field: "nothing failed" is an answer.
      expect(feed.entries).toEqual([]);
    });

    it('records a real 5xx with the cause the client was not told', async () => {
      await failingPreview();

      const feed = await waitForFeed(1);
      const [entry] = feed.entries;

      expect(entry.statusCode).toBe(503);
      expect(entry.method).toBe('POST');
      expect(entry.route).toBe('/api/v1/translate/preview');
      // The code the client saw, and the technical message it did not.
      expect(entry.code).toBe('AI_PROVIDER_UNAVAILABLE');
      expect(entry.message).toContain('AI providers');
      expect(entry.userId).toBe(userId);
      expect(entry.requestId).toBeTruthy();
      expect(Date.parse(entry.at)).not.toBeNaN();
    });

    it('never carries the text of the request that failed', async () => {
      await failingPreview();
      await waitForFeed(1);

      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/admin/errors',
        headers: { authorization: `Bearer ${adminToken}`, 'x-admin-token': stepUp },
      });

      expect(response.body).not.toContain(SECRET_TEXT);
      expect(response.body).not.toContain('приватний');
      // Nor anything that identifies the person outside our own database.
      expect(response.body).not.toContain(String(REGULAR_TELEGRAM_ID));
      expect(response.body).not.toContain(String(ADMIN_TELEGRAM_ID));
      expect(response.body).not.toMatch(/api[_-]?key/i);
      expect(response.body).not.toContain('Bearer');
    });

    it('keeps the newest failure first', async () => {
      await failingPreview('Перший запит, що впав');
      const first = await waitForFeed(1);
      await failingPreview('Другий запит, що впав');
      const both = await waitForFeed(2);

      expect(both.entries).toHaveLength(2);
      expect(both.entries[1].at).toBe(first.entries[0].at);
      expect(Date.parse(both.entries[0].at)).toBeGreaterThanOrEqual(
        Date.parse(both.entries[1].at)
      );
    });

    it('ignores a 4xx: a rejected payload is the client mistake, not our failure', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/translate/preview',
        headers: { authorization: `Bearer ${userToken}` },
        payload: { text: '', style: 'GEN_Z' },
      });
      expect(response.statusCode).toBe(400);

      // Nothing to wait for, so wait for a late write and prove it never comes.
      await new Promise((resolve) => setTimeout(resolve, 300));
      expect((await readFeed()).entries).toEqual([]);
    });

    it('does not record its own reads', async () => {
      await readFeed();
      await readFeed();

      // A broken panel must not be able to fill the feed it is showing.
      await new Promise((resolve) => setTimeout(resolve, 300));
      expect((await readFeed()).entries).toEqual([]);
    });

    it('honours a smaller limit and clamps a larger one', async () => {
      await failingPreview('Перший');
      await waitForFeed(1);
      await failingPreview('Другий');
      await waitForFeed(2);

      expect((await readFeed('?limit=1')).entries).toHaveLength(1);
      // Asking for more than the deployment keeps is not a client error: the
      // client cannot know the cap.
      expect((await readFeed('?limit=9999')).entries).toHaveLength(2);
    });

    const badLimits = ['?limit=0', '?limit=-1', '?limit=abc', '?limit=1.5'];

    it.each(badLimits)('rejects %s with 400', async (query) => {
      const response = await app.inject({
        method: 'GET',
        url: `/api/v1/admin/errors${query}`,
        headers: { authorization: `Bearer ${adminToken}`, 'x-admin-token': stepUp },
      });

      expect(response.statusCode).toBe(400);
      expect(JSON.parse(response.body).code).toBe('VALIDATION_ERROR');
    });

    it('stores the feed as one capped, expiring Redis list', async () => {
      await failingPreview();
      await waitForFeed(1);

      const { Redis } = await import('ioredis');
      const redis = new Redis(getRedisUrl());
      try {
        expect(await redis.llen('admin:errors')).toBeLessThanOrEqual(FEED_MAX);
        const ttl = await redis.ttl('admin:errors');
        // Unlike the kill-switch, this key must expire: a quiet week has to empty
        // it by itself, because nothing prunes it.
        expect(ttl).toBeGreaterThan(0);
        expect(ttl).toBeLessThanOrEqual(FEED_TTL_SECONDS);
      } finally {
        await redis.quit();
      }
    });

    it('offers no way to clear itself', async () => {
      // A "clear" button on a diagnostic view mostly invites hiding evidence, so
      // there is no such route even for a fully authenticated admin.
      const response = await app.inject({
        method: 'DELETE',
        url: '/api/v1/admin/errors',
        headers: { authorization: `Bearer ${adminToken}`, 'x-admin-token': stepUp },
      });

      expect(response.statusCode).toBe(404);
    });
  });

  describe('the door in front of the feed', () => {
    it('is invisible to an authenticated non-admin', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/admin/errors',
        headers: { authorization: `Bearer ${userToken}`, 'x-admin-token': stepUp },
      });

      expect(response.statusCode).toBe(404);
      expect(JSON.parse(response.body)).toEqual({
        message: 'Route GET:/api/v1/admin/errors not found',
        error: 'Not Found',
        statusCode: 404,
      });
    });

    it('answers 404 with no credentials at all', async () => {
      const response = await app.inject({ method: 'GET', url: '/api/v1/admin/errors' });

      expect(response.statusCode).toBe(404);
    });

    it('demands the step-up token from an allowlisted admin', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/admin/errors',
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
        url: '/api/v1/admin/errors',
        headers: { authorization: `Bearer ${adminToken}`, 'x-admin-token': stepUp },
      });

      expect(response.statusCode).toBe(401);
      expect(JSON.parse(response.body).code).toBe('ADMIN_SESSION_INVALID');
    });
  });
});
