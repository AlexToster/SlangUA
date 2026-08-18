import type { FastifyInstance } from 'fastify';

// All imports moved to beforeAll to ensure globalSetup runs first
let getAppInstance: () => FastifyInstance;
let flushRedis: () => Promise<void>;

describe('Health Integration Tests', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    await import('./setup-test-context.js').then(m => m.setup());

    const testContext = await import('./test-context.js');
    getAppInstance = testContext.getAppInstance;
    flushRedis = testContext.flushRedis;

    app = getAppInstance();
  });

  beforeEach(async () => {
    await flushRedis();
  });

  describe('GET /health', () => {
    // Liveness: answers from the process alone, so it must not be metered and
    // must not depend on Postgres or Redis being reachable.
    it('reports ok with a timestamp', async () => {
      const response = await app.inject({ method: 'GET', url: '/health' });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.status).toBe('ok');
      expect(Number.isNaN(Date.parse(body.timestamp))).toBe(false);
    });

    it('is not metered by the global limiter', async () => {
      const response = await app.inject({ method: 'GET', url: '/health' });
      expect(response.headers['x-ratelimit-limit']).toBeUndefined();
    });
  });

  describe('GET /health/ready', () => {
    // Readiness: with both containers up this is the only expected outcome. The
    // failure branch is not exercised here — killing the shared Postgres or Redis
    // would break every other suite in the run.
    it('reports both dependencies up while the containers are running', async () => {
      const response = await app.inject({ method: 'GET', url: '/health/ready' });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.status).toBe('ok');
      expect(body.checks).toEqual({ database: 'up', redis: 'up' });
      expect(Number.isNaN(Date.parse(body.timestamp))).toBe(false);
    });

    // Unlike liveness, readiness touches both stores, so it stays behind the
    // coarse per-IP limiter. Any probe interval is far below that budget.
    it('is metered by the global limiter', async () => {
      const response = await app.inject({ method: 'GET', url: '/health/ready' });
      expect(response.headers['x-ratelimit-limit']).toBeDefined();
    });
  });
});
