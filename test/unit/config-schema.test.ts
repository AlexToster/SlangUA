/**
 * Environment schema unit tests.
 *
 * The focus is the production placeholder guard. Every secret in `.env.example`
 * passes shape validation on purpose (the dummy PREVIEW_ROOT_KEY decodes to 32
 * bytes, the example JWT secret is over 32 characters), so a "copy the example
 * and edit later" deploy used to boot on secrets that are public in this
 * repository. These tests pin down that production refuses them and that
 * development still accepts them.
 *
 * The schema is parsed directly rather than through loadConfig(), which calls
 * process.exit(1) on failure.
 */

import { describe, it, expect } from 'vitest';
import { envSchema } from '../../src/config/index';

/** Values that satisfy every REQUIRED variable and no placeholder rule. */
const REAL_SECRETS = {
  DATABASE_URL: 'postgresql://user:password@localhost:5432/slangua?schema=public',
  REDIS_URL: 'redis://localhost:6379',
  JWT_SECRET: 'f3a9c1d7b5e2408a96c4d0f8b7a1e6c3d9204f8b',
  REFRESH_TOKEN_HMAC_SECRET: '7c1e4a90d5b8f2360a9e7c4b1d8f5a2093e6c7b4',
  TELEGRAM_BOT_TOKEN: '123456789:AAF-real-looking-bot-token-value',
  PREVIEW_ROOT_KEY: 'MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY=',
};

/** The literal values shipped in `.env.example`. */
const EXAMPLE_SECRETS = {
  JWT_SECRET: 'example-only-jwt-secret-replace-me-32-chars-min',
  REFRESH_TOKEN_HMAC_SECRET: 'example-only-refresh-hmac-secret-replace-me-32',
  TELEGRAM_BOT_TOKEN: '123456789:example-only-bot-token-replace-me',
  PREVIEW_ROOT_KEY: 'AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8=',
};

function parse(env: Record<string, string>) {
  return envSchema.safeParse(env);
}

/** Variable names the parse failed on, as reported to the operator at boot. */
function failedKeys(result: ReturnType<typeof parse>): string[] {
  if (result.success) return [];
  return Object.keys(result.error.flatten().fieldErrors);
}

describe('envSchema', () => {
  it('accepts real secrets in production', () => {
    const result = parse({ NODE_ENV: 'production', ...REAL_SECRETS });
    expect(result.success).toBe(true);
  });

  it('accepts the .env.example placeholders outside production', () => {
    for (const NODE_ENV of ['development', 'test']) {
      const result = parse({ NODE_ENV, ...REAL_SECRETS, ...EXAMPLE_SECRETS });
      expect(result.success, `${NODE_ENV} should accept placeholders`).toBe(true);
    }
  });

  it('rejects every .env.example placeholder in production', () => {
    for (const [key, value] of Object.entries(EXAMPLE_SECRETS)) {
      const result = parse({ NODE_ENV: 'production', ...REAL_SECRETS, [key]: value });
      expect(result.success, `${key} placeholder should be rejected`).toBe(false);
      expect(failedKeys(result)).toContain(key);
    }
  });

  it('rejects the placeholder webhook secret in production', () => {
    const result = parse({
      NODE_ENV: 'production',
      ...REAL_SECRETS,
      TELEGRAM_INLINE_ENABLED: 'true',
      TELEGRAM_WEBHOOK_SECRET: 'example-only-webhook-secret-replace-me',
    });
    expect(result.success).toBe(false);
    expect(failedKeys(result)).toContain('TELEGRAM_WEBHOOK_SECRET');
  });

  it('never echoes the offending value in the message', () => {
    const result = parse({ NODE_ENV: 'production', ...REAL_SECRETS, ...EXAMPLE_SECRETS });
    expect(result.success).toBe(false);
    const messages = JSON.stringify(result.success ? [] : result.error.issues);
    for (const value of Object.values(EXAMPLE_SECRETS)) {
      expect(messages).not.toContain(value);
    }
  });

  it('still requires TELEGRAM_WEBHOOK_SECRET when inline sharing is on', () => {
    const result = parse({ NODE_ENV: 'production', ...REAL_SECRETS, TELEGRAM_INLINE_ENABLED: 'true' });
    expect(result.success).toBe(false);
    expect(failedKeys(result)).toContain('TELEGRAM_WEBHOOK_SECRET');
  });
});

/**
 * The admin block is validated at boot rather than at the first login attempt,
 * because every failure mode here is silent otherwise: a mangled hash looks
 * exactly like a wrong password forever, and an allowlist without a hash serves
 * the panel behind a single factor.
 */
describe('envSchema: admin panel', () => {
  /** A real hash of an unrelated throwaway password, in the stored format. */
  const VALID_HASH =
    'scrypt$N=16384,r=8,p=1$ehN6SvtS/mSclfA2LB+tAg==$Y4inoYaGkMWg25H+XHlzZfJQZqwdAh+TByZjqlzJKD4=';

  it('defaults to no admin panel at all', () => {
    const result = parse({ NODE_ENV: 'production', ...REAL_SECRETS });
    expect(result.success).toBe(true);
    expect(result.success && result.data.ADMIN_TELEGRAM_IDS).toBe('');
    expect(result.success && result.data.ADMIN_PASSWORD_HASH).toBe('');
  });

  it('accepts one id and a list of ids', () => {
    for (const ADMIN_TELEGRAM_IDS of ['555000111', '555000111,555000222', ' 555000111 , 555000222 ']) {
      const result = parse({
        NODE_ENV: 'production',
        ...REAL_SECRETS,
        ADMIN_TELEGRAM_IDS,
        ADMIN_PASSWORD_HASH: VALID_HASH,
      });
      expect(result.success, `${ADMIN_TELEGRAM_IDS} should be accepted`).toBe(true);
    }
  });

  it('rejects usernames and other non-numeric entries', () => {
    // A username can be changed by its owner and is not what Telegram signs
    // into initData, so accepting one would be a moving allowlist.
    for (const ADMIN_TELEGRAM_IDS of ['@operator', '555000111,@operator', '555000111;555000222', '555000111,']) {
      const result = parse({
        NODE_ENV: 'production',
        ...REAL_SECRETS,
        ADMIN_TELEGRAM_IDS,
        ADMIN_PASSWORD_HASH: VALID_HASH,
      });
      expect(result.success, `${ADMIN_TELEGRAM_IDS} should be rejected`).toBe(false);
      expect(failedKeys(result)).toContain('ADMIN_TELEGRAM_IDS');
    }
  });

  it('refuses an allowlist without a password hash', () => {
    const result = parse({ NODE_ENV: 'production', ...REAL_SECRETS, ADMIN_TELEGRAM_IDS: '555000111' });
    expect(result.success).toBe(false);
    expect(failedKeys(result)).toContain('ADMIN_PASSWORD_HASH');
  });

  it('accepts a password hash with no allowlist', () => {
    // Harmless: with no ids configured every admin route answers 404 anyway, and
    // failing here would block the "generate the hash first" order of work.
    const result = parse({ NODE_ENV: 'production', ...REAL_SECRETS, ADMIN_PASSWORD_HASH: VALID_HASH });
    expect(result.success).toBe(true);
  });

  it('rejects a mangled hash by shape', () => {
    const mangled = [
      'not-a-hash',
      'scrypt$N=16384,r=8,p=1$onlyonefield',
      // A truncated copy-paste: the base64 key is too short to be a 32-byte key.
      'scrypt$N=16384,r=8,p=1$ehN6SvtS/mSclfA2LB+tAg==$Y4in',
      // N must be a power of two; scrypt itself would throw at login time.
      'scrypt$N=16000,r=8,p=1$ehN6SvtS/mSclfA2LB+tAg==$Y4inoYaGkMWg25H+XHlzZfJQZqwdAh+TByZjqlzJKD4=',
      VALID_HASH.replace('scrypt', 'bcrypt'),
    ];

    for (const ADMIN_PASSWORD_HASH of mangled) {
      const result = parse({
        NODE_ENV: 'production',
        ...REAL_SECRETS,
        ADMIN_TELEGRAM_IDS: '555000111',
        ADMIN_PASSWORD_HASH,
      });
      expect(result.success, `${ADMIN_PASSWORD_HASH} should be rejected`).toBe(false);
      expect(failedKeys(result)).toContain('ADMIN_PASSWORD_HASH');
    }
  });

  it('refuses an absolute session window shorter than the idle one', () => {
    const result = parse({
      NODE_ENV: 'production',
      ...REAL_SECRETS,
      ADMIN_TELEGRAM_IDS: '555000111',
      ADMIN_PASSWORD_HASH: VALID_HASH,
      ADMIN_SESSION_TTL_SECONDS: '3600',
      ADMIN_SESSION_ABSOLUTE_TTL_SECONDS: '900',
    });
    expect(result.success).toBe(false);
    expect(failedKeys(result)).toContain('ADMIN_SESSION_ABSOLUTE_TTL_SECONDS');
  });

  it('accepts equal idle and absolute windows', () => {
    const result = parse({
      NODE_ENV: 'production',
      ...REAL_SECRETS,
      ADMIN_TELEGRAM_IDS: '555000111',
      ADMIN_PASSWORD_HASH: VALID_HASH,
      ADMIN_SESSION_TTL_SECONDS: '900',
      ADMIN_SESSION_ABSOLUTE_TTL_SECONDS: '900',
    });
    expect(result.success).toBe(true);
  });

  it('rejects a non-positive limit or window', () => {
    for (const key of [
      'ADMIN_SESSION_TTL_SECONDS',
      'ADMIN_LOGIN_RATE_LIMIT_MAX',
      'ADMIN_LOGIN_MAX_FAILURES',
      'ADMIN_LOGIN_LOCKOUT_MS',
      'ADMIN_RATE_LIMIT_MAX_REQUESTS',
    ]) {
      const result = parse({
        NODE_ENV: 'production',
        ...REAL_SECRETS,
        ADMIN_TELEGRAM_IDS: '555000111',
        ADMIN_PASSWORD_HASH: VALID_HASH,
        [key]: '0',
      });
      expect(result.success, `${key}=0 should be rejected`).toBe(false);
      expect(failedKeys(result)).toContain(key);
    }
  });

  it('never echoes the hash in an error message', () => {
    const result = parse({
      NODE_ENV: 'production',
      ...REAL_SECRETS,
      ADMIN_TELEGRAM_IDS: '@operator',
      ADMIN_PASSWORD_HASH: VALID_HASH,
    });
    expect(result.success).toBe(false);
    const messages = JSON.stringify(result.success ? [] : result.error.issues);
    expect(messages).not.toContain(VALID_HASH);
  });
});
