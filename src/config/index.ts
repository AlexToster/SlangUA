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

  // AI Provider Model Names
  AI_MODEL_OPENAI: z.string().default('gpt-4o-mini'),
  AI_MODEL_ANTHROPIC: z.string().default('claude-3-haiku-20240307'),
  AI_MODEL_GEMINI: z.string().default('gemini-1.5-flash'),
  AI_MODEL_OLLAMA: z.string().default('llama3.1:8b'),

  // AI Provider Priority (comma-separated)
  AI_PROVIDER_PRIORITY: z.string().default('openai,anthropic,gemini,ollama'),

  // AI Provider Timeouts (ms)
  AI_TIMEOUT_OPENAI: z.coerce.number().default(30000),
  AI_TIMEOUT_ANTHROPIC: z.coerce.number().default(30000),
  AI_TIMEOUT_GEMINI: z.coerce.number().default(30000),
  AI_TIMEOUT_OLLAMA: z.coerce.number().default(60000),

  // AI Provider Retry
  AI_MAX_RETRIES: z.coerce.number().default(2),
  AI_RETRY_DELAY_MS: z.coerce.number().default(1000),
  AI_MAX_FALLBACK_ATTEMPTS: z.coerce.number().optional(),

  // Ollama
  OLLAMA_BASE_URL: z.string().url().default('http://localhost:11434'),

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

  // Trust Proxy (for correct IP detection behind reverse proxy)
  TRUST_PROXY: z.enum(['true', 'false']).transform(v => v === 'true').default('false'),

  // Logging
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
});

type Env = z.infer<typeof envSchema>;

let env: Env;

export function loadConfig(): Env {
  if (env) return env;

  const result = envSchema.safeParse(process.env);

  if (!result.success) {
    console.error('❌ Invalid environment variables:');
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
