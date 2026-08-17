import { z } from 'zod';

const envSchema = z.object({
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
  OPENAI_API_KEY: z.string().optional(),
  ANTHROPIC_API_KEY: z.string().optional(),
  GEMINI_API_KEY: z.string().optional(),
  OPENROUTER_API_KEY: z.string().optional(),

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

  // AI Provider Priority (comma-separated)
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

  // Rate Limiting
  GLOBAL_RATE_LIMIT_WINDOW_MS: z.coerce.number().default(60000),
  GLOBAL_RATE_LIMIT_MAX_REQUESTS: z.coerce.number().default(100),
  RATE_LIMIT_WINDOW_MS: z.coerce.number().default(60000),
  RATE_LIMIT_MAX_REQUESTS: z.coerce.number().default(100),
  
  // Preview Rate Limiting (separate from persistent translate)
  PREVIEW_RATE_LIMIT_WINDOW_MS: z.coerce.number().default(60000),
  PREVIEW_RATE_LIMIT_MAX_REQUESTS: z.coerce.number().default(12),
  PREVIEW_RATE_LIMIT_KEY_PREFIX: z.string().default('ratelimit:preview'),
  
  // Save Rate Limiting (separate from preview and persistent translate)
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
}).superRefine((data, ctx) => {
  if (data.TELEGRAM_INLINE_ENABLED && (!data.TELEGRAM_WEBHOOK_SECRET || data.TELEGRAM_WEBHOOK_SECRET.trim() === '')) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'TELEGRAM_WEBHOOK_SECRET is required when TELEGRAM_INLINE_ENABLED is true',
      path: ['TELEGRAM_WEBHOOK_SECRET'],
    });
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