import { GenericContainer, StartedTestContainer } from 'testcontainers';
import { PostgreSqlContainer } from '@testcontainers/postgresql';
import { RedisContainer } from '@testcontainers/redis';
import { PrismaClient } from '@prisma/client';
import { execSync } from 'child_process';
import { writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

let pgContainer: StartedTestContainer;
let redisContainer: StartedTestContainer;

export async function setup() {
  console.log('Starting PostgreSQL container...');
  pgContainer = await new GenericContainer('postgres:16-alpine')
    .withEnvironment({
      POSTGRES_USER: 'test',
      POSTGRES_PASSWORD: 'test',
      POSTGRES_DB: 'slangua_test',
    })
    .withExposedPorts(5432)
    .start();

  console.log('Starting Redis container...');
  redisContainer = await new GenericContainer('redis:7-alpine')
    .withExposedPorts(6379)
    .start();

  const pgHost = pgContainer.getHost();
  const pgPort = pgContainer.getMappedPort(5432);
  const redisHost = redisContainer.getHost();
  const redisPort = redisContainer.getMappedPort(6379);

  const databaseUrl = `postgresql://test:test@${pgHost}:${pgPort}/slangua_test?schema=public`;
  const redisUrl = `redis://${redisHost}:${redisPort}`;

  // Set test environment variables
  process.env.NODE_ENV = 'test';
  process.env.DATABASE_URL = databaseUrl;
  process.env.REDIS_URL = redisUrl;
  process.env.JWT_SECRET = 'test-jwt-secret-deterministic-32-chars-minimum-length';
  process.env.REFRESH_TOKEN_HMAC_SECRET = 'test-refresh-hmac-secret-deterministic-32-chars-minimum';
  process.env.PREVIEW_ROOT_KEY = 'MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY=';
  process.env.PREVIEW_KEY_VERSION = 'test-v1';
  process.env.TELEGRAM_BOT_TOKEN = '123456789:TEST_TOKEN_ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  process.env.TELEGRAM_INLINE_ENABLED = 'true';
  process.env.AI_PROVIDER_PRIORITY = 'ollama';
  process.env.OPENAI_API_KEY = '';
  process.env.ANTHROPIC_API_KEY = '';
  process.env.GEMINI_API_KEY = '';

  // Run prisma migrate deploy
  console.log('Running prisma migrate deploy...');
  execSync('npx prisma migrate deploy', {
    env: { ...process.env, DATABASE_URL: databaseUrl },
    stdio: 'inherit',
    cwd: process.cwd(),
  });

  console.log(`PostgreSQL: ${databaseUrl}`);
  console.log(`Redis: ${redisUrl}`);

  // Write connection info to temp file for setupFiles to read
  const connectionInfo = { databaseUrl, redisUrl };
  const tempFile = join(tmpdir(), 'slangua-test-connection.json');
  writeFileSync(tempFile, JSON.stringify(connectionInfo), 'utf-8');
  process.env.SLANGUA_TEST_CONNECTION_FILE = tempFile;

  return { databaseUrl, redisUrl };
}

export async function teardown() {
  console.log('Starting global teardown...');

  if (redisContainer) {
    await redisContainer.stop();
  }

  if (pgContainer) {
    await pgContainer.stop();
  }

  console.log('Global teardown complete');
}
