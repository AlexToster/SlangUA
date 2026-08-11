import { PrismaClient } from '@prisma/client';
import { readFileSync } from 'fs';
import Redis from 'ioredis';
import { mockOllamaServer } from '../helpers/mock-ollama-server.js';
import { setAppInstance, setPrismaClient, setMockOllamaUrl, setRedisUrl } from './test-context.js';

// Module-level singleton state
let initialized = false;
let initPromise: Promise<void> | null = null;
let mockOllamaClose: () => Promise<void>;
let prisma: PrismaClient;
let appInstance: any;

// Initialize test context - runs once on first import
async function initializeTestContext(): Promise<void> {
  // Always flush Redis to ensure clean state for each test file
  console.log('Flushing Redis...');
  const connectionFile = process.env.SLANGUA_TEST_CONNECTION_FILE;
  if (!connectionFile) {
    throw new Error('SLANGUA_TEST_CONNECTION_FILE not set. globalSetup must run first.');
  }

  const { databaseUrl, redisUrl } = JSON.parse(readFileSync(connectionFile, 'utf-8'));
  
  const redis = new Redis(redisUrl);
  await redis.flushdb();
  await redis.quit();
  console.log('Redis flushed');

  if (initialized) {
    console.log('Test context already initialized, skipping app/Prisma/Ollama setup...');
    return;
  }
  if (initPromise) {
    return initPromise;
  }

  initPromise = (async () => {
    console.log(`Setting up test context with PostgreSQL: ${databaseUrl}`);
    console.log(`Setting up test context with Redis: ${redisUrl}`);

    // Start mock Ollama server
    console.log('Starting mock Ollama server...');
    const mockServer = await mockOllamaServer();
    const mockOllamaUrl = mockServer.url;
    mockOllamaClose = mockServer.close;
    process.env.OLLAMA_BASE_URL = mockOllamaUrl;

    console.log(`Mock Ollama: ${mockOllamaUrl}`);

    // Initialize Prisma client
    prisma = new PrismaClient({
      datasources: {
        db: { url: databaseUrl },
      },
    });

    await prisma.$connect();

    // Set shared instances
    setPrismaClient(prisma);
    setMockOllamaUrl(mockOllamaUrl);
    setRedisUrl(redisUrl);

    // Import and build app AFTER env vars are set
    const { buildApp } = await import('../../src/app.js');
    appInstance = await buildApp();
    setAppInstance(appInstance);

    initialized = true;
    console.log('Test context setup complete');
  })();

  return initPromise;
}

// Export initialization function for test files to call
export async function setup() {
  return initializeTestContext();
}

// Export teardown function for global teardown
export async function teardown() {
  console.log('Starting test context teardown...');

  if (appInstance) {
    await appInstance.close();
  }

  if (prisma) {
    await prisma.$disconnect();
  }

  if (mockOllamaClose) {
    await mockOllamaClose();
  }

  initialized = false;
  initPromise = null;
  console.log('Test context teardown complete');
}