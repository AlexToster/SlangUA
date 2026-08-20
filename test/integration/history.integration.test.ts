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
// The stored-translation cap is server-owned; the tests read the same constant
// the service prunes against instead of hardcoding 100.
let historyMaxEntries: number;

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

    historyMaxEntries = (await import('../../src/constants/index.js')).HISTORY_MAX_ENTRIES;
    
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
            providerId: 'ollama',
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
      // Constant per deployment - the UI renders `5/100` from it.
      expect(body1).toHaveProperty('totalLimit', historyMaxEntries);

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
          { userId: userId1, originalText: 'Test 1', translatedText: 'Translated 1', slangStyle: 'GEN_Z', providerId: 'ollama', favorite: false },
          { userId: userId1, originalText: 'Test 2', translatedText: 'Translated 2', slangStyle: 'GEN_Z', providerId: 'ollama', favorite: false },
          { userId: userId1, originalText: 'Test 3', translatedText: 'Translated 3', slangStyle: 'GEN_Z', providerId: 'ollama', favorite: false },
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
          { userId: userId1, originalText: 'Favorite 1', translatedText: 'Translated 1', slangStyle: 'GEN_Z', providerId: 'ollama', favorite: true },
          { userId: userId1, originalText: 'Favorite 2', translatedText: 'Translated 2', slangStyle: 'GEN_Z', providerId: 'ollama', favorite: true },
          { userId: userId1, originalText: 'Not Favorite 1', translatedText: 'Translated 3', slangStyle: 'GEN_Z', providerId: 'ollama', favorite: false },
          { userId: userId1, originalText: 'Not Favorite 2', translatedText: 'Translated 4', slangStyle: 'GEN_Z', providerId: 'ollama', favorite: false },
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

    // The cap is enforced server-side after every insert: a client cannot be
    // trusted to stop saving, and it may simply not send the limit back.
    it('should prune the oldest non-favorite rows back to the cap after a save', async () => {
      const base = new Date('2024-01-01T00:00:00.000Z');
      await prisma.translation.createMany({
        data: Array.from({ length: historyMaxEntries }, (_, i) => ({
          userId: userId1,
          originalText: `Seeded ${i}`,
          translatedText: `Translated ${i}`,
          slangStyle: 'GEN_Z' as const,
          providerId: 'ollama' as const,
          // The very oldest row is starred, so pruning must skip it and take the
          // next-oldest instead.
          favorite: i === 0,
          createdAt: new Date(base.getTime() + i * 1000),
        })),
      });

      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/translate',
        headers: { authorization: `Bearer ${accessToken1}` },
        payload: { text: 'Prune trigger unique text', style: 'GEN_Z' },
      });
      expect(response.statusCode).toBe(200);

      expect(await prisma.translation.count({ where: { userId: userId1 } })).toBe(historyMaxEntries);
      expect(await prisma.translation.findFirst({ where: { userId: userId1, originalText: 'Seeded 0' } })).not.toBeNull();
      expect(await prisma.translation.findFirst({ where: { userId: userId1, originalText: 'Seeded 1' } })).toBeNull();
      // Other users are untouched by another user's prune.
      expect(await prisma.translation.count({ where: { userId: userId2 } })).toBe(0);
    });

    it('should never prune favorites, even above the cap', async () => {
      const base = new Date('2024-02-01T00:00:00.000Z');
      await prisma.translation.createMany({
        data: Array.from({ length: historyMaxEntries }, (_, i) => ({
          userId: userId1,
          originalText: `Starred ${i}`,
          translatedText: `Translated ${i}`,
          slangStyle: 'GEN_Z' as const,
          providerId: 'ollama' as const,
          favorite: true,
          createdAt: new Date(base.getTime() + i * 1000),
        })),
      });

      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/translate',
        headers: { authorization: `Bearer ${accessToken1}` },
        payload: { text: 'Favorites stay put unique text', style: 'GEN_Z' },
      });
      expect(response.statusCode).toBe(200);

      // Deliberately over the cap: deleting something the user starred is worse
      // than storing one row too many.
      expect(await prisma.translation.count({ where: { userId: userId1 } })).toBe(historyMaxEntries + 1);
      expect(await prisma.translation.count({ where: { userId: userId1, favorite: true } })).toBe(historyMaxEntries);
    });

    it('should return only non-favorites for ?favorite=false', async () => {
      await prisma.translation.createMany({
        data: [
          { userId: userId1, originalText: 'Favorite 1', translatedText: 'Translated 1', slangStyle: 'GEN_Z', providerId: 'ollama', favorite: true },
          { userId: userId1, originalText: 'Not Favorite 1', translatedText: 'Translated 2', slangStyle: 'GEN_Z', providerId: 'ollama', favorite: false },
          { userId: userId1, originalText: 'Not Favorite 2', translatedText: 'Translated 3', slangStyle: 'GEN_Z', providerId: 'ollama', favorite: false },
        ],
      });

      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/history?favorite=false',
        headers: { authorization: `Bearer ${accessToken1}` },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      // Boolean('false') === true, so a coerced boolean would return the favorites.
      expect(body.totalCount).toBe(2);
      expect(body.data).toHaveLength(2);
      body.data.forEach((item: any) => {
        expect(item.favorite).toBe(false);
      });
    });

    it('should return all records when the favorite filter is omitted', async () => {
      await prisma.translation.createMany({
        data: [
          { userId: userId1, originalText: 'Favorite 1', translatedText: 'Translated 1', slangStyle: 'GEN_Z', providerId: 'ollama', favorite: true },
          { userId: userId1, originalText: 'Not Favorite 1', translatedText: 'Translated 2', slangStyle: 'GEN_Z', providerId: 'ollama', favorite: false },
        ],
      });

      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/history',
        headers: { authorization: `Bearer ${accessToken1}` },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.totalCount).toBe(2);
    });

    it('should reject a non-boolean favorite query value with 400', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/history?favorite=yes',
        headers: { authorization: `Bearer ${accessToken1}` },
      });

      expect(response.statusCode).toBe(400);
      expect(JSON.parse(response.body).code).toBe('VALIDATION_ERROR');
    });

    it('should support case-insensitive search', async () => {
      await prisma.translation.createMany({
        data: [
          { userId: userId1, originalText: 'Hello World', translatedText: 'Translated 1', slangStyle: 'GEN_Z', providerId: 'ollama', favorite: false },
          { userId: userId1, originalText: 'hello world', translatedText: 'Translated 2', slangStyle: 'GEN_Z', providerId: 'ollama', favorite: false },
          { userId: userId1, originalText: 'HELLO WORLD', translatedText: 'Translated 3', slangStyle: 'GEN_Z', providerId: 'ollama', favorite: false },
          { userId: userId1, originalText: 'Goodbye', translatedText: 'Translated 4', slangStyle: 'GEN_Z', providerId: 'ollama', favorite: false },
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

    it('should set favorite only for owner', async () => {
      // Create translation for user1
      const translation = await prisma.translation.create({
        data: {
          userId: userId1,
          originalText: 'Owner test',
          translatedText: 'Translated',
          slangStyle: 'GEN_Z',
          providerId: 'ollama',
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

    it('should set the favorite value explicitly for owner (false -> true -> false)', async () => {
      const translation = await prisma.translation.create({
        data: {
          userId: userId1,
          originalText: 'Toggle cycle',
          translatedText: 'Translated',
          slangStyle: 'GEN_Z',
          providerId: 'ollama',
          favorite: false,
        },
      });

      // First toggle: false -> true
      const response1 = await app.inject({
        method: 'PATCH',
        url: `/api/v1/history/${translation.id}/favorite`,
        headers: { authorization: `Bearer ${accessToken1}` },
        payload: { favorite: true },
      });
      expect(response1.statusCode).toBe(200);
      expect(JSON.parse(response1.body).favorite).toBe(true);

      // Second toggle: true -> false
      const response2 = await app.inject({
        method: 'PATCH',
        url: `/api/v1/history/${translation.id}/favorite`,
        headers: { authorization: `Bearer ${accessToken1}` },
        payload: { favorite: false },
      });
      expect(response2.statusCode).toBe(200);
      expect(JSON.parse(response2.body).favorite).toBe(false);

      // Verify final state in DB
      const dbRow = await prisma.translation.findUnique({ where: { id: translation.id } });
      expect(dbRow!.favorite).toBe(false);
    });

    it('should be idempotent when the same favorite value is sent twice', async () => {
      const translation = await prisma.translation.create({
        data: {
          userId: userId1,
          originalText: 'Idempotent favorite',
          translatedText: 'Translated',
          slangStyle: 'GEN_Z',
          providerId: 'ollama',
          favorite: false,
        },
      });

      for (let i = 0; i < 2; i++) {
        const response = await app.inject({
          method: 'PATCH',
          url: `/api/v1/history/${translation.id}/favorite`,
          headers: { authorization: `Bearer ${accessToken1}` },
          payload: { favorite: true },
        });
        expect(response.statusCode).toBe(200);
        // A toggle would flip this back to false on the second call.
        expect(JSON.parse(response.body).favorite).toBe(true);
      }

      const dbRow = await prisma.translation.findUnique({ where: { id: translation.id } });
      expect(dbRow!.favorite).toBe(true);

      // Setting false twice is idempotent as well.
      for (let i = 0; i < 2; i++) {
        const response = await app.inject({
          method: 'PATCH',
          url: `/api/v1/history/${translation.id}/favorite`,
          headers: { authorization: `Bearer ${accessToken1}` },
          payload: { favorite: false },
        });
        expect(response.statusCode).toBe(200);
        expect(JSON.parse(response.body).favorite).toBe(false);
      }
    });

    it('should toggle favorite when the body is omitted', async () => {
      const translation = await prisma.translation.create({
        data: {
          userId: userId1,
          originalText: 'Toggle without body',
          translatedText: 'Translated',
          slangStyle: 'GEN_Z',
          providerId: 'ollama',
          favorite: false,
        },
      });

      const first = await app.inject({
        method: 'PATCH',
        url: `/api/v1/history/${translation.id}/favorite`,
        headers: { authorization: `Bearer ${accessToken1}` },
      });
      expect(first.statusCode).toBe(200);
      expect(JSON.parse(first.body).favorite).toBe(true);

      const second = await app.inject({
        method: 'PATCH',
        url: `/api/v1/history/${translation.id}/favorite`,
        headers: { authorization: `Bearer ${accessToken1}` },
      });
      expect(second.statusCode).toBe(200);
      expect(JSON.parse(second.body).favorite).toBe(false);

      const dbRow = await prisma.translation.findUnique({ where: { id: translation.id } });
      expect(dbRow!.favorite).toBe(false);
    });

    it('should return 404 for PATCH favorite on a non-existent record', async () => {
      const response = await app.inject({
        method: 'PATCH',
        url: `/api/v1/history/999999999/favorite`,
        headers: { authorization: `Bearer ${accessToken1}` },
        payload: { favorite: true },
      });
      expect(response.statusCode).toBe(404);
      expect(JSON.parse(response.body).code).toBe('NOT_FOUND');
    });

    it('should return 404 for PATCH on another user record', async () => {
      const translation = await prisma.translation.create({
        data: {
          userId: userId1,
          originalText: 'Owner test',
          translatedText: 'Translated',
          slangStyle: 'GEN_Z',
          providerId: 'ollama',
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

    it('should return 204 when deleting own record and remove it from the database', async () => {
      const translation = await prisma.translation.create({
        data: {
          userId: userId1,
          originalText: 'Delete me',
          translatedText: 'Translated',
          slangStyle: 'GEN_Z',
          providerId: 'ollama',
          favorite: false,
        },
      });

      const response = await app.inject({
        method: 'DELETE',
        url: `/api/v1/history/${translation.id}`,
        headers: { authorization: `Bearer ${accessToken1}` },
      });

      expect(response.statusCode).toBe(204);

      // Verify the row is gone
      const dbRow = await prisma.translation.findUnique({ where: { id: translation.id } });
      expect(dbRow).toBeNull();
    });

    it('should return 404 for DELETE on another user record', async () => {
      const translation = await prisma.translation.create({
        data: {
          userId: userId1,
          originalText: 'Owner test',
          translatedText: 'Translated',
          slangStyle: 'GEN_Z',
          providerId: 'ollama',
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

    it('should return 404 for DELETE on a non-existent record', async () => {
      const response = await app.inject({
        method: 'DELETE',
        url: `/api/v1/history/999999999`,
        headers: { authorization: `Bearer ${accessToken1}` },
      });
      expect(response.statusCode).toBe(404);
      expect(JSON.parse(response.body).code).toBe('NOT_FOUND');
    });
  });

  describe('DELETE /history', () => {
    it('should clear only the caller history and report how many rows were removed', async () => {
      const ownedBefore = await prisma.translation.count({ where: { userId: userId1 } });

      await prisma.translation.createMany({
        data: [
          {
            userId: userId1,
            originalText: 'Clear me 1',
            translatedText: 'Translated',
            slangStyle: 'GEN_Z',
            providerId: 'ollama',
            favorite: false,
          },
          {
            // Favorites are removed too: the user asked for an empty history.
            userId: userId1,
            originalText: 'Clear me 2',
            translatedText: 'Translated',
            slangStyle: 'GEN_Z',
            providerId: 'ollama',
            favorite: true,
          },
        ],
      });

      const otherUserRow = await prisma.translation.create({
        data: {
          userId: userId2,
          originalText: 'Keep me',
          translatedText: 'Translated',
          slangStyle: 'GEN_Z',
          providerId: 'ollama',
          favorite: false,
        },
      });

      const response = await app.inject({
        method: 'DELETE',
        url: '/api/v1/history',
        headers: { authorization: `Bearer ${accessToken1}` },
      });

      expect(response.statusCode).toBe(200);
      expect(JSON.parse(response.body).deletedCount).toBe(ownedBefore + 2);

      expect(await prisma.translation.count({ where: { userId: userId1 } })).toBe(0);
      expect(await prisma.translation.findUnique({ where: { id: otherUserRow.id } })).not.toBeNull();

      await prisma.translation.delete({ where: { id: otherUserRow.id } });
    });

    it('should be idempotent on an already empty history', async () => {
      await prisma.translation.deleteMany({ where: { userId: userId1 } });

      const response = await app.inject({
        method: 'DELETE',
        url: '/api/v1/history',
        headers: { authorization: `Bearer ${accessToken1}` },
      });

      expect(response.statusCode).toBe(200);
      expect(JSON.parse(response.body).deletedCount).toBe(0);
    });

    it('should require authentication', async () => {
      const response = await app.inject({
        method: 'DELETE',
        url: '/api/v1/history',
      });

      expect(response.statusCode).toBe(401);
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

    // Сповіщення прибрано з продукту. Поле лишилося тільки колонкою в базі
    // (schema.prisma, позначена DEPRECATED), тож strict-схема тіла мусить його
    // відхиляти — інакше клієнт зміг би писати в мертву колонку.
    it('should reject the removed notificationsEnabled field', async () => {
      const response = await app.inject({
        method: 'PATCH',
        url: '/api/v1/user/me',
        headers: { authorization: `Bearer ${accessToken1}` },
        payload: { notificationsEnabled: false },
      });

      expect(response.statusCode).toBe(400);
      const body = JSON.parse(response.body);
      expect(body.code).toBe('VALIDATION_ERROR');
    });
  });
});