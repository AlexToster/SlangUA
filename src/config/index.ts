import { z } from 'zod';
import { isScryptHash } from '../lib/password';

/**
 * Secrets that must never keep their `.env.example` value in production.
 *
 * Every placeholder in the example file is valid by *shape* - the dummy
 * PREVIEW_ROOT_KEY really does decode to 32 bytes, the example JWT secret
 * really is longer than 32 characters - so shape validation alone lets a
 * "copy .env.example and edit later" deploy boot on secrets that are public in
 * this repository. The check below is the only thing standing between that
 * mistake and a signing key everyone can read.
 */
const PRODUCTION_FORBIDDEN_SECRETS = [
  'JWT_SECRET',
  'REFRESH_TOKEN_HMAC_SECRET',
  'PREVIEW_ROOT_KEY',
  'TELEGRAM_BOT_TOKEN',
  'TELEGRAM_WEBHOOK_SECRET',
] as const;

/** Marker carried by every textual placeholder in `.env.example`. */
const PLACEHOLDER_MARKER = /example-only|replace-me/i;

/**
 * Placeholders with no marker to look for. PREVIEW_ROOT_KEY has to be base64 of
 * 32 bytes, so its example value is the raw byte sequence 0x00..0x1F.
 */
const PLACEHOLDER_VALUES = new Set([
  'AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8=',
]);

function isPlaceholderSecret(value: string): boolean {
  return PLACEHOLDER_MARKER.test(value) || PLACEHOLDER_VALUES.has(value.trim());
}

