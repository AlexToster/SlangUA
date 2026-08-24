import { defineConfig } from 'vitest/config';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['test/integration/**/*.integration.test.ts'],
    testTimeout: 60000,
    hookTimeout: 120000,
    teardownTimeout: 60000,
    // Run tests serially because application config and service singletons are process-global
    sequence: { hooks: 'list' },
    // globalSetup runs once before all tests - starts containers and runs migrations
    globalSetup: ['test/integration/global-setup.ts'],
    // setupFiles runs in test context - initializes app/Prisma/mockOllama once (singleton)
    setupFiles: ['test/integration/setup-test-context.ts'],
    // globalTeardown runs once after all tests - stops containers
    globalTeardown: ['test/integration/global-setup.ts'],
    // Disable file-based parallelism
    fileParallelism: false,
    // Don't isolate modules between tests (we need shared app instance)
    isolate: false,
    // Set test environment variables for rate limits (low for testing)
    env: {
      RATE_LIMIT_WINDOW_MS: '60000',
      RATE_LIMIT_MAX_REQUESTS: '10',
      GLOBAL_RATE_LIMIT_MAX_REQUESTS: '100',
      // The token-minting endpoints have their own budget in production; keep it
      // small here so a test can exhaust it. The suites read these values rather
      // than hardcoding a count.
      AUTH_RATE_LIMIT_WINDOW_MS: '60000',
      AUTH_RATE_LIMIT_MAX_REQUESTS: '10',
      REFRESH_RATE_LIMIT_WINDOW_MS: '60000',
      REFRESH_RATE_LIMIT_MAX_REQUESTS: '10',
      // Telegram webhook limiter: small enough for a test to exhaust it quickly.
      WEBHOOK_RATE_LIMIT_WINDOW_MS: '60000',
      WEBHOOK_RATE_LIMIT_MAX_REQUESTS: '5',
      // The webhook route is only mounted when inline sharing is enabled, and the
      // secret must match test/integration/global-setup.ts.
      TELEGRAM_INLINE_ENABLED: 'true',
      TELEGRAM_WEBHOOK_SECRET: 'test-telegram-webhook-secret-not-real',
      PREVIEW_ROOT_KEY: 'MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY=',
      PREVIEW_KEY_VERSION: 'test-v1',
      // Admin panel. The ids and the hash must match
      // test/integration/global-setup.ts; the hash is scrypt of the literal
      // 'test-admin-password-not-real' and is a test fixture, not a secret.
      ADMIN_TELEGRAM_IDS: '555000111,555000222',
      ADMIN_PASSWORD_HASH:
        'scrypt$N=16384,r=8,p=1$ehN6SvtS/mSclfA2LB+tAg==$Y4inoYaGkMWg25H+XHlzZfJQZqwdAh+TByZjqlzJKD4=',
      // The lockout must fire before the request limiter does, otherwise the
      // lockout test can never observe its Retry-After: 5 wrong guesses trip the
      // lockout, and the 9th request in the window trips the limiter.
      ADMIN_LOGIN_MAX_FAILURES: '5',
      ADMIN_LOGIN_RATE_LIMIT_WINDOW_MS: '60000',
      ADMIN_LOGIN_RATE_LIMIT_MAX: '8',
      // Observability views. Pinned rather than left on the schema defaults so
      // the suites can assert on the echoed numbers, and small enough that a
      // failing assertion prints something readable: the minute series is ten
      // buckets instead of sixty, and the daily table two rows instead of seven.
      METRICS_MINUTE_SERIES_LENGTH: '10',
      METRICS_RETENTION_DAYS: '2',
      METRICS_TOP_USERS_LIMIT: '5',
      ADMIN_ERROR_FEED_MAX: '5',
      // An hour, not a week: the TTL is asserted, and a value distinguishable
      // from the default proves it comes from the configuration.
      ADMIN_ERROR_FEED_TTL_SECONDS: '3600',
      // Voice input. Two keys so a rotation test can watch the first one get
      // parked; STT_BASE_URL is set in setup-test-context.ts because the mock
      // server's port is dynamic.
      STT_API_KEY: 'test-stt-key-one-not-real,test-stt-key-two-not-real',
      STT_MODEL: 'whisper-large-v3-turbo',
      STT_LANGUAGE: 'uk',
      // Deliberately tiny: a 4 KiB ceiling makes the oversize case cheap to
      // construct, and the route's bodyLimit is derived from this value.
      STT_MAX_AUDIO_BYTES: '4096',
      STT_RATE_LIMIT_WINDOW_MS: '60000',
      STT_RATE_LIMIT_MAX_REQUESTS: '5',
      // Effectively no cooldown. The cooldown arithmetic is KeyPool's own unit
      // test; here a real 60-second park would survive into the next test in the
      // file, because the cooldown store is an in-process singleton and the
      // suites share one app instance. Rotation is still observable: every key
      // gets exactly one turn per request either way.
      STT_KEY_COOLDOWN_RATE_MS: '1',
      STT_KEY_COOLDOWN_QUOTA_MS: '1',
      STT_KEY_COOLDOWN_INVALID_MS: '1',
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
});
