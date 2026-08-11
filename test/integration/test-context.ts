// Shared test context - initialized by globalSetup, imported by test files
// Uses globalThis for cross-module persistence (globalSetup and test files may have different module contexts)

import type { FastifyInstance } from 'fastify';
import type { PrismaClient } from '@prisma/client';

// Use globalThis for shared state persistence across module boundaries
const GLOBAL_KEY = '__SLANGUA_TEST_CONTEXT__';

interface TestContext {
  appInstance: FastifyInstance | null;
  prismaClient: PrismaClient | null;
  mockOllamaUrl: string | null;
  redisUrl: string | null;
}

// Extend globalThis type
declare global {
  var __SLANGUA_TEST_CONTEXT__: TestContext | undefined;
}

function getGlobalContext(): TestContext {
  if (!globalThis[GLOBAL_KEY]) {
    globalThis[GLOBAL_KEY] = {
      appInstance: null,
      prismaClient: null,
      mockOllamaUrl: null,
      redisUrl: null,
    };
  }
  return globalThis[GLOBAL_KEY] as TestContext;
}

export function setAppInstance(app: FastifyInstance) {
  getGlobalContext().appInstance = app;
}

export function getAppInstance(): FastifyInstance {
  const ctx = getGlobalContext();
  if (!ctx.appInstance) {
    throw new Error('App instance not initialized. Ensure globalSetup has run.');
  }
  return ctx.appInstance;
}

export function setPrismaClient(prisma: PrismaClient) {
  getGlobalContext().prismaClient = prisma;
}

export function getPrismaClient(): PrismaClient {
  const ctx = getGlobalContext();
  if (!ctx.prismaClient) {
    throw new Error('Prisma client not initialized. Ensure globalSetup has run.');
  }
  return ctx.prismaClient;
}

export function setMockOllamaUrl(url: string) {
  getGlobalContext().mockOllamaUrl = url;
}

export function getMockOllamaUrl(): string {
  const ctx = getGlobalContext();
  if (!ctx.mockOllamaUrl) {
    throw new Error('Mock Ollama URL not initialized. Ensure globalSetup has run.');
  }
  return ctx.mockOllamaUrl;
}

export function setRedisUrl(url: string) {
  getGlobalContext().redisUrl = url;
}

export function getRedisUrl(): string {
  const ctx = getGlobalContext();
  if (!ctx.redisUrl) {
    throw new Error('Redis URL not initialized. Ensure globalSetup has run.');
  }
  return ctx.redisUrl;
}

// Helper functions for test cleanup
export async function truncateDatabase(): Promise<void> {
  const ctx = getGlobalContext();
  if (!ctx.prismaClient) return;
  await ctx.prismaClient.$executeRawUnsafe(`
    TRUNCATE TABLE "Translation", "RefreshToken" RESTART IDENTITY CASCADE;
  `);
}

export async function flushRedis(): Promise<void> {
  const ctx = getGlobalContext();
  if (!ctx.redisUrl) return;
  const Redis = (await import('ioredis')).default;
  const redis = new Redis(ctx.redisUrl);
  await redis.flushdb();
  await redis.quit();
}