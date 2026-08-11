import type { FastifyInstance } from 'fastify';
import Redis from 'ioredis';

// All imports moved to beforeAll to ensure globalSetup runs first
let getAppInstance: () => FastifyInstance;
let getPrismaClient: () => any;
let getRedisUrl: () => string;
let truncateDatabase: () => Promise<void>;
let flushRedis: () => Promise<void>;
let generateValidInitData: (options?: any) => string;
let generateInitDataWithCustomUser: (options?: any) => string;

describe('History Integration Tests', () => {
  let app: FastifyInstance;
  let prisma: any;
  let accessToken1: string;
  let accessToken2: string;
  let userId1: number;
  let userId2: number;

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
    generateInitDataWithCustomUser = telegramInitData.generateInitDataWithCustomUser;
    
    app = getAppInstance();
    prisma = getPrismaClient();

    // Create first test user
    const initData1 = generateValidInitData({ user: { id: 777777001, first_name: 'History', last_name: 'User1', username: 'historyuser1' } });
    const response1 = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/telegram',
      payload: { initData: initData1 },
    });
    const body1 = JSON.parse(response1.body);
    accessToken1 = body1.accessToken;
    // Get actual database user ID (auto-increment), not telegramId
    const user1 = await prisma.user.findUnique({ where: { telegramId: '777777001' } });
    userId1 = user1!.id;

    // Create second test user
    const initData2 = generateValidInitData({ user: { id: 777777002, first_name: 'History', last_name: 'User2', username: 'historyuser2' } });
    const response2 = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/telegram',
      payload: { initData: initData2 },
    });
    const body2 = JSON.parse(response2.body);
    accessToken2 = body2.accessToken;
    // Get actual database user ID (auto-increment), not telegramId
    const user2 = await prisma.user.findUnique({ where: { telegramId: '777777002' } });
    userId2 = user2!.id;
  });

  afterAll(async () => {
    // Don't close the shared app instance - handled by global teardown
  });

  beforeEach(async () => {
    // Flush Redis between tests using shared function
    await flushRedis();

    // Clean up translations for both users
    await prisma.translation.deleteMany({
      where: { userId: { in: [userId1, userId2] } },
    });
  });

  describe('GET /history', () => {
    it('should return translations with keyset pagination - no duplicates or skipped records', async () => {
      // Create multiple translations with same createdAt (using direct DB insert to control timestamp)
      const baseTime = new Date('2024-01-01T12:00:00.000Z');

      for (let i = 1; i <= 5; i++) {
        await prisma.translation.create({
          data: {
            userId: userId1,
            originalText: `Original ${i}`,
            translatedText: `Translated ${i}`,
            slangStyle: 'GEN_Z',
            aiProvider: 'OLLAMA',
            favorite: false,
            createdAt: baseTime,
          },
        });
      }

      // First page
      const response1 = await app.inject({
        method: 'GET',
        url: '/api/v1/history?limit=2',
        headers: { authorization: `Bearer ${accessToken1}` },
      });

      expect(response1.statusCode).toBe(200);
      const body1 = JSON.parse(response1.body);
      expect(body1.data).toHaveLength(2);
      expect(body1).toHaveProperty('nextCursor');
      expect(body1).toHaveProperty('totalCount', 5);

      const firstPageIds = body1.data.map((item: any) => item.id);

      // Second page
      const response2 = await app.inject({
        method: 'GET',
        url: `/api/v1/history?limit=2&cursor=${body1.nextCursor}`,
        headers: { authorization: `Bearer ${accessToken1}` },
      });

      expect(response2.statusCode).toBe(200);
      const body2 = JSON.parse(response2.body);
      expect(body2.data).toHaveLength(2);
      expect(body2).toHaveProperty('nextCursor');

      const secondPageIds = body2.data.map((item: any) => item.id);

      // Third page
      const response3 = await app.inject({
        method: 'GET',
        url: `/api/v1/history?limit=2&cursor=${body2.nextCursor}`,
        headers: { authorization: `Bearer ${accessToken1}` },
      });

      expect(response3.statusCode).toBe(200);
      const body3 = JSON.parse(response3.body);
      expect(body3.data).toHaveLength(1);
      expect(body3.nextCursor).toBeNull();

      const thirdPageIds = body3.data.map((item: any) => item.id);

      // Verify no duplicates and no skipped records
      const allIds = [...firstPageIds, ...secondPageIds, ...thirdPageIds];
      const uniqueIds = [...new Set(allIds)];
      expect(uniqueIds).toHaveLength(5);
      expect(allIds).toHaveLength(5);
    });

    it('should return opaque nextCursor accepted unchanged', async () => {
      await prisma.translation.createMany({
        data: [
          { userId: userId1, originalText: 'Test 1', translatedText: 'Translated 1', slangStyle: 'GEN_Z', aiProvider: 'OLLAMA', favorite: false },
          { userId: userId1, originalText: 'Test 2', translatedText: 'Translated 2', slangStyle: 'GEN_Z', aiProvider: 'OLLAMA', favorite: false },
          { userId: userId1, originalText: 'Test 3', translatedText: 'Translated 3', slangStyle: 'GEN_Z', aiProvider: 'OLLAMA', favorite: false },
        ],
      });

      const response1 = await app.inject({
        method: 'GET',
        url: '/api/v1/history?limit=1',
        headers: { authorization: `Bearer ${accessToken1}` },
      });

      expect(response1.statusCode).toBe(200);
      const body1 = JSON.parse(response1.body);
      expect(body1.nextCursor).toBeDefined();
      expect(typeof body1.nextCursor).toBe('string');
      expect(body1.nextCursor.length).toBeGreaterThan(0);

      // Use cursor unchanged
      const response2 = await app.inject({
        method: 'GET',
        url: `/api/v1/history?limit=1&cursor=${body1.nextCursor}`,
        headers: { authorization: `Bearer ${accessToken1}` },
      });

      expect(response2.statusCode).toBe(200);
      const body2 = JSON.parse(response2.body);
      expect(body2.data).toHaveLength(1);
      expect(body2.data[0].id).not.toBe(body1.data[0].id);
    });

    it('should return totalCount representing all matching filters', async () => {
      await prisma.translation.createMany({
        data: [
          { userId: userId1, originalText: 'Favorite 1', translatedText: 'Translated 1', slangStyle: 'GEN_Z', aiProvider: 'OLLAMA', favorite: true },
          { userId: userId1, originalText: 'Favorite 2', translatedText: 'Translated 2', slangStyle: 'GEN_Z', aiProvider: 'OLLAMA', favorite: true },
          { userId: userId1, originalText: 'Not Favorite 1', translatedText: 'Translated 3', slangStyle: 'GEN_Z', aiProvider: 'OLLAMA', favorite: false },
          { userId: userId1, originalText: 'Not Favorite 2', translatedText: 'Translated 4', slangStyle: 'GEN_Z', aiProvider: 'OLLAMA', favorite: false },
        ],
      });

      // Filter by favorite=true
      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/history?favorite=true',
        headers: { authorization: `Bearer ${accessToken1}` },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.totalCount).toBe(2);
      expect(body.data).toHaveLength(2);
      body.data.forEach((item: any) => {
        expect(item.favorite).toBe(true);
      });
    });

    it('should support case-insensitive search', async () => {
      await prisma.translation.createMany({
        data: [
          { userId: userId1, originalText: 'Hello World', translatedText: 'Translated 1', slangStyle: 'GEN_Z', aiProvider: 'OLLAMA', favorite: false },
          { userId: userId1, originalText: 'hello world', translatedText: 'Translated 2', slangStyle: 'GEN_Z', aiProvider: 'OLLAMA', favorite: false },
          { userId: userId1, originalText: 'HELLO WORLD', translatedText: 'Translated 3', slangStyle: 'GEN_Z', aiProvider: 'OLLAMA', favorite: false },
          { userId: userId1, originalText: 'Goodbye', translatedText: 'Translated 4', slangStyle: 'GEN_Z', aiProvider: 'OLLAMA', favorite: false },
        ],
      });

      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/history?search=hello',
        headers: { authorization: `Bearer ${accessToken1}` },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.totalCount).toBe(3);
      expect(body.data).toHaveLength(3);
    });

    it('should toggle favorite only for owner', async () => {
      // Create translation for user1
      const translation = await prisma.translation.create({
        data: {
          userId: userId1,
          originalText: 'Owner test',
          translatedText: 'Translated',
          slangStyle: 'GEN_Z',
          aiProvider: 'OLLAMA',
          favorite: false,
        },
      });

      // User1 toggles favorite - should succeed
      const response1 = await app.inject({
        method: 'PATCH',
        url: `/api/v1/history/${translation.id}/favorite`,
        headers: { authorization: `Bearer ${accessToken1}` },
        payload: { favorite: true },
      });

      expect(response1.statusCode).toBe(200);
      const body1 = JSON.parse(response1.body);
      expect(body1.favorite).toBe(true);

      // User2 tries to toggle same record - should fail with 404
      const response2 = await app.inject({
        method: 'PATCH',
        url: `/api/v1/history/${translation.id}/favorite`,
        headers: { authorization: `Bearer ${accessToken2}` },
        payload: { favorite: true },
      });

      expect(response2.statusCode).toBe(404);
      const body2 = JSON.parse(response2.body);
      expect(body2.code).toBe('NOT_FOUND');
    });

    it('should return 404 for PATCH on another user record', async () => {
      const translation = await prisma.translation.create({
        data: {
          userId: userId1,
          originalText: 'Owner test',
          translatedText: 'Translated',
          slangStyle: 'GEN_Z',
          aiProvider: 'OLLAMA',
          favorite: false,
        },
      });

      const response = await app.inject({
        method: 'PATCH',
        url: `/api/v1/history/${translation.id}/favorite`,
        headers: { authorization: `Bearer ${accessToken2}` },
        payload: { favorite: true },
      });

      expect(response.statusCode).toBe(404);
      const body = JSON.parse(response.body);
      expect(body.code).toBe('NOT_FOUND');
    });

    it('should return 404 for DELETE on another user record', async () => {
      const translation = await prisma.translation.create({
        data: {
          userId: userId1,
          originalText: 'Owner test',
          translatedText: 'Translated',
          slangStyle: 'GEN_Z',
          aiProvider: 'OLLAMA',
          favorite: false,
        },
      });

      const response = await app.inject({
        method: 'DELETE',
        url: `/api/v1/history/${translation.id}`,
        headers: { authorization: `Bearer ${accessToken2}` },
      });

      expect(response.statusCode).toBe(404);
      const body = JSON.parse(response.body);
      expect(body.code).toBe('NOT_FOUND');
    });
  });

  describe('PATCH /user/me', () => {
    it('should reject unknown fields with 400', async () => {
      const response = await app.inject({
        method: 'PATCH',
        url: '/api/v1/user/me',
        headers: { authorization: `Bearer ${accessToken1}` },
        payload: { unknownField: 'value' },
      });

      expect(response.statusCode).toBe(400);
      const body = JSON.parse(response.body);
      expect(body.code).toBe('VALIDATION_ERROR');
    });

    it('should reject Telegram identity fields with 400', async () => {
      const response = await app.inject({
        method: 'PATCH',
        url: '/api/v1/user/me',
        headers: { authorization: `Bearer ${accessToken1}` },
        payload: { telegramId: 12345, username: 'hacker' },
      });

      expect(response.statusCode).toBe(400);
      const body = JSON.parse(response.body);
      expect(body.code).toBe('VALIDATION_ERROR');
    });

    it('should accept ageConfirmedAdult', async () => {
      const response = await app.inject({
        method: 'PATCH',
        url: '/api/v1/user/me',
        headers: { authorization: `Bearer ${accessToken1}` },
        payload: { ageConfirmedAdult: true },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.ageConfirmedAdult).toBe(true);
    });

    it('should accept notificationsEnabled', async () => {
      const response = await app.inject({
        method: 'PATCH',
        url: '/api/v1/user/me',
        headers: { authorization: `Bearer ${accessToken1}` },
        payload: { notificationsEnabled: false },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.notificationsEnabled).toBe(false);
    });
  });
});