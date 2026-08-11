import { beforeEach, afterEach, vi } from 'vitest';
import { getPrismaClient } from './global-setup.js';
import Redis from 'ioredis';

let redis: Redis;

beforeEach(async () => {
  // Flush Redis between tests
  const redisUrl = (globalThis as any).__TEST_REDIS_URL__;
  if (redisUrl) {
    redis = new Redis(redisUrl);
    await redis.flushdb();
    await redis.quit();
  }

  // Truncate database tables
  const prisma = getPrismaClient();
  await prisma.$transaction([
    prisma.translation.deleteMany(),
    prisma.refreshToken.deleteMany(),
    prisma.user.deleteMany(),
  ]);
});

afterEach(async () => {
  // Cleanup handled by beforeEach for next test
  vi.clearAllMocks();
});

export { getPrismaClient };