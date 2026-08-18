import type { FastifyInstance } from 'fastify';
import Redis from 'ioredis';

// All imports moved to beforeAll to ensure globalSetup runs first
let getAppInstance: () => FastifyInstance;
let getPrismaClient: () => any;
let getRedisUrl: () => string;
let truncateDatabase: () => Promise<void>;
let flushRedis: () => Promise<void>;
let generateValidInitData: (options?: any) => string;

function sessionFrom(response: any): { cookie: string; csrf: string } {
  const setCookie = response.headers['set-cookie'];
  const cookies = (Array.isArray(setCookie) ? setCookie : [setCookie]) as string[];
  const pairs = cookies.map((cookie) => cookie.split(';', 1)[0]);
  const csrf = pairs.find((cookie) => cookie.startsWith('slangua_csrf='));
  if (!csrf) throw new Error('CSRF cookie missing');
  return { cookie: pairs.join('; '), csrf: decodeURIComponent(csrf.slice('slangua_csrf='.length)) };
}

describe('Rate Limit Integration Tests', () => {
  let app: FastifyInstance;
  let prisma: any;
  let accessToken: string;

  /**
   * The token-minting endpoints have their own budget, separate from the generic
   * per-user limit. Read it instead of hardcoding a count, so the suite follows
   * vitest.integration.config.mjs rather than silently passing when a limiter is
   * wired to the wrong variable.
   */
  const authLimit = Number(process.env.AUTH_RATE_LIMIT_MAX_REQUESTS ?? '20');
  const refreshLimit = Number(process.env.REFRESH_RATE_LIMIT_MAX_REQUESTS ?? '20');

  beforeAll(async () => {
    // Initialize test context (singleton - runs once)
    await import('./setup-test-context.js').then(m => m.setup());
    
    // Lazy imports - these run after globalSetup has completed
    const testContext = await import('./test-context.js');
    getAppInstance = testContext.getAppInstance;
    getPrismaClient = testContext.getPrismaClient;
    getRedisUrl = testContext.getRedisUrl;
    truncateDatabase = testContext.truncateDatabase;
    flushRedis = testContext.flushRedis;
    
    const telegramInitData = await import('../helpers/telegram-initdata.js');
    generateValidInitData = telegramInitData.generateValidInitData;
    
    app = getAppInstance();
    prisma = getPrismaClient();

    // Create a test user and get access token
    const initData = generateValidInitData({ user: { id: 666666001, first_name: 'Rate', last_name: 'Limit', username: 'ratelimittest' } });
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/telegram',
      payload: { initData },
    });
    const body = JSON.parse(response.body);
    accessToken = body.accessToken;
  });

  afterAll(async () => {
    // Don't close the shared app instance - handled by global teardown
  });

  beforeEach(async () => {
    // Flush Redis between tests using shared function
    await flushRedis();

    // Clean up any test data
    await prisma.translation.deleteMany({
      where: { userId: 666666001 },
    });
  });

  describe('Rate limiting on /auth/telegram', () => {
    it('should return 429 after exceeding rate limit', async () => {
      const initData = generateValidInitData({ user: { id: 666666002, first_name: 'Rate', last_name: 'Limit2', username: 'ratelimit2' } });

      // Make requests up to the endpoint's own limit
      for (let i = 0; i < authLimit; i++) {
        const response = await app.inject({
          method: 'POST',
          url: '/api/v1/auth/telegram',
          payload: { initData },
        });
        // Everything inside the window should succeed (or at least not be rate limited)
        expect(response.statusCode).not.toBe(429);
      }

      // One past the limit should be rate limited
      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/telegram',
        payload: { initData },
      });

      expect(response.statusCode).toBe(429);
      const body = JSON.parse(response.body);
      expect(body.error).toBe('Too Many Requests');
      expect(body.code).toBe('RATE_LIMIT_EXCEEDED');
      expect(response.headers).toHaveProperty('retry-after');
      expect(response.headers).toHaveProperty('x-ratelimit-limit');
      expect(response.headers).toHaveProperty('x-ratelimit-remaining');
      expect(response.headers).toHaveProperty('x-ratelimit-reset');
      // Note: Rate limiter uses capitalized headers: X-RateLimit-Limit, X-RateLimit-Remaining, X-RateLimit-Reset
      // Fastify normalizes headers to lowercase, so we check for lowercase versions
    });
  });

  describe('Rate limiting on /auth/refresh', () => {
    let session: { cookie: string; csrf: string };

    beforeEach(async () => {
      const initData = generateValidInitData({ user: { id: 666666003, first_name: 'Refresh', last_name: 'Rate', username: 'refreshrate' } });
      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/telegram',
        payload: { initData },
      });
      const body = JSON.parse(response.body);
      session = sessionFrom(response);
    });

    it('should return 429 after exceeding rate limit', async () => {
      // Make requests up to the endpoint's own limit
      for (let i = 0; i < refreshLimit; i++) {
        const response = await app.inject({
          method: 'POST',
          url: '/api/v1/auth/refresh',
          headers: { cookie: session.cookie, 'x-csrf-token': session.csrf },
          payload: {},
        });
        if (response.statusCode === 200) {
          session = sessionFrom(response); // Update for next request
        }
        expect(response.statusCode).not.toBe(429);
      }

      // Next request should be rate limited
      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/refresh',
        headers: { cookie: session.cookie, 'x-csrf-token': session.csrf },
        payload: {},
      });

      expect(response.statusCode).toBe(429);
      const body = JSON.parse(response.body);
      expect(body.code).toBe('RATE_LIMIT_EXCEEDED');
      expect(response.headers).toHaveProperty('retry-after');
      // Note: Rate limiter uses capitalized headers: X-RateLimit-Limit, X-RateLimit-Remaining, X-RateLimit-Reset
      // Fastify normalizes headers to lowercase
    });
  });

  describe('Rate limiting on /translate', () => {
    it('should return 429 after exceeding rate limit', async () => {
      // Make requests up to the limit
      for (let i = 0; i < 10; i++) {
        const response = await app.inject({
          method: 'POST',
          url: '/api/v1/translate',
          headers: { authorization: `Bearer ${accessToken}` },
          payload: { text: `Test ${i}`, style: 'GEN_Z' },
        });
        expect(response.statusCode).not.toBe(429);
      }

      // Next request should be rate limited
      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/translate',
        headers: { authorization: `Bearer ${accessToken}` },
        payload: { text: 'Test rate limit', style: 'GEN_Z' },
      });

      expect(response.statusCode).toBe(429);
      const body = JSON.parse(response.body);
      expect(body.code).toBe('RATE_LIMIT_EXCEEDED');
      expect(response.headers).toHaveProperty('retry-after');
      // Note: Rate limiter uses capitalized headers: X-RateLimit-Limit, X-RateLimit-Remaining, X-RateLimit-Reset
      // Fastify normalizes headers to lowercase
    });
  });

  describe('Rate limiting on authenticated endpoint /history', () => {
    it('should return 429 after exceeding rate limit', async () => {
      // Make requests up to the limit
      for (let i = 0; i < 10; i++) {
        const response = await app.inject({
          method: 'GET',
          url: '/api/v1/history',
          headers: { authorization: `Bearer ${accessToken}` },
        });
        expect(response.statusCode).not.toBe(429);
      }

      // Next request should be rate limited
      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/history',
        headers: { authorization: `Bearer ${accessToken}` },
      });

      expect(response.statusCode).toBe(429);
      const body = JSON.parse(response.body);
      expect(body.code).toBe('RATE_LIMIT_EXCEEDED');
      expect(response.headers).toHaveProperty('retry-after');
      // Note: Rate limiter uses capitalized headers: X-RateLimit-Limit, X-RateLimit-Remaining, X-RateLimit-Reset
      // Fastify normalizes headers to lowercase
    });
  });

  describe('429 response shape and headers', () => {
    it('should have correct error shape and rate-limit headers', async () => {
      // Exhaust the rate limit
      for (let i = 0; i < 11; i++) {
        await app.inject({
          method: 'POST',
          url: '/api/v1/auth/telegram',
          payload: { initData: generateValidInitData({ user: { id: 666666004 + i, first_name: `Rate${i}`, last_name: 'Limit', username: `ratelimit${i}` } }) },
        });
      }

      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/telegram',
        payload: { initData: generateValidInitData({ user: { id: 666666020, first_name: 'Final', last_name: 'Test', username: 'finaltest' } }) },
      });

      expect(response.statusCode).toBe(429);
      const body = JSON.parse(response.body);
      
      // Verify error shape
      expect(body).toHaveProperty('error');
      expect(body).toHaveProperty('code');
      expect(body).toHaveProperty('message');
      expect(body.error).toBe('Too Many Requests');
      expect(body.code).toBe('RATE_LIMIT_EXCEEDED');
      expect(typeof body.message).toBe('string');

      // Verify rate-limit headers
      // Note: Fastify normalizes headers to lowercase
      expect(response.headers).toHaveProperty('retry-after');
      expect(response.headers).toHaveProperty('x-ratelimit-limit');
      expect(response.headers).toHaveProperty('x-ratelimit-remaining');
      expect(response.headers).toHaveProperty('x-ratelimit-reset');

      // Verify header values
      const retryAfter = parseInt(response.headers['retry-after'] as string, 10);
      expect(retryAfter).toBeGreaterThan(0);
      
      const limit = parseInt(response.headers['x-ratelimit-limit'] as string, 10);
      expect(limit).toBeGreaterThan(0);
      
      const remaining = parseInt(response.headers['x-ratelimit-remaining'] as string, 10);
      expect(remaining).toBe(0);
      
      const reset = parseInt(response.headers['x-ratelimit-reset'] as string, 10);
      expect(reset).toBeGreaterThan(Date.now() / 1000);
    });
  });

  describe('Telegram webhook', () => {
    // Read from the environment so the test cannot drift from the value the app
    // parsed into config. Both are set by vitest.integration.config.mjs.
    const webhookSecret = process.env.TELEGRAM_WEBHOOK_SECRET ?? '';
    const webhookLimit = Number(process.env.WEBHOOK_RATE_LIMIT_MAX_REQUESTS ?? '30');

    it('rejects a webhook call without the shared secret header', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/telegram/webhook',
        payload: {},
      });

      expect(response.statusCode).toBe(401);
    });

    it('rejects a webhook call with a wrong shared secret header', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/telegram/webhook',
        headers: { 'x-telegram-bot-api-secret-token': `${webhookSecret}-wrong` },
        payload: {},
      });

      expect(response.statusCode).toBe(401);
    });

    it('accepts an authenticated webhook call, meters it, and leaves health unmetered', async () => {
      expect(webhookSecret.length).toBeGreaterThan(0);

      const webhook = await app.inject({
        method: 'POST',
        url: '/api/v1/telegram/webhook',
        headers: { 'x-telegram-bot-api-secret-token': webhookSecret },
        payload: {},
      });
      expect(webhook.statusCode).toBe(200);
      expect(webhook.headers).toHaveProperty('x-ratelimit-limit');

      const health = await app.inject({ method: 'GET', url: '/health' });
      expect(health.statusCode).toBe(200);
      expect(health.headers).not.toHaveProperty('x-ratelimit-limit');
    });

    it('returns 429 once the webhook limiter window is exhausted', async () => {
      for (let i = 0; i < webhookLimit; i++) {
        const response = await app.inject({
          method: 'POST',
          url: '/api/v1/telegram/webhook',
          headers: { 'x-telegram-bot-api-secret-token': webhookSecret },
          payload: {},
        });
        expect(response.statusCode).toBe(200);
      }

      const limited = await app.inject({
        method: 'POST',
        url: '/api/v1/telegram/webhook',
        headers: { 'x-telegram-bot-api-secret-token': webhookSecret },
        payload: {},
      });

      expect(limited.statusCode).toBe(429);
      const body = JSON.parse(limited.body);
      expect(body.code).toBe('RATE_LIMIT_EXCEEDED');
      expect(limited.headers).toHaveProperty('retry-after');
      expect(limited.headers['x-ratelimit-limit']).toBe(String(webhookLimit));
    });

    it('meters unauthenticated webhook calls too (401 still consumes the limiter)', async () => {
      for (let i = 0; i < webhookLimit; i++) {
        const response = await app.inject({
          method: 'POST',
          url: '/api/v1/telegram/webhook',
          payload: {},
        });
        expect(response.statusCode).toBe(401);
      }

      const limited = await app.inject({
        method: 'POST',
        url: '/api/v1/telegram/webhook',
        headers: { 'x-telegram-bot-api-secret-token': webhookSecret },
        payload: {},
      });

      expect(limited.statusCode).toBe(429);
      expect(JSON.parse(limited.body).code).toBe('RATE_LIMIT_EXCEEDED');
    });
  });
});
