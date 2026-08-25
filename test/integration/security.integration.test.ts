import type { FastifyInstance } from 'fastify';
import { SignJWT } from 'jose';

/**
 * The checks the rest of the integration suite leaves out.
 *
 * Every other file drives the API with a token the server itself just issued,
 * so all of them prove the same thing: a valid token works. None of them proves
 * the opposite half, which is the half that matters — that a token the server
 * did *not* issue is refused. `authenticate` trusts the JWT completely: there is
 * no database lookup behind it, `request.user.id` is whatever `userId` claim the
 * token carries. A signature check that silently stopped verifying would break
 * nothing any existing test asserts, and would hand every user's history to
 * anyone able to write JSON.
 *
 * Same reasoning for the other three groups here: cross-user *reads* (the write
 * side is covered in the history suite by the 404s on another user's row, but
 * nothing asserted that a list request cannot see somebody else's rows), and the
 * rate limiter's fail-closed behaviour, which is a deliberate design decision
 * (`src/plugins/rate-limit.ts`) with no test — the failure mode it prevents is
 * unmetered access to a paid LLM.
 *
 * Every forgery case is paired with a control token that differs only in the one
 * property under test, so a 401 cannot be scored as a pass for the wrong reason
 * (a typo in the URL, a missing header, an exhausted budget).
 */

// Imports are deferred to beforeAll so globalSetup runs first, matching the
// other suites.
let getAppInstance: () => FastifyInstance;
let getPrismaClient: () => any;
let flushRedis: () => Promise<void>;
let generateValidInitData: (options?: any) => string;
let getRedisClient: () => { multi: (...args: unknown[]) => unknown };
let jwtSecret: Uint8Array;

/** Signs an access token with the claims `generateAccessToken` produces. */
async function signAccessToken(options: {
  userId: number;
  telegramId: string;
  secret: Uint8Array;
  jti?: string;
  expiresAt?: number;
}): Promise<string> {
  const jti = options.jti ?? 'rt_999999';
  const now = Math.floor(Date.now() / 1000);
  return new SignJWT({ userId: options.userId, telegramId: options.telegramId, jti })
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setIssuedAt(now)
    .setExpirationTime(options.expiresAt ?? now + 900)
    .setJti(jti)
    .sign(options.secret);
}

/** Replaces the payload segment of a real token, leaving header and signature. */
function tamperPayload(token: string, mutate: (claims: Record<string, unknown>) => void): string {
  const [header, payload, signature] = token.split('.');
  const claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as Record<string, unknown>;
  mutate(claims);
  const forged = Buffer.from(JSON.stringify(claims), 'utf8').toString('base64url');
  return `${header}.${forged}.${signature}`;
}

describe('Security Integration Tests', () => {
  let app: FastifyInstance;
  let prisma: any;
  let accessToken1: string;
  let accessToken2: string;
  let userId1: number;
  let userId2: number;

  beforeAll(async () => {
    await import('./setup-test-context.js').then(m => m.setup());

    const testContext = await import('./test-context.js');
    getAppInstance = testContext.getAppInstance;
    getPrismaClient = testContext.getPrismaClient;
    flushRedis = testContext.flushRedis;

    generateValidInitData = (await import('../helpers/telegram-initdata.js')).generateValidInitData;
    getRedisClient = (await import('../../src/lib/redis.js')).getRedisClient;
    // The real signing key, read from the same config the server uses: a
    // hardcoded copy here would pass even if the server switched secrets.
    jwtSecret = new TextEncoder().encode((await import('../../src/config/index.js')).config.JWT_SECRET);

    app = getAppInstance();
    prisma = getPrismaClient();

    accessToken1 = await authenticateAs(766000001, 'SecOne');
    accessToken2 = await authenticateAs(766000002, 'SecTwo');
    userId1 = (await prisma.user.findUnique({ where: { telegramId: '766000001' } }))!.id;
    userId2 = (await prisma.user.findUnique({ where: { telegramId: '766000002' } }))!.id;
  });

  async function authenticateAs(telegramId: number, firstName: string): Promise<string> {
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/telegram',
      payload: { initData: generateValidInitData({ user: { id: telegramId, first_name: firstName } }) },
    });
    expect(response.statusCode).toBe(200);
    return JSON.parse(response.body).accessToken;
  }

  beforeEach(async () => {
    // Flushing Redis also resets every rate-limit window, so a 401 assertion
    // can never be a 429 in disguise.
    await flushRedis();
    await prisma.translation.deleteMany({ where: { userId: { in: [userId1, userId2] } } });
  });

  function getMe(token: string) {
    return app.inject({
      method: 'GET',
      url: '/api/v1/user/me',
      headers: { authorization: `Bearer ${token}` },
    });
  }

  describe('Access token forgery', () => {
    it('rejects a token signed with the wrong secret', async () => {
      const forged = await signAccessToken({
        userId: userId1,
        telegramId: '766000001',
        secret: new TextEncoder().encode('an-attacker-secret-of-legal-length-32+'),
      });

      const response = await getMe(forged);

      expect(response.statusCode).toBe(401);
      expect(JSON.parse(response.body).code).toBe('INVALID_TOKEN');
    });

    it('accepts the same claims when they are signed with the real secret', async () => {
      // The control for the case above: identical payload, different key. If this
      // fails, the 401 there proved nothing about the signature.
      const legitimate = await signAccessToken({
        userId: userId1,
        telegramId: '766000001',
        secret: jwtSecret,
      });

      const response = await getMe(legitimate);

      expect(response.statusCode).toBe(200);
      // /user/me answers with the profile behind the `userId` claim, so the body
      // also shows *which* identity the token bought.
      expect(JSON.parse(response.body).telegramId).toBe('766000001');
    });

    it('rejects a token whose payload was swapped for another user', async () => {
      // The escalation this blocks: user1's own token, valid signature, with the
      // `userId` claim pointed at user2. Nothing downstream re-checks identity —
      // `authenticate` copies the claim into `request.user` — so the signature is
      // the only thing standing between a user and somebody else's account.
      const forged = tamperPayload(accessToken1, claims => {
        claims.userId = userId2;
        claims.telegramId = '766000002';
      });

      const response = await getMe(forged);

      expect(response.statusCode).toBe(401);
      expect(JSON.parse(response.body).code).toBe('INVALID_TOKEN');
      expect(response.body).not.toContain('766000002');
    });

    it('rejects an unsigned token that asks for alg: none', async () => {
      const claims = {
        userId: userId1,
        telegramId: '766000001',
        jti: 'rt_999999',
        iat: Math.floor(Date.now() / 1000),
        exp: Math.floor(Date.now() / 1000) + 900,
      };
      const encode = (value: unknown) => Buffer.from(JSON.stringify(value), 'utf8').toString('base64url');
      const unsigned = `${encode({ alg: 'none', typ: 'JWT' })}.${encode(claims)}.`;

      const response = await getMe(unsigned);

      expect(response.statusCode).toBe(401);
      expect(JSON.parse(response.body).code).toBe('INVALID_TOKEN');
    });

    it('rejects an access token whose exp has passed', async () => {
      const now = Math.floor(Date.now() / 1000);
      const expired = await signAccessToken({
        userId: userId1,
        telegramId: '766000001',
        secret: jwtSecret,
        expiresAt: now - 60,
      });

      const response = await getMe(expired);

      expect(response.statusCode).toBe(401);
      expect(JSON.parse(response.body).code).toBe('INVALID_TOKEN');

      // Same key, same claims, `exp` a minute ahead instead of a minute behind:
      // the only difference between the two calls is the expiry.
      const fresh = await signAccessToken({
        userId: userId1,
        telegramId: '766000001',
        secret: jwtSecret,
        expiresAt: now + 60,
      });
      expect((await getMe(fresh)).statusCode).toBe(200);
    });
  });

  describe('History read isolation', () => {
    /**
     * Texts that make ownership visible in a failure message: if a filter ever
     * leaks, the diff names the other user's row instead of printing two
     * indistinguishable "Test 1"s.
     */
    async function seedTwoUsers(): Promise<void> {
      await prisma.translation.createMany({
        data: [
          { userId: userId1, originalText: 'mine one', translatedText: 'mine one out', slangStyle: 'GEN_Z', providerId: 'ollama', favorite: false },
          { userId: userId1, originalText: 'mine two', translatedText: 'mine two out', slangStyle: 'STREET', providerId: 'ollama', favorite: true },
          { userId: userId2, originalText: 'theirs one', translatedText: 'theirs one out', slangStyle: 'GEN_Z', providerId: 'ollama', favorite: false },
          { userId: userId2, originalText: 'theirs two', translatedText: 'theirs two out', slangStyle: 'IT_SLANG', providerId: 'ollama', favorite: true },
          { userId: userId2, originalText: 'theirs three', translatedText: 'theirs three out', slangStyle: 'GALICIAN', providerId: 'ollama', favorite: true },
        ],
      });
    }

    function getHistory(token: string, query = '') {
      return app.inject({
        method: 'GET',
        url: `/api/v1/history${query}`,
        headers: { authorization: `Bearer ${token}` },
      });
    }

    it('lists only the caller rows and counts only the caller rows', async () => {
      await seedTwoUsers();

      const response = await getHistory(accessToken1);

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.data.map((row: { originalText: string }) => row.originalText).sort()).toEqual(['mine one', 'mine two']);
      // totalCount is what the UI renders as "2/100". A leak here stays invisible
      // in the list itself and still tells the caller how much history somebody
      // else has.
      expect(body.totalCount).toBe(2);
    });

    it('does not let the search filter reach another user rows', async () => {
      await seedTwoUsers();

      // A term that matches three of user2's rows and none of user1's. The filter
      // is a `contains` on both text columns, and a missing userId clause in that
      // `AND` would surface exactly here.
      const response = await getHistory(accessToken1, '?search=theirs');

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.data).toEqual([]);
      expect(body.totalCount).toBe(0);
    });

    it('does not let the favorite filter reach another user rows', async () => {
      await seedTwoUsers();

      // user2 has two favorites, user1 exactly one.
      const response = await getHistory(accessToken1, '?favorite=true');

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.data.map((row: { originalText: string }) => row.originalText)).toEqual(['mine two']);
      expect(body.totalCount).toBe(1);
    });

    it('does not widen a page when the cursor came from another user', async () => {
      await seedTwoUsers();

      // The cursor is an opaque base64url keyset tuple, not a row reference, so
      // handing user1's cursor to user2 is not an error — it is a position. What
      // must not happen is user2 paging into user1's rows because the tuple came
      // from there.
      const firstPage = await getHistory(accessToken1, '?limit=1');
      expect(firstPage.statusCode).toBe(200);
      const cursor = JSON.parse(firstPage.body).nextCursor;
      expect(cursor).not.toBeNull();

      const response = await getHistory(accessToken2, `?cursor=${encodeURIComponent(cursor)}`);

      expect(response.statusCode).toBe(200);
      const rows = JSON.parse(response.body).data as Array<{ originalText: string }>;
      expect(rows.every(row => row.originalText.startsWith('theirs'))).toBe(true);
    });
  });

  describe('Rate limiter fails closed', () => {
    afterEach(() => {
      vi.restoreAllMocks();
    });

    /**
     * Breaks the limiter the way an outage does, at the one call it depends on.
     * `redis.multi()` is safe to target: the auth check reads the revocation
     * denylist with `exists`, and the observability hook that also uses `multi`
     * catches its own failures by design, so the only behaviour under test is the
     * limiter's.
     */
    function breakRedisTransactions() {
      return vi.spyOn(getRedisClient(), 'multi').mockImplementation(() => {
        throw new Error('Simulated Redis outage');
      });
    }

    it('answers 503 instead of serving a read it cannot meter', async () => {
      breakRedisTransactions();

      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/history',
        headers: { authorization: `Bearer ${accessToken1}` },
      });

      expect(response.statusCode).toBe(503);
      expect(JSON.parse(response.body).code).toBe('RATE_LIMITER_UNAVAILABLE');
    });

    it('answers 503 instead of letting an unmetered request reach the LLM', async () => {
      // This is the case the fail-closed rule exists for: preview is the only
      // route that spends money, and an open limiter during an outage means
      // unbounded paid calls.
      const spy = breakRedisTransactions();

      const blocked = await app.inject({
        method: 'POST',
        url: '/api/v1/translate/preview',
        headers: { authorization: `Bearer ${accessToken1}` },
        payload: { text: 'Привіт, як справи?', style: 'GEN_Z' },
      });

      expect(blocked.statusCode).toBe(503);
      expect(JSON.parse(blocked.body).code).toBe('RATE_LIMITER_UNAVAILABLE');

      // Control: the identical request succeeds once Redis works again, so the
      // 503 came from the limiter and not from a bad payload or a broken mock.
      spy.mockRestore();
      const allowed = await app.inject({
        method: 'POST',
        url: '/api/v1/translate/preview',
        headers: { authorization: `Bearer ${accessToken1}` },
        payload: { text: 'Привіт, як справи?', style: 'GEN_Z' },
      });

      expect(allowed.statusCode).toBe(200);
    });
  });
});
