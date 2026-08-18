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
