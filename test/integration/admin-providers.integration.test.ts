/**
 * Operator kill-switch integration tests (stage B).
 *
 * Stage A proved who can reach the panel; this proves that what the panel does
 * actually reaches the translation path. Three properties, all against a real
 * Redis:
 *
 * 1. A switch flipped through the API changes runtime behaviour immediately -
 *    `POST /translate/preview` answers 503 while the only provider is off, and
 *    serves again the moment it is switched back on.
 * 2. The switch is state, not a hint: it lives in Redis under a key with no TTL,
 *    carries who flipped it and when, and nothing automatic clears it.
 * 3. The route inherits the whole door from stage A - invisible to a non-admin,
 *    401 without a step-up token - and answers a typo with a 400 rather than the
 *    404 that would send the operator through a pointless password prompt.
 *
 * `AI_PROVIDER_PRIORITY=ollama` with no API keys (see global-setup.ts) means the
 * mock Ollama server is the only usable provider here, so switching it off is
 * exactly the "last usable provider" case.
 */

import type { FastifyInstance } from 'fastify';

const ADMIN_PASSWORD = 'test-admin-password-not-real';
const ADMIN_TELEGRAM_ID = 555000111;
const REGULAR_TELEGRAM_ID = 123456789;
/** The one provider the integration environment actually configures. */
const LIVE_PROVIDER = 'ollama';
/** Configured nowhere in this environment: no API key, so no instance. */
const UNCONFIGURED_PROVIDER = 'openai';

let getAppInstance: () => FastifyInstance;
let getRedisUrl: () => string;
let truncateDatabase: () => Promise<void>;
let flushRedis: () => Promise<void>;
let generateValidInitData: (options?: any) => string;
let setMockConfig: (config: any) => void;

interface ProviderRow {
  id: string;
  available: boolean;
  configured: boolean;
  priority: number;
  disabled: boolean;
  disabledAt: string | null;
  disabledBy: string | null;
  disabledReason: string | null;
}

describe('Admin provider kill-switch integration tests', () => {
  let app: FastifyInstance;
  let adminToken: string;
  let userToken: string;
  let stepUp: string;

  async function login(telegramId: number, firstName: string): Promise<string> {
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/telegram',
      payload: { initData: generateValidInitData({ user: { id: telegramId, first_name: firstName } }) },
    });
    expect(response.statusCode).toBe(200);
    return JSON.parse(response.body).accessToken;
  }

  async function openAdminSession(accessToken: string): Promise<string> {
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/admin/session',
      headers: { authorization: `Bearer ${accessToken}` },
      payload: { password: ADMIN_PASSWORD },
    });
    expect(response.statusCode).toBe(200);
    return JSON.parse(response.body).token;
  }

  /** PATCH the switch as the fully authenticated admin. */
  async function patchProvider(providerId: string, body: Record<string, unknown>) {
    return app.inject({
      method: 'PATCH',
      url: `/api/v1/admin/providers/${providerId}`,
      headers: { authorization: `Bearer ${adminToken}`, 'x-admin-token': stepUp },
      payload: body,
    });
  }

  async function overview() {
    return app.inject({
      method: 'GET',
      url: '/api/v1/admin/overview',
      headers: { authorization: `Bearer ${adminToken}`, 'x-admin-token': stepUp },
    });
  }

  /** A translation as an ordinary user - the behaviour the switch is meant to change. */
  async function preview() {
    return app.inject({
      method: 'POST',
      url: '/api/v1/translate/preview',
      headers: { authorization: `Bearer ${userToken}` },
      payload: { text: 'Привіт, як справи?', style: 'GEN_Z' },
    });
  }

  function row(body: string, providerId: string): ProviderRow {
    const found = (JSON.parse(body).providers as ProviderRow[]).find((p) => p.id === providerId);
    expect(found).toBeDefined();
    return found!;
  }

  beforeAll(async () => {
    await import('./setup-test-context.js').then((m) => m.setup());

    const testContext = await import('./test-context.js');
    getAppInstance = testContext.getAppInstance;
    getRedisUrl = testContext.getRedisUrl;
    truncateDatabase = testContext.truncateDatabase;
    flushRedis = testContext.flushRedis;

    const telegramInitData = await import('../helpers/telegram-initdata.js');
    generateValidInitData = telegramInitData.generateValidInitData;

    const mockOllama = await import('../helpers/mock-ollama-server.js');
    setMockConfig = mockOllama.setMockConfig;

    app = getAppInstance();
  });

  beforeEach(async () => {
    // Flushing Redis clears the kill-switch as well, so every test starts with
    // every provider switched on - and the tokens must be minted afterwards.
    await flushRedis();
    await truncateDatabase();
    setMockConfig({ shouldFail: false });

    adminToken = await login(ADMIN_TELEGRAM_ID, 'Admin');
    userToken = await login(REGULAR_TELEGRAM_ID, 'Test');
    stepUp = await openAdminSession(adminToken);
  });

  describe('PATCH /admin/providers/:providerId', () => {
    it('switches a provider off and answers with the whole chain', async () => {
      const response = await patchProvider(LIVE_PROVIDER, { disabled: true, reason: 'key leaked' });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      // The whole chain, not just the row that moved: one switch changes what the
      // rest of the list means.
      expect(body.providers.length).toBeGreaterThan(1);
      expect(Date.parse(body.generatedAt)).not.toBeNaN();

      const changed = row(response.body, LIVE_PROVIDER);
      expect(changed.disabled).toBe(true);
      expect(changed.disabledBy).toBe(String(ADMIN_TELEGRAM_ID));
      expect(Date.parse(changed.disabledAt as string)).not.toBeNaN();
      expect(changed.disabledReason).toBe('key leaked');
      // `available` still describes health, not intent - the two answers are
      // separate columns on purpose.
      expect(changed.available).toBe(true);
    });

    it('accepts a switch with no explanation', async () => {
      const response = await patchProvider(LIVE_PROVIDER, { disabled: true });

      expect(response.statusCode).toBe(200);
      const changed = row(response.body, LIVE_PROVIDER);
      expect(changed.disabled).toBe(true);
      expect(changed.disabledReason).toBeNull();
    });

    it('is visible in the overview afterwards', async () => {
      await patchProvider(LIVE_PROVIDER, { disabled: true, reason: 'bill ran away' });

      const response = await overview();
      expect(response.statusCode).toBe(200);
      const changed = row(response.body, LIVE_PROVIDER);
      expect(changed.disabled).toBe(true);
      expect(changed.disabledReason).toBe('bill ran away');
    });

    it('switches a provider back on', async () => {
      await patchProvider(LIVE_PROVIDER, { disabled: true, reason: 'incident' });
      const response = await patchProvider(LIVE_PROVIDER, { disabled: false });

      expect(response.statusCode).toBe(200);
      const changed = row(response.body, LIVE_PROVIDER);
      expect(changed.disabled).toBe(false);
      // Provenance goes away with the switch: a cleared switch has no story.
      expect(changed.disabledAt).toBeNull();
      expect(changed.disabledBy).toBeNull();
      expect(changed.disabledReason).toBeNull();
    });

    it('is idempotent in both directions', async () => {
      await patchProvider(LIVE_PROVIDER, { disabled: true, reason: 'first' });
      const again = await patchProvider(LIVE_PROVIDER, { disabled: true, reason: 'second' });
      expect(again.statusCode).toBe(200);
      // A repeat call refreshes the story rather than adding a second switch.
      expect(row(again.body, LIVE_PROVIDER).disabledReason).toBe('second');

      await patchProvider(LIVE_PROVIDER, { disabled: false });
      const noop = await patchProvider(LIVE_PROVIDER, { disabled: false });
      expect(noop.statusCode).toBe(200);
      expect(row(noop.body, LIVE_PROVIDER).disabled).toBe(false);
    });

    it('can pre-emptively switch off a provider this deployment has no key for', async () => {
      // An operator may want a provider to stay off even after somebody adds its
      // key - so an unconfigured id is a legal target, not a typo.
      const response = await patchProvider(UNCONFIGURED_PROVIDER, { disabled: true });

      expect(response.statusCode).toBe(200);
      const changed = row(response.body, UNCONFIGURED_PROVIDER);
      expect(changed.configured).toBe(false);
      expect(changed.disabled).toBe(true);
    });

    it('stores the switch in Redis with no expiry', async () => {
      await patchProvider(LIVE_PROVIDER, { disabled: true, reason: 'incident' });

      const { Redis } = await import('ioredis');
      const redis = new Redis(getRedisUrl());
      try {
        const stored = await redis.hgetall('ai:provider:disabled');
        expect(Object.keys(stored)).toEqual([LIVE_PROVIDER]);
        expect(JSON.parse(stored[LIVE_PROVIDER])).toEqual({
          by: String(ADMIN_TELEGRAM_ID),
          at: expect.any(String),
          reason: 'incident',
        });
        // -1 is "no TTL". An expiring kill-switch would put a provider back into
        // the chain at an arbitrary moment with nobody watching.
        expect(await redis.ttl('ai:provider:disabled')).toBe(-1);
      } finally {
        await redis.quit();
      }
    });

    it('rejects an id this deployment has never heard of with 400', async () => {
      const response = await patchProvider('nosuchprovider', { disabled: true });

      // Deliberately not 404: on admin routes a 404 means "there is no panel for
      // you", and the client answers one by asking for the password again.
      expect(response.statusCode).toBe(400);
      expect(JSON.parse(response.body).code).toBe('ADMIN_PROVIDER_UNKNOWN');
    });

    const malformedIds = ['UPPERCASE', '-leading-dash', 'has space', 'a'.repeat(40)];

    it.each(malformedIds)('rejects a malformed id: %s', async (providerId) => {
      const response = await patchProvider(encodeURIComponent(providerId), { disabled: true });

      expect(response.statusCode).toBe(400);
      expect(JSON.parse(response.body).code).toBe('VALIDATION_ERROR');
    });

    const malformedBodies: Array<{ name: string; payload: Record<string, unknown> }> = [
      { name: 'no disabled field', payload: { reason: 'why' } },
      { name: 'disabled as a string', payload: { disabled: 'true' } },
      { name: 'an over-long reason', payload: { disabled: true, reason: 'x'.repeat(201) } },
      { name: 'a reason of the wrong type', payload: { disabled: true, reason: 42 } },
    ];

    it.each(malformedBodies)('rejects $name', async ({ payload }) => {
      const response = await patchProvider(LIVE_PROVIDER, payload);

      expect(response.statusCode).toBe(400);
      expect(JSON.parse(response.body).code).toBe('VALIDATION_ERROR');
    });

    it('never leaks a key or a hash in the answer', async () => {
      const response = await patchProvider(LIVE_PROVIDER, { disabled: true });

      expect(response.body).not.toMatch(/api[_-]?key/i);
      expect(response.body).not.toContain('scrypt');
      expect(response.body).not.toContain('sk-');
    });
  });

  describe('effect on the translation path', () => {
    it('answers 503 while the only usable provider is switched off', async () => {
      const before = await preview();
      expect(before.statusCode).toBe(200);

      await patchProvider(LIVE_PROVIDER, { disabled: true, reason: 'incident' });

      const during = await preview();
      // Byte-identical request to the warm-up above on purpose: it is a preview
      // cache hit, and the switch has to outrank the cache too. Otherwise a
      // provider killed mid-incident keeps serving its own cached output for the
      // rest of the preview TTL, and the operator cannot tell whether the flip
      // took effect.
      expect(during.statusCode).toBe(503);
      // The same code an outage produces: an operator decision needs no new error
      // code, and the client already knows this one.
      expect(JSON.parse(during.body).code).toBe('AI_PROVIDER_UNAVAILABLE');
      // The user is not told which provider an operator switched off, or why.
      expect(during.body).not.toContain(LIVE_PROVIDER);
      expect(during.body).not.toContain('incident');
    });

    it('serves again as soon as the provider is switched back on', async () => {
      await patchProvider(LIVE_PROVIDER, { disabled: true });
      expect((await preview()).statusCode).toBe(503);

      await patchProvider(LIVE_PROVIDER, { disabled: false });

      const after = await preview();
      expect(after.statusCode).toBe(200);
      expect(JSON.parse(after.body).providerId).toBe(LIVE_PROVIDER);
    });

    it('leaves translation working when an unused provider is switched off', async () => {
      await patchProvider(UNCONFIGURED_PROVIDER, { disabled: true });

      const response = await preview();
      expect(response.statusCode).toBe(200);
    });
  });

  describe('the door in front of the switch', () => {
    it('is invisible to an authenticated non-admin', async () => {
      const url = `/api/v1/admin/providers/${LIVE_PROVIDER}`;
      const response = await app.inject({
        method: 'PATCH',
        url,
        headers: { authorization: `Bearer ${userToken}`, 'x-admin-token': stepUp },
        payload: { disabled: true },
      });

      expect(response.statusCode).toBe(404);
      expect(JSON.parse(response.body)).toEqual({
        message: `Route PATCH:${url} not found`,
        error: 'Not Found',
        statusCode: 404,
      });
      // A stranger's request must never reach the switch itself.
      const stillOn = await overview();
      expect(row(stillOn.body, LIVE_PROVIDER).disabled).toBe(false);
    });

    it('answers 404 with no credentials at all', async () => {
      const response = await app.inject({
        method: 'PATCH',
        url: `/api/v1/admin/providers/${LIVE_PROVIDER}`,
        payload: { disabled: true },
      });

      expect(response.statusCode).toBe(404);
    });

    it('demands the step-up token from an allowlisted admin', async () => {
      const response = await app.inject({
        method: 'PATCH',
        url: `/api/v1/admin/providers/${LIVE_PROVIDER}`,
        headers: { authorization: `Bearer ${adminToken}` },
        payload: { disabled: true },
      });

      expect(response.statusCode).toBe(401);
      expect(JSON.parse(response.body).code).toBe('ADMIN_SESSION_REQUIRED');
    });

    it('rejects a made-up step-up token', async () => {
      const response = await app.inject({
        method: 'PATCH',
        url: `/api/v1/admin/providers/${LIVE_PROVIDER}`,
        headers: { authorization: `Bearer ${adminToken}`, 'x-admin-token': 'a'.repeat(43) },
        payload: { disabled: true },
      });

      expect(response.statusCode).toBe(401);
      expect(JSON.parse(response.body).code).toBe('ADMIN_SESSION_INVALID');
    });

    it('stops working once the panel is locked', async () => {
      await app.inject({
        method: 'DELETE',
        url: '/api/v1/admin/session',
        headers: { authorization: `Bearer ${adminToken}`, 'x-admin-token': stepUp },
      });

      const response = await patchProvider(LIVE_PROVIDER, { disabled: true });
      expect(response.statusCode).toBe(401);
      expect(JSON.parse(response.body).code).toBe('ADMIN_SESSION_INVALID');
    });
  });
});
