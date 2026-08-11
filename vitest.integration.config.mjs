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
      PREVIEW_ROOT_KEY: 'MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY=',
      PREVIEW_KEY_VERSION: 'test-v1',
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
});
