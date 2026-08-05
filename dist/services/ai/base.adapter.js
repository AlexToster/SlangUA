"use strict";
/**
 * Base AI Adapter
 *
 * Abstract base class providing common functionality for all AI providers:
 * - Retry logic with exponential backoff
 * - Timeout handling
 * - Configuration management
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.BaseAdapter = void 0;
const config_1 = require("../../config");
class BaseAdapter {
    config;
    constructor(providerConfig = {}) {
        this.config = {
            enabled: providerConfig.enabled ?? true,
            apiKey: providerConfig.apiKey,
            timeout: providerConfig.timeout ?? 30000,
            maxRetries: providerConfig.maxRetries ?? config_1.config.AI_MAX_RETRIES,
            retryDelayMs: providerConfig.retryDelayMs ?? config_1.config.AI_RETRY_DELAY_MS,
            priority: providerConfig.priority ?? 0,
        };
    }
    /**
     * Check if provider is configured and available
     */
    isAvailable() {
        return this.config.enabled && !!this.config.apiKey;
    }
    /**
     * Execute a function with timeout
     */
    async withTimeout(promise, timeoutMs, operationName) {
        let timeoutId;
        const timeoutPromise = new Promise((_, reject) => {
            timeoutId = setTimeout(() => {
                reject(new Error(`${operationName} timed out after ${timeoutMs}ms`));
            }, timeoutMs);
        });
        try {
            const result = await Promise.race([promise, timeoutPromise]);
            clearTimeout(timeoutId);
            return result;
        }
        catch (error) {
            clearTimeout(timeoutId);
            throw error;
        }
    }
    /**
     * Execute a function with retry logic
     */
    async withRetry(fn, operationName) {
        let lastError;
        const maxAttempts = this.config.maxRetries + 1;
        for (let attempt = 1; attempt <= maxAttempts; attempt++) {
            try {
                return await fn();
            }
            catch (error) {
                lastError = error;
                // Don't retry on certain errors (e.g., invalid API key, bad request)
                if (this.isNonRetryableError(error)) {
                    throw error;
                }
                if (attempt < maxAttempts) {
                    const delay = this.config.retryDelayMs * Math.pow(2, attempt - 1);
                    await this.sleep(delay);
                }
            }
        }
        throw lastError;
    }
    /**
     * Check if an error is non-retryable
     * Override in subclasses for provider-specific logic
     */
    isNonRetryableError(error) {
        if (error instanceof Error) {
            const message = error.message.toLowerCase();
            // Common non-retryable errors
            if (message.includes('invalid api key') ||
                message.includes('unauthorized') ||
                message.includes('forbidden') ||
                message.includes('bad request') ||
                message.includes('quota exceeded') ||
                message.includes('insufficient_quota')) {
                return true;
            }
        }
        return false;
    }
    /**
     * Sleep utility
     */
    sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
    /**
     * Build system prompt for slang translation
     */
    buildSystemPrompt(style) {
        const stylePrompts = {
            'GEN_Z': 'Translate the user\'s text into Gen-Z slang. Use terms like "slay", "bet", "no cap", "rizz", "sus", "fire", "GOAT", "stan", "periodt", "skrrt", "yeet", "fam", "mood", "vibes", "lowkey", "highkey", "simp", "based", "cringe", "drip", "flex", "ghost", "salty", "shade", "tea", "wig", "bussin", "cheugy". Keep it natural and conversational.',
            'STREET': 'Translate the user\'s text into street/urban slang. Use authentic street language, colloquialisms, and urban vernacular. Keep it raw and real.',
            'IT_SLANG': 'Translate the user\'s text into IT/tech slang. Use terms like "deploy", "push to prod", "debug", "refactor", "legacy", "tech debt", "CI/CD", "docker", "k8s", "microservices", "API", "endpoint", "latency", "throughput", "scalability", "observability", "containerize", "orchestrate", "pipeline", "build", "commit", "merge", "branch", "PR", "code review", "lint", "test", "staging", "prod", "hotfix", "rollback", "downtime", "incident", "on-call", "pager", "SLA", "SLO", "SLI". Make it sound like a developer talking to another developer.',
        };
        const basePrompt = `You are a slang translator. Your task is to translate the given text into the specified slang style.
Rules:
1. Only return the translated text, nothing else
2. Do not add explanations, quotes, or formatting
3. Keep the meaning but make it sound natural in the target slang
4. If the input is already in that slang, return it as-is
5. Handle any language input (Ukrainian, Russian, English, etc.)`;
        return `${basePrompt}\n\nStyle: ${stylePrompts[style] || stylePrompts['GEN_Z']}`;
    }
}
exports.BaseAdapter = BaseAdapter;
//# sourceMappingURL=base.adapter.js.map