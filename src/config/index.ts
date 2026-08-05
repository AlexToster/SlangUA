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
  AUTH_DATE_TTL: z.coerce.number().default(86400), // 24 hours in seconds

  // AI Provider API Keys
  OPENAI_API_KEY: z.string().optional(),
  ANTHROPIC_API_KEY: z.string().optional(),
  GEMINI_API_KEY: z.string().optional(),

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

  // Rate Limiting
  RATE_LIMIT_WINDOW_MS: z.coerce.number().default(60000),
  RATE_LIMIT_MAX_REQUESTS: z.coerce.number().default(100),

  // Trust Proxy (for correct IP detection behind reverse proxy)
  TRUST_PROXY: z.coerce.boolean().default(false),

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