/**
 * Admin access integration tests.
 *
 * The subject here is not what the panel shows - it is who can reach it at all.
 * Two properties are load-bearing and both are asserted against a real Postgres
 * and a real Redis:
 *
 * 1. To anyone who is not on the allowlist, /api/v1/admin/* must be
 *    indistinguishable from a path that was never registered - the same 404 with
 *    the same body, never a 401 or 403 that would confirm the panel exists.
 * 2. Being on the allowlist is not enough: every route except the login itself
 *    also demands a step-up token obtained with the admin password, and that
 *    token is bound to the account that opened it.
 *
 * The admin ids and the password hash come from the `env` block of
 * vitest.integration.config.mjs (that one reaches the workers) and from
 * test/integration/global-setup.ts.
 */

import type { FastifyInstance } from 'fastify';

const ADMIN_PASSWORD = 'test-admin-password-not-real';
const ADMIN_TELEGRAM_ID = 555000111;
const SECOND_ADMIN_TELEGRAM_ID = 555000222;
const REGULAR_TELEGRAM_ID = 123456789;

let getAppInstance: () => FastifyInstance;
let getPrismaClient: () => any;
let truncateDatabase: () => Promise<void>;
let flushRedis: () => Promise<void>;
let generateValidInitData: (options?: any) => string;

describe('Admin access integration tests', () => {
  let app: FastifyInstance;
  let prisma: any;

  /** Logs a Telegram user in and returns its access token. */
  async function login(telegramId: number, firstName: string): Promise<string> {
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/telegram',
      payload: { initData: generateValidInitData({ user: { id: telegramId, first_name: firstName } }) },
    });
    expect(response.statusCode).toBe(200);
    return JSON.parse(response.body).accessToken;
  }

  /** Opens an admin session and returns the step-up token. */
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

  /** The body Fastify itself answers for a path that does not exist. */
  function notFoundBody(method: string, url: string) {
    return { message: `Route ${method}:${url} not found`, error: 'Not Found', statusCode: 404 };
  }

  let adminToken: string;
  let secondAdminToken: string;
  let userToken: string;

  beforeAll(async () => {
    await import('./setup-test-context.js').then((m) => m.setup());

    const testContext = await import('./test-context.js');
    getAppInstance = testContext.getAppInstance;
    getPrismaClient = testContext.getPrismaClient;
    truncateDatabase = testContext.truncateDatabase;
    flushRedis = testContext.flushRedis;

    const telegramInitData = await import('../helpers/telegram-initdata.js');
    generateValidInitData = telegramInitData.generateValidInitData;

    app = getAppInstance();
    prisma = getPrismaClient();
  });

  beforeEach(async () => {
    await flushRedis();
    await truncateDatabase();
    await prisma.user.deleteMany();

    adminToken = await login(ADMIN_TELEGRAM_ID, 'Admin');
    secondAdminToken = await login(SECOND_ADMIN_TELEGRAM_ID, 'Second');
    userToken = await login(REGULAR_TELEGRAM_ID, 'Test');
  });

  describe('invisibility to non-admins', () => {
    const routes: Array<{ method: 'GET' | 'POST' | 'DELETE' | 'PATCH'; url: string; payload?: unknown }> = [
      { method: 'POST', url: '/api/v1/admin/session', payload: { password: ADMIN_PASSWORD } },
      { method: 'DELETE', url: '/api/v1/admin/session' },
      { method: 'GET', url: '/api/v1/admin/overview' },
      // The kill-switch is part of the same door; what it does is asserted in
      // admin-providers.integration.test.ts.
      { method: 'PATCH', url: '/api/v1/admin/providers/ollama', payload: { disabled: true } },
    ];

    it.each(routes)('answers 404 with no credentials at all: $method $url', async ({ method, url, payload }) => {
      const response = await app.inject({ method, url, ...(payload ? { payload } : {}) });

      expect(response.statusCode).toBe(404);
      expect(JSON.parse(response.body)).toEqual(notFoundBody(method, url));
    });

    it.each(routes)('answers 404 to an authenticated non-admin: $method $url', async ({ method, url, payload }) => {
      const response = await app.inject({
        method,
        url,
        headers: { authorization: `Bearer ${userToken}` },
        ...(payload ? { payload } : {}),
      });

      // Not 401, not 403: either would tell a curious user that the panel is
      // there and only the password is missing.
      expect(response.statusCode).toBe(404);
      expect(JSON.parse(response.body)).toEqual(notFoundBody(method, url));
    });

    it('answers a non-admin exactly as it answers an unregistered path', async () => {
      const admin = await app.inject({
        method: 'GET',
        url: '/api/v1/admin/overview',
        headers: { authorization: `Bearer ${userToken}` },
      });
      const unregistered = await app.inject({
        method: 'GET',
        url: '/api/v1/no-such-route',
        headers: { authorization: `Bearer ${userToken}` },
      });

      expect(admin.statusCode).toBe(unregistered.statusCode);
      // Key order included: a client comparing raw bodies must not see a seam.
      expect(Object.keys(JSON.parse(admin.body))).toEqual(Object.keys(JSON.parse(unregistered.body)));
      expect(admin.headers['content-type']).toBe(unregistered.headers['content-type']);
    });

    it('answers 404 to an invalid or garbage access token', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/admin/overview',
        headers: { authorization: 'Bearer not-a-jwt' },
      });

      expect(response.statusCode).toBe(404);
    });

    // Regression: while the gate was a preHandler, Fastify validated the body
    // first, so these three answered 400 VALIDATION_ERROR - which confirms the
    // route exists just as plainly as a 403 would. The gate is an onRequest hook
    // now, so the body is never even parsed for a stranger.
    const malformed: Array<{ name: string; payload: Record<string, unknown> }> = [
      { name: 'an empty password', payload: { password: '' } },
      { name: 'no password field', payload: {} },
      { name: 'a wrong field type', payload: { password: 42 } },
    ];

    it.each(malformed)('answers 404 to a non-admin sending $name', async ({ payload }) => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/admin/session',
        headers: { authorization: `Bearer ${userToken}` },
        payload,
      });

      expect(response.statusCode).toBe(404);
      expect(JSON.parse(response.body)).toEqual(notFoundBody('POST', '/api/v1/admin/session'));
    });

    it('answers 404 to a non-admin sending unparseable JSON', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/admin/session',
        headers: { authorization: `Bearer ${userToken}`, 'content-type': 'application/json' },
        // A raw string payload: the body is unparseable on purpose, so it must
        // not go through the object serializer.
        payload: '{"password": ',
      });

      expect(response.statusCode).toBe(404);
      expect(JSON.parse(response.body)).toEqual(notFoundBody('POST', '/api/v1/admin/session'));
    });
  });

  describe('POST /admin/session', () => {
    it('refuses a wrong password with a neutral 401', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/admin/session',
        headers: { authorization: `Bearer ${adminToken}` },
        payload: { password: 'wrong-password-entirely' },
      });

      expect(response.statusCode).toBe(401);
      const body = JSON.parse(response.body);
      expect(body.code).toBe('ADMIN_PASSWORD_INVALID');
      // No hint about the hash, the attempt counter or the lockout state.
      expect(response.body).not.toContain('scrypt');
      expect(response.body).not.toContain('wrong-password-entirely');
      expect(response.headers['retry-after']).toBeUndefined();
    });

    it('rejects an empty password with a validation error', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/admin/session',
        headers: { authorization: `Bearer ${adminToken}` },
        payload: { password: '' },
      });

      expect(response.statusCode).toBe(400);
      expect(JSON.parse(response.body).code).toBe('VALIDATION_ERROR');
    });

    it('returns a token and both deadlines for the correct password', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/admin/session',
        headers: { authorization: `Bearer ${adminToken}` },
        payload: { password: ADMIN_PASSWORD },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(typeof body.token).toBe('string');
      expect(body.token.length).toBeGreaterThan(20);
      const expiresAt = Date.parse(body.expiresAt);
      const absoluteExpiresAt = Date.parse(body.absoluteExpiresAt);
      expect(expiresAt).toBeGreaterThan(Date.now());
      // The idle deadline never outlives the hard one.
      expect(absoluteExpiresAt).toBeGreaterThanOrEqual(expiresAt);
    });

    it('never stores the token itself in Redis', async () => {
      const token = await openAdminSession(adminToken);

      const { Redis } = await import('ioredis');
      const testContext = await import('./test-context.js');
      const redis = new Redis(testContext.getRedisUrl());
      try {
        const keys = await redis.keys('admin:session:*');
        expect(keys).toHaveLength(1);
        // The key is an HMAC of the token, so a Redis dump yields nothing usable.
        expect(keys[0]).not.toContain(token);
        const stored = await redis.hgetall(keys[0]);
        expect(JSON.stringify(stored)).not.toContain(token);
      } finally {
        await redis.quit();
      }
    });

    it('locks out after the configured number of failures, even for the right password', async () => {
      const maxFailures = Number(process.env.ADMIN_LOGIN_MAX_FAILURES ?? 5);

      for (let attempt = 1; attempt <= maxFailures; attempt++) {
        const response = await app.inject({
          method: 'POST',
          url: '/api/v1/admin/session',
          headers: { authorization: `Bearer ${adminToken}` },
          payload: { password: `wrong-attempt-${attempt}` },
        });
        expect(response.statusCode).toBe(401);
      }

      const afterLockout = await app.inject({
        method: 'POST',
        url: '/api/v1/admin/session',
        headers: { authorization: `Bearer ${adminToken}` },
        payload: { password: ADMIN_PASSWORD },
      });

      expect(afterLockout.statusCode).toBe(401);
      expect(JSON.parse(afterLockout.body).code).toBe('ADMIN_PASSWORD_INVALID');
      // The only difference from a plain wrong password: how long to wait.
      expect(Number(afterLockout.headers['retry-after'])).toBeGreaterThan(0);
    });

    it('counts failures per admin, not globally', async () => {
      const maxFailures = Number(process.env.ADMIN_LOGIN_MAX_FAILURES ?? 5);

      for (let attempt = 1; attempt <= maxFailures; attempt++) {
        await app.inject({
          method: 'POST',
          url: '/api/v1/admin/session',
          headers: { authorization: `Bearer ${adminToken}` },
          payload: { password: `wrong-attempt-${attempt}` },
        });
      }

      // The second admin never typed anything wrong and must still get in.
      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/admin/session',
        headers: { authorization: `Bearer ${secondAdminToken}` },
        payload: { password: ADMIN_PASSWORD },
      });

      expect(response.statusCode).toBe(200);
    });

    it('rate limits password attempts on top of the lockout', async () => {
      const maxAttempts = Number(process.env.ADMIN_LOGIN_RATE_LIMIT_MAX ?? 8);
      const responses: Array<{ statusCode: number; body: string }> = [];

      for (let attempt = 0; attempt <= maxAttempts; attempt++) {
        const response = await app.inject({
          method: 'POST',
          url: '/api/v1/admin/session',
          headers: { authorization: `Bearer ${adminToken}` },
          payload: { password: `wrong-again-${attempt}` },
        });
        responses.push({ statusCode: response.statusCode, body: response.body });
      }

      // Everything inside the budget is answered by the password check itself
      // (401, whether from the wrong password or from the lockout it triggers);
      // the request after the budget never reaches it.
      expect(responses.slice(0, maxAttempts).map((r) => r.statusCode)).toEqual(
        Array.from({ length: maxAttempts }, () => 401),
      );
      const last = responses[maxAttempts];
      expect(last.statusCode).toBe(429);
      expect(JSON.parse(last.body).code).toBe('RATE_LIMIT_EXCEEDED');
    });
  });

  describe('GET /admin/overview', () => {
    it('demands the step-up token from an allowlisted admin', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/admin/overview',
        headers: { authorization: `Bearer ${adminToken}` },
      });

      // 401 is safe here: only a proven admin ever sees it.
      expect(response.statusCode).toBe(401);
      expect(JSON.parse(response.body).code).toBe('ADMIN_SESSION_REQUIRED');
    });

    it('rejects a made-up step-up token', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/admin/overview',
        headers: { authorization: `Bearer ${adminToken}`, 'x-admin-token': 'a'.repeat(43) },
      });

      expect(response.statusCode).toBe(401);
      expect(JSON.parse(response.body).code).toBe('ADMIN_SESSION_INVALID');
    });

    it('returns the provider chain to a fully authenticated admin', async () => {
      const stepUpToken = await openAdminSession(adminToken);

      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/admin/overview',
        headers: { authorization: `Bearer ${adminToken}`, 'x-admin-token': stepUpToken },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.admin.telegramId).toBe(String(ADMIN_TELEGRAM_ID));
      expect(Array.isArray(body.providers)).toBe(true);
      expect(body.providers.length).toBeGreaterThan(0);
      // Health and operator intent are separate columns; the switch fields are
      // null while nobody has flipped anything. The exact object shape is
      // asserted, not just the presence of keys, because the panel renders every
      // one of them.
      expect(body.providers[0]).toEqual({
        id: expect.any(String),
        available: expect.any(Boolean),
        configured: expect.any(Boolean),
        priority: expect.any(Number),
        disabled: false,
        disabledAt: null,
        disabledBy: null,
        disabledReason: null,
      });
      // Sorted by the fallback order the AI service actually uses.
      const priorities = body.providers.map((provider: { priority: number }) => provider.priority);
      expect(priorities).toEqual([...priorities].sort((a, b) => a - b));
      // Nothing about keys, ever.
      expect(response.body).not.toMatch(/api[_-]?key/i);
      expect(response.body).not.toContain('sk-');
    });

    it('refuses a step-up token presented by a different admin', async () => {
      const stepUpToken = await openAdminSession(adminToken);

      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/admin/overview',
        headers: { authorization: `Bearer ${secondAdminToken}`, 'x-admin-token': stepUpToken },
      });

      expect(response.statusCode).toBe(401);
      expect(JSON.parse(response.body).code).toBe('ADMIN_SESSION_INVALID');

      // The mismatch revokes the session rather than leaving it open.
      const afterwards = await app.inject({
        method: 'GET',
        url: '/api/v1/admin/overview',
        headers: { authorization: `Bearer ${adminToken}`, 'x-admin-token': stepUpToken },
      });
      expect(afterwards.statusCode).toBe(401);
    });

    it('is invisible to a non-admin even with a valid step-up token', async () => {
      const stepUpToken = await openAdminSession(adminToken);

      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/admin/overview',
        headers: { authorization: `Bearer ${userToken}`, 'x-admin-token': stepUpToken },
      });

      expect(response.statusCode).toBe(404);
    });
  });

  describe('DELETE /admin/session', () => {
    it('closes the panel and leaves the Telegram login untouched', async () => {
      const stepUpToken = await openAdminSession(adminToken);

      const closed = await app.inject({
        method: 'DELETE',
        url: '/api/v1/admin/session',
        headers: { authorization: `Bearer ${adminToken}`, 'x-admin-token': stepUpToken },
      });
      expect(closed.statusCode).toBe(204);

      const afterwards = await app.inject({
        method: 'GET',
        url: '/api/v1/admin/overview',
        headers: { authorization: `Bearer ${adminToken}`, 'x-admin-token': stepUpToken },
      });
      expect(afterwards.statusCode).toBe(401);
      expect(JSON.parse(afterwards.body).code).toBe('ADMIN_SESSION_INVALID');

      // Still logged in as a normal user.
      const profile = await app.inject({
        method: 'GET',
        url: '/api/v1/user/me',
        headers: { authorization: `Bearer ${adminToken}` },
      });
      expect(profile.statusCode).toBe(200);
    });

    it('lets an operator log in again after locking the panel', async () => {
      const firstToken = await openAdminSession(adminToken);
      await app.inject({
        method: 'DELETE',
        url: '/api/v1/admin/session',
        headers: { authorization: `Bearer ${adminToken}`, 'x-admin-token': firstToken },
      });

      const secondToken = await openAdminSession(adminToken);
      expect(secondToken).not.toBe(firstToken);

      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/admin/overview',
        headers: { authorization: `Bearer ${adminToken}`, 'x-admin-token': secondToken },
      });
      expect(response.statusCode).toBe(200);
    });
  });

  describe('isAdmin on the profile', () => {
    it('is true for an allowlisted Telegram id', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/user/me',
        headers: { authorization: `Bearer ${adminToken}` },
      });

      expect(response.statusCode).toBe(200);
      expect(JSON.parse(response.body).isAdmin).toBe(true);
    });

    it('is false for everyone else', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/user/me',
        headers: { authorization: `Bearer ${userToken}` },
      });

      expect(response.statusCode).toBe(200);
      expect(JSON.parse(response.body).isAdmin).toBe(false);
    });

    it('is present in the PATCH answer too', async () => {
      // The client replaces its cached profile with this response, so a missing
      // flag here would make the admin entry point vanish after any settings
      // change.
      const response = await app.inject({
        method: 'PATCH',
        url: '/api/v1/user/me',
        headers: { authorization: `Bearer ${adminToken}` },
        payload: { ageConfirmedAdult: true },
      });

      expect(response.statusCode).toBe(200);
      expect(JSON.parse(response.body).isAdmin).toBe(true);
    });

    it('cannot be set by the client', async () => {
      const response = await app.inject({
        method: 'PATCH',
        url: '/api/v1/user/me',
        headers: { authorization: `Bearer ${userToken}` },
        payload: { isAdmin: true },
      });

      expect(response.statusCode).toBe(400);
      expect(JSON.parse(response.body).code).toBe('VALIDATION_ERROR');
    });
  });
});
