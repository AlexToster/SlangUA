import { defineConfig } from 'vitest/config';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Unit tests: no containers, no network, no Docker.
 *
 * Separate from the integration config on purpose - these run in a second and
 * are meant to be the fast feedback loop for pure logic (key rotation,
 * cooldowns, fallback bookkeeping). Anything that needs Postgres or Redis
 * belongs in test/integration instead.
 */
export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['test/unit/**/*.test.ts'],
    testTimeout: 10000,
    // src/config exits the process on an invalid environment, so the schema's
    // required keys must be satisfied even for tests that never touch the DB.
    env: {
      NODE_ENV: 'test',
      DATABASE_URL: 'postgresql://user:password@localhost:5432/slangua_unit?schema=public',
      REDIS_URL: 'redis://localhost:6379',
      JWT_SECRET: 'unit-test-jwt-secret-not-real-000000000000',
      REFRESH_TOKEN_HMAC_SECRET: 'unit-test-refresh-hmac-secret-not-real-0000',
      TELEGRAM_BOT_TOKEN: '123456789:unit-test-bot-token-not-real',
      PREVIEW_ROOT_KEY: 'MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY=',
      PREVIEW_KEY_VERSION: 'unit-v1',
      // Pinned so the fallback tests do not depend on schema defaults.
      CIRCUIT_BREAKER_FAILURE_THRESHOLD: '5',
      CIRCUIT_BREAKER_RESET_MS: '60000',
      AI_MAX_RETRIES: '2',
      AI_RETRY_DELAY_MS: '1',
      AI_KEY_COOLDOWN_RATE_MS: '60000',
      AI_KEY_COOLDOWN_QUOTA_MS: '3600000',
      AI_KEY_COOLDOWN_INVALID_MS: '3600000',
      // Small on purpose: the metrics tests assert on exact bucket lists, and a
      // 60-minute series would say nothing a 5-minute one does not.
      METRICS_MINUTE_SERIES_LENGTH: '5',
      METRICS_RETENTION_DAYS: '3',
      METRICS_TOP_USERS_LIMIT: '2',
      ADMIN_ERROR_FEED_MAX: '3',
      ADMIN_ERROR_FEED_TTL_SECONDS: '604800',
      LOG_LEVEL: 'fatal',
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
});