export const envSchema = z.object({
  // Server
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().default(3000),
  HOST: z.string().default('0.0.0.0'),

  // Database
  DATABASE_URL: z.string().url(),

  // Redis
  REDIS_URL: z.string().url(),

  // JWT
  JWT_SECRET: z.string().min(32),
  JWT_ACCESS_TTL: z.string().default('15m'),
  JWT_REFRESH_TTL: z.string().default('7d'),

  // Refresh Token HMAC
  REFRESH_TOKEN_HMAC_SECRET: z.string().min(32),

  // Telegram
  TELEGRAM_BOT_TOKEN: z.string().min(1),
  TELEGRAM_INLINE_ENABLED: z.enum(['true', 'false']).transform(v => v === 'true').default('false'),
  TELEGRAM_WEBHOOK_SECRET: z.string().min(1).optional(),
  AUTH_DATE_TTL: z.coerce.number().default(86400), // 24 hours in seconds

  // AI Provider API Keys
  // Each accepts a comma-separated list. Several keys for one provider are
  // rotated: a key that is rate-limited or out of quota is parked for a cooldown
  // and the next one serves the request, which is what makes a free tier usable.
  OPENAI_API_KEY: z.string().optional(),
  ANTHROPIC_API_KEY: z.string().optional(),
  GEMINI_API_KEY: z.string().optional(),
  OPENROUTER_API_KEY: z.string().optional(),

  // How long an exhausted API key stays parked, in milliseconds.
  // `rate` covers short-term limits (requests per minute) and is deliberately
  // cheap, because Gemini reports a spent free-tier day the same way. `quota`
  // covers an explicitly spent budget. `invalid` covers a rejected key: parked
  // like a spent one so a single bad key cannot fail every request that lands on
  // it, and logged at error level because it needs a human.
  AI_KEY_COOLDOWN_RATE_MS: z.coerce.number().default(60000),
  AI_KEY_COOLDOWN_QUOTA_MS: z.coerce.number().default(3600000),
  AI_KEY_COOLDOWN_INVALID_MS: z.coerce.number().default(3600000),

  // AI Provider Model Names
  AI_MODEL_OPENAI: z.string().default('gpt-4o-mini'),
  AI_MODEL_ANTHROPIC: z.string().default('claude-3-haiku-20240307'),
  AI_MODEL_GEMINI: z.string().default('gemini-3.6-flash'),
  AI_MODEL_OLLAMA: z.string().default('llama3.1:8b'),
  AI_MODEL_OPENROUTER: z.string().default('nvidia/nemotron-3-nano-30b-a3b:free'),

  // Base URLs of the OpenAI-compatible instances. One adapter serves all of
  // them, so pointing a provider at another compatible endpoint (Groq,
  // DeepSeek, vLLM, a proxy) is a config change, not a code change. The URL
  // must include the API version segment. Ollama has no variable of its own:
  // its base URL is derived from OLLAMA_BASE_URL below.
  AI_BASE_URL_OPENAI: z.string().url().default('https://api.openai.com/v1'),
  AI_BASE_URL_OPENROUTER: z.string().url().default('https://openrouter.ai/api/v1'),

  // Extra OpenAI-compatible instances, comma-separated ids (e.g. "groq,deepseek").
  // Each id <ID> is configured through AI_BASE_URL_<ID>, AI_MODEL_<ID>,
  // <ID>_API_KEY and the optional AI_TIMEOUT_<ID>. Those names depend on this
  // value, so they cannot be declared in this schema; provider.factory.ts
  // validates them and skips an instance it cannot build, with an error log.
  // Ids are lowercase, must match PROVIDER_ID_PATTERN and cannot shadow a
  // built-in provider.
  AI_EXTRA_INSTANCES: z.string().default(''),

  // AI Provider Priority (comma-separated instance ids). Order defines the
  // fallback chain; a configured instance the list does not mention still takes
  // part, sorted last.
  AI_PROVIDER_PRIORITY: z.string().default('openai,anthropic,gemini,ollama,openrouter'),

  // AI Provider Timeouts (ms)
  AI_TIMEOUT_OPENAI: z.coerce.number().default(30000),
  AI_TIMEOUT_ANTHROPIC: z.coerce.number().default(30000),
  AI_TIMEOUT_GEMINI: z.coerce.number().default(30000),
  AI_TIMEOUT_OLLAMA: z.coerce.number().default(60000),
  AI_TIMEOUT_OPENROUTER: z.coerce.number().default(30000),

  // AI Provider Retry
  AI_MAX_RETRIES: z.coerce.number().default(2),
  AI_RETRY_DELAY_MS: z.coerce.number().default(1000),
  AI_MAX_FALLBACK_ATTEMPTS: z.coerce.number().optional(),

  // Circuit Breaker
  CIRCUIT_BREAKER_FAILURE_THRESHOLD: z.coerce.number().default(5),
  CIRCUIT_BREAKER_RESET_MS: z.coerce.number().default(60000),

  // Ollama
  // Host of a local Ollama; the OpenAI-compatible path `/v1` is appended by
  // provider.factory.ts, because Ollama is now just another instance of the
  // OpenAI-compatible adapter.
  OLLAMA_BASE_URL: z.string().url().default('http://localhost:11434'),
  // Ollama needs no API key, so it cannot be enabled by "is a key present?" like
  // the other providers. Left unset it follows NODE_ENV: on outside production
  // (local dev and the integration-test mock), off in production, where a
  // forgotten localhost provider would otherwise sit in the fallback chain and
  // burn a timeout on every request. See provider.factory.ts.
  OLLAMA_ENABLED: z.enum(['true', 'false']).transform(v => v === 'true').optional(),

  // Speech-to-text (voice input in the text field)
  //
  // Deliberately separate from the AI provider block above, with its own keys:
  // transcription is not translation, it has no style engine, no circuit
  // breaker and no fallback chain, and mixing the keys would let a spent
  // transcription quota park a key the translator still needs. The service
  // speaks the OpenAI-compatible `/v1/audio/transcriptions` format, so pointing
  // it at another compatible endpoint is a config change; the default is Groq,
  // whose free tier serves whisper-large-v3-turbo.
  //
  // With no key configured the endpoint answers 503 STT_UNAVAILABLE and the
  // client hides the microphone - the same "is a key present?" availability
  // rule the AI providers use.
  STT_API_KEY: z.string().optional(),
  STT_BASE_URL: z.string().url().default('https://api.groq.com/openai/v1'),
  STT_MODEL: z.string().default('whisper-large-v3-turbo'),
  // Passed as the `language` hint. Set explicitly rather than left to
  // autodetection: the input is Ukrainian colloquial speech, and Whisper
  // mistakes short Ukrainian clips for Russian often enough to matter.
  STT_LANGUAGE: z.string().default('uk'),
  STT_TIMEOUT_MS: z.coerce.number().int().positive().default(30000),
  // Server-side ceiling on the decoded audio, enforced before the upstream call.
  // The client caps recording at 30 s, which is ~120 KB of Opus; 1 MiB leaves
  // room for iOS's less efficient AAC without letting the endpoint be used as a
  // file-upload channel. The route's own bodyLimit is derived from this.
  STT_MAX_AUDIO_BYTES: z.coerce.number().int().positive().default(1048576),

  // How long an exhausted transcription key stays parked, in milliseconds.
  // Same three kinds and the same reasoning as AI_KEY_COOLDOWN_*, but its own
  // values: on a free tier a per-minute limit is the normal state here, not an
  // incident.
  STT_KEY_COOLDOWN_RATE_MS: z.coerce.number().int().positive().default(60000),
  STT_KEY_COOLDOWN_QUOTA_MS: z.coerce.number().int().positive().default(3600000),
  STT_KEY_COOLDOWN_INVALID_MS: z.coerce.number().int().positive().default(3600000),

  // Transcription Rate Limiting (own budget: one request carries audio and
  // costs upstream quota that is shared by every user of the app)
  STT_RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().default(60000),
  STT_RATE_LIMIT_MAX_REQUESTS: z.coerce.number().int().positive().default(6),
  STT_RATE_LIMIT_KEY_PREFIX: z.string().default('ratelimit:stt'),

  // Rate Limiting
  GLOBAL_RATE_LIMIT_WINDOW_MS: z.coerce.number().default(60000),
  GLOBAL_RATE_LIMIT_MAX_REQUESTS: z.coerce.number().default(100),
  RATE_LIMIT_WINDOW_MS: z.coerce.number().default(60000),
  RATE_LIMIT_MAX_REQUESTS: z.coerce.number().default(100),

  // Auth Rate Limiting (separate from the generic per-user limit)
  // Both endpoints are keyed by IP, because neither has an authenticated user
  // yet, and both mint tokens - so they get their own, much tighter budget
  // instead of sharing the 100/min that history and the other routes live on.
  AUTH_RATE_LIMIT_WINDOW_MS: z.coerce.number().default(60000),
  AUTH_RATE_LIMIT_MAX_REQUESTS: z.coerce.number().default(20),
  REFRESH_RATE_LIMIT_WINDOW_MS: z.coerce.number().default(60000),
  REFRESH_RATE_LIMIT_MAX_REQUESTS: z.coerce.number().default(20),
  
  // Preview Rate Limiting (its own budget: a preview is cheap to ask for and
  // expensive to serve, since it calls the LLM)
  PREVIEW_RATE_LIMIT_WINDOW_MS: z.coerce.number().default(60000),
  PREVIEW_RATE_LIMIT_MAX_REQUESTS: z.coerce.number().default(12),
  PREVIEW_RATE_LIMIT_KEY_PREFIX: z.string().default('ratelimit:preview'),
  
  // Save Rate Limiting (separate from preview: a save costs a database write,
  // never an LLM call)
  SAVE_RATE_LIMIT_WINDOW_MS: z.coerce.number().default(60000),
  SAVE_RATE_LIMIT_MAX_REQUESTS: z.coerce.number().default(10),
  SAVE_RATE_LIMIT_KEY_PREFIX: z.string().default('ratelimit:save'),
  
  // Preview Cache
  PREVIEW_CACHE_TTL_SECONDS: z.coerce.number().default(600), // 10 minutes
  // A 32-byte random key, encoded as base64. Domain-specific keys are derived with HKDF.
  PREVIEW_ROOT_KEY: z.string().refine(
    (value) => /^[A-Za-z0-9+/]+={0,2}$/.test(value) && Buffer.from(value, 'base64').length === 32,
    'PREVIEW_ROOT_KEY must be a base64-encoded 32-byte key',
  ),
  PREVIEW_KEY_VERSION: z.string().regex(/^[A-Za-z0-9._-]{1,32}$/).default('v1'),

  // Telegram share payloads
  SHARE_CACHE_TTL_SECONDS: z.coerce.number().default(600),
  SHARE_RATE_LIMIT_WINDOW_MS: z.coerce.number().default(60000),
  SHARE_RATE_LIMIT_MAX_REQUESTS: z.coerce.number().default(10),
  SHARE_RATE_LIMIT_KEY_PREFIX: z.string().default('ratelimit:share'),

  // Telegram Webhook Rate Limiting
  WEBHOOK_RATE_LIMIT_WINDOW_MS: z.coerce.number().default(60000),
  WEBHOOK_RATE_LIMIT_MAX_REQUESTS: z.coerce.number().default(30),
  WEBHOOK_RATE_LIMIT_KEY_PREFIX: z.string().default('ratelimit:webhook'),

  // Trust Proxy (for correct IP detection behind reverse proxy)
  TRUST_PROXY: z.enum(['true', 'false']).transform(v => v === 'true').default('false'),

  // CORS
  CORS_ALLOWED_ORIGINS: z.string().default('http://localhost:5173'),

  // Logging
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),

  // Admin panel
  // Comma-separated Telegram user ids allowed into /api/v1/admin/*. Empty is
  // the off switch for the whole surface, and the default: an unconfigured
  // deployment must not have an admin panel at all, rather than one with a
  // guessable way in. Ids only - a username can be changed by its owner and is
  // not what Telegram signs into initData.
  ADMIN_TELEGRAM_IDS: z
    .string()
    .refine(
      (value) =>
        value.trim() === '' ||
        value
          .split(',')
          .every((entry) => /^\d{1,20}$/.test(entry.trim())),
      'ADMIN_TELEGRAM_IDS must be a comma-separated list of numeric Telegram user ids',
    )
    .default(''),
  // scrypt hash produced by scripts/hash-admin-password.mjs. Validated by shape
  // at boot so a mangled copy-paste surfaces on start instead of looking like a
  // wrong password forever. Empty means "no password configured", which is only
  // legal while ADMIN_TELEGRAM_IDS is empty too (see superRefine below).
  //
  // Intentionally absent from PRODUCTION_FORBIDDEN_SECRETS: `.env.example` ships
  // this variable empty, because any example value that passed the shape check
  // would be a hash of a password published in this repository. There is
  // therefore no placeholder to detect - the superRefine rule below covers the
  // real failure mode instead.
  //
  // The message names single quotes on purpose: the hash carries three `$`, and
  // Docker Compose interpolates `env_file` values, so the most likely way to
  // reach this error is a correct hash pasted unquoted into a deployed .env.
  ADMIN_PASSWORD_HASH: z
    .string()
    .refine(
      (value) => value.trim() === '' || isScryptHash(value),
      'ADMIN_PASSWORD_HASH must have the form scrypt$N=<n>,r=<r>,p=<p>$<salt base64>$<key base64>; generate it with scripts/hash-admin-password.mjs and put it in .env inside single quotes - unquoted, Docker Compose interpolates $N and $p out of an otherwise correct hash',
    )
    .default(''),
  // Idle window: slides forward on every admin request.
  ADMIN_SESSION_TTL_SECONDS: z.coerce.number().int().positive().default(900),
  // Absolute window: never slides, so a leaked admin token dies within 8 hours
  // however actively it is used.
  ADMIN_SESSION_ABSOLUTE_TTL_SECONDS: z.coerce.number().int().positive().default(28800),
  // Password attempts. The global 100/min budget is no defence against
  // guessing, so the login endpoint gets both its own sliding window (429) and
  // a per-Telegram-id lockout that outlives the window.
  ADMIN_LOGIN_RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().default(300000),
  ADMIN_LOGIN_RATE_LIMIT_MAX: z.coerce.number().int().positive().default(5),
  ADMIN_LOGIN_MAX_FAILURES: z.coerce.number().int().positive().default(5),
  ADMIN_LOGIN_LOCKOUT_MS: z.coerce.number().int().positive().default(900000),
  // Budget for the authenticated admin endpoints themselves.
  ADMIN_RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().default(60000),
  ADMIN_RATE_LIMIT_MAX_REQUESTS: z.coerce.number().int().positive().default(120),
  // Usage metrics. Counters live in Redis only and expire on their own, so these
  // numbers bound how much history exists at all - there is no pruning job and
  // nothing to migrate. The upper bounds are not taste: the minute series is read
  // with one MGET per counter, and the daily rows with one ZCARD per day, so an
  // unbounded value would turn a panel refresh into a large Redis round trip.
  METRICS_MINUTE_SERIES_LENGTH: z.coerce.number().int().positive().max(1440).default(60),
  METRICS_RETENTION_DAYS: z.coerce.number().int().positive().max(90).default(7),
  METRICS_TOP_USERS_LIMIT: z.coerce.number().int().positive().max(100).default(10),
  // Error feed. A capped Redis list: newest first, trimmed on every write and
  // expiring as a whole, because the pino logs remain the real archive.
  ADMIN_ERROR_FEED_MAX: z.coerce.number().int().positive().max(1000).default(100),
  ADMIN_ERROR_FEED_TTL_SECONDS: z.coerce.number().int().positive().default(604800),
}).superRefine((data, ctx) => {
  if (data.TELEGRAM_INLINE_ENABLED && (!data.TELEGRAM_WEBHOOK_SECRET || data.TELEGRAM_WEBHOOK_SECRET.trim() === '')) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'TELEGRAM_WEBHOOK_SECRET is required when TELEGRAM_INLINE_ENABLED is true',
      path: ['TELEGRAM_WEBHOOK_SECRET'],
    });
  }

  // An allowlist without a password would be single-factor: whoever controls
  // one of those Telegram accounts would walk straight in. Fail the boot instead
  // of silently serving the panel behind one factor.
  if (data.ADMIN_TELEGRAM_IDS.trim() !== '' && data.ADMIN_PASSWORD_HASH.trim() === '') {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message:
        "ADMIN_PASSWORD_HASH is required when ADMIN_TELEGRAM_IDS is set. Generate it with: node scripts/hash-admin-password.mjs, then add it to .env in single quotes: ADMIN_PASSWORD_HASH='scrypt$N=...'",
      path: ['ADMIN_PASSWORD_HASH'],
    });
  }

  // An absolute window shorter than the idle one would make the idle window
  // dead code and the session expire earlier than configured.
  if (data.ADMIN_SESSION_ABSOLUTE_TTL_SECONDS < data.ADMIN_SESSION_TTL_SECONDS) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message:
        'ADMIN_SESSION_ABSOLUTE_TTL_SECONDS must be greater than or equal to ADMIN_SESSION_TTL_SECONDS',
      path: ['ADMIN_SESSION_ABSOLUTE_TTL_SECONDS'],
    });
  }

  // Only production: development and the test suites are meant to run on
  // placeholders, and failing there would make the example file unusable.
  if (data.NODE_ENV !== 'production') return;

  for (const key of PRODUCTION_FORBIDDEN_SECRETS) {
    const value = data[key];
    if (typeof value === 'string' && isPlaceholderSecret(value)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        // The offending value is a known public placeholder, but it is still a
        // secret-shaped variable: report the name only, never the value.
        message: `${key} still holds the .env.example placeholder, which is public. Generate a real value before deploying to production.`,
        path: [key],
      });
    }
  }
});

type Env = z.infer<typeof envSchema>;

let env: Env;

export function loadConfig(): Env {
  if (env) return env;

  const result = envSchema.safeParse(process.env);

  if (!result.success) {
    console.error(' Invalid environment variables:');
    console.error(result.error.flatten().fieldErrors);
    process.exit(1);
  }

  env = result.data;
  return env;
}

export function getConfig(): Env {
  if (!env) {
    return loadConfig();
  }
  return env;
}

export const config = getConfig();