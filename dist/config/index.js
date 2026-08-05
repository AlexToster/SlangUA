"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.config = void 0;
exports.loadConfig = loadConfig;
exports.getConfig = getConfig;
const zod_1 = require("zod");
const envSchema = zod_1.z.object({
    // Server
    NODE_ENV: zod_1.z.enum(['development', 'production', 'test']).default('development'),
    PORT: zod_1.z.coerce.number().default(3000),
    HOST: zod_1.z.string().default('0.0.0.0'),
    // Database
    DATABASE_URL: zod_1.z.string().url(),
    // Redis
    REDIS_URL: zod_1.z.string().url(),
    // JWT
    JWT_SECRET: zod_1.z.string().min(32),
    JWT_ACCESS_TTL: zod_1.z.string().default('15m'),
    JWT_REFRESH_TTL: zod_1.z.string().default('7d'),
    // Refresh Token HMAC
    REFRESH_TOKEN_HMAC_SECRET: zod_1.z.string().min(32),
    // Telegram
    TELEGRAM_BOT_TOKEN: zod_1.z.string().min(1),
    AUTH_DATE_TTL: zod_1.z.coerce.number().default(86400), // 24 hours in seconds
    // AI Provider API Keys
    OPENAI_API_KEY: zod_1.z.string().optional(),
    ANTHROPIC_API_KEY: zod_1.z.string().optional(),
    GEMINI_API_KEY: zod_1.z.string().optional(),
    // AI Provider Priority (comma-separated)
    AI_PROVIDER_PRIORITY: zod_1.z.string().default('openai,anthropic,gemini,ollama'),
    // AI Provider Timeouts (ms)
    AI_TIMEOUT_OPENAI: zod_1.z.coerce.number().default(30000),
    AI_TIMEOUT_ANTHROPIC: zod_1.z.coerce.number().default(30000),
    AI_TIMEOUT_GEMINI: zod_1.z.coerce.number().default(30000),
    AI_TIMEOUT_OLLAMA: zod_1.z.coerce.number().default(60000),
    // AI Provider Retry
    AI_MAX_RETRIES: zod_1.z.coerce.number().default(2),
    AI_RETRY_DELAY_MS: zod_1.z.coerce.number().default(1000),
    AI_MAX_FALLBACK_ATTEMPTS: zod_1.z.coerce.number().optional(),
    // Rate Limiting
    RATE_LIMIT_WINDOW_MS: zod_1.z.coerce.number().default(60000),
    RATE_LIMIT_MAX_REQUESTS: zod_1.z.coerce.number().default(100),
    // Trust Proxy (for correct IP detection behind reverse proxy)
    TRUST_PROXY: zod_1.z.coerce.boolean().default(false),
    // Logging
    LOG_LEVEL: zod_1.z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
});
let env;
function loadConfig() {
    if (env)
        return env;
    const result = envSchema.safeParse(process.env);
    if (!result.success) {
        console.error('❌ Invalid environment variables:');
        console.error(result.error.flatten().fieldErrors);
        process.exit(1);
    }
    env = result.data;
    return env;
}
function getConfig() {
    if (!env) {
        return loadConfig();
    }
    return env;
}
exports.config = getConfig();
//# sourceMappingURL=index.js.map