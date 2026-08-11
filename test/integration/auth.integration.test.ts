import type { FastifyInstance } from 'fastify';
import Redis from 'ioredis';

// All imports moved to beforeAll to ensure globalSetup runs first
let getAppInstance: () => FastifyInstance;
let getPrismaClient: () => any;
let getRedisUrl: () => string;
let truncateDatabase: () => Promise<void>;
let flushRedis: () => Promise<void>;
let generateValidInitData: (options?: any) => string;
let generateExpiredInitData: () => string;
let generateInvalidHmacInitData: () => string;
let generateMalformedInitData: () => string;
let generateFutureAuthDateInitData: () => string;

function sessionFrom(response: any): { cookie: string; csrf: string } {
  const setCookie = response.headers['set-cookie'];
  const cookies = (Array.isArray(setCookie) ? setCookie : [setCookie]) as string[];
  const pairs = cookies.map((cookie) => cookie.split(';', 1)[0]);
  const csrf = pairs.find((cookie) => cookie.startsWith('slangua_csrf='));
  if (!csrf) throw new Error('CSRF cookie missing');
  return { cookie: pairs.join('; '), csrf: decodeURIComponent(csrf.slice('slangua_csrf='.length)) };
}

describe('Auth Integration Tests', () => {
  let app: FastifyInstance;
  let prisma: any;

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
    generateExpiredInitData = telegramInitData.generateExpiredInitData;
    generateInvalidHmacInitData = telegramInitData.generateInvalidHmacInitData;
    generateMalformedInitData = telegramInitData.generateMalformedInitData;
    generateFutureAuthDateInitData = telegramInitData.generateFutureAuthDateInitData;
    
    app = getAppInstance();
    prisma = getPrismaClient();
  });

  afterAll(async () => {
    // Don't close the shared app instance
  });

  beforeEach(async () => {
    // Flush Redis between tests using shared function
    await flushRedis();

    // Truncate database tables
    await prisma.$transaction([
      prisma.translation.deleteMany(),
      prisma.refreshToken.deleteMany(),
      prisma.user.deleteMany(),
    ]);
  });

  describe('POST /auth/telegram', () => {
    it('should return an access token and set protected refresh cookies for valid Telegram auth', async () => {
      const initData = generateValidInitData();

      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/telegram',
        payload: { initData },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body).toHaveProperty('accessToken');
      expect(typeof body.accessToken).toBe('string');
      expect(body.accessToken.length).toBeGreaterThan(0);
      expect(body).not.toHaveProperty('refreshToken');
      expect(response.headers['set-cookie']).toEqual(expect.arrayContaining([
        expect.stringContaining('slangua_refresh='),
        expect.stringContaining('HttpOnly'),
        expect.stringContaining('slangua_csrf='),
      ]));
    });

    it('should return 401 for invalid HMAC', async () => {
      const initData = generateInvalidHmacInitData();

      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/telegram',
        payload: { initData },
      });

      expect(response.statusCode).toBe(401);
      const body = JSON.parse(response.body);
      expect(body).toHaveProperty('error');
      expect(body).toHaveProperty('code');
      expect(body).toHaveProperty('message');
      expect(body.code).toBe('INVALID_HMAC');
    });

    it('should return 401 for expired auth_date', async () => {
      const initData = generateExpiredInitData();

      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/telegram',
        payload: { initData },
      });

      expect(response.statusCode).toBe(401);
      const body = JSON.parse(response.body);
      expect(body.code).toBe('AUTH_DATE_EXPIRED');
    });

    it('should return 400 for malformed initData', async () => {
      const initData = generateMalformedInitData();

      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/telegram',
        payload: { initData },
      });

      expect(response.statusCode).toBe(400);
      const body = JSON.parse(response.body);
      expect(body.code).toBe('INVALID_INIT_DATA');
    });
  });

  describe('POST /auth/refresh', () => {
    let session: { cookie: string; csrf: string };
    let accessToken: string;

    beforeEach(async () => {
      // Login fresh for each test (outer beforeEach truncates DB)
      const initData = generateValidInitData({ user: { id: 999999001, first_name: 'Refresh', last_name: 'Test', username: 'refreshtest' } });
      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/telegram',
        payload: { initData },
      });
      const body = JSON.parse(response.body);
      accessToken = body.accessToken;
      session = sessionFrom(response);
    });

    it('should rotate the HttpOnly refresh cookie', async () => {
      // First refresh
      const response1 = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/refresh',
        headers: { cookie: session.cookie, 'x-csrf-token': session.csrf },
        payload: {},
      });

      expect(response1.statusCode).toBe(200);
      const body1 = JSON.parse(response1.body);
      expect(body1).toHaveProperty('accessToken');
      expect(body1).not.toHaveProperty('refreshToken');
      const rotatedSession = sessionFrom(response1);
      expect(rotatedSession.cookie).not.toBe(session.cookie);

      // Try to reuse the rotated-out cookie.
      const response2 = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/refresh',
        headers: { cookie: session.cookie, 'x-csrf-token': session.csrf },
        payload: {},
      });

      expect(response2.statusCode).toBe(401);
      const body2 = JSON.parse(response2.body);
      expect(body2.code).toBe('INVALID_REFRESH_TOKEN');
    });

    it('should invalidate refresh token on logout', async () => {
      // Get a fresh token pair (separate user to avoid rate limit interference)
      const initData = generateValidInitData({ user: { id: 999999002, first_name: 'Logout', last_name: 'Test', username: 'logouttest' } });
      const loginResponse = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/telegram',
        payload: { initData },
      });
      const loginBody = JSON.parse(loginResponse.body);
      const currentAccessToken = loginBody.accessToken;
      const currentSession = sessionFrom(loginResponse);

      // Logout
      const logoutResponse = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/logout',
        headers: { authorization: `Bearer ${currentAccessToken}` },
        payload: {},
      });

      expect(logoutResponse.statusCode).toBe(204);

      // Try to refresh after logout - should fail
      const refreshResponse = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/refresh',
        headers: { cookie: currentSession.cookie, 'x-csrf-token': currentSession.csrf },
        payload: {},
      });

      expect(refreshResponse.statusCode).toBe(401);
      const refreshBody = JSON.parse(refreshResponse.body);
      expect(refreshBody.code).toBe('INVALID_REFRESH_TOKEN');
    });

    it('should return 429 after exceeding rate limit', async () => {
      // Get a fresh token pair (separate user)
      const initData = generateValidInitData({ user: { id: 999999003, first_name: 'Rate', last_name: 'Limit', username: 'ratelimittest' } });
      const loginResponse = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/telegram',
        payload: { initData },
      });
      const loginBody = JSON.parse(loginResponse.body);
      let currentSession = sessionFrom(loginResponse);

      // Make 11 refresh requests (default limit is 10)
      for (let i = 0; i < 11; i++) {
        const response = await app.inject({
          method: 'POST',
          url: '/api/v1/auth/refresh',
          headers: { cookie: currentSession.cookie, 'x-csrf-token': currentSession.csrf },
          payload: {},
        });

        if (i < 10) {
          expect(response.statusCode).toBe(200);
          currentSession = sessionFrom(response);
        } else {
          // 11th request should be rate limited
          expect(response.statusCode).toBe(429);
          const body = JSON.parse(response.body);
          expect(body.code).toBe('RATE_LIMIT_EXCEEDED');
          expect(response.headers).toHaveProperty('retry-after');
        }
      }
    });
  });
});
