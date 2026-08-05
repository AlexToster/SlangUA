"use strict";
/**
 * Claude (Anthropic) Adapter
 *
 * Implements the IAIProvider interface for Anthropic Claude API.
 * Provider identifier stored in database is ANTHROPIC (per Prisma schema).
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.ClaudeAdapter = void 0;
const client_1 = require("@prisma/client");
const sdk_1 = __importDefault(require("@anthropic-ai/sdk"));
const base_adapter_1 = require("./base.adapter");
const config_1 = require("../../config");
class ClaudeAdapter extends base_adapter_1.BaseAdapter {
    provider = client_1.AIProvider.ANTHROPIC;
    model = 'claude-3-haiku-20240307';
    client = null;
    constructor(providerConfig = {}) {
        super({
            ...providerConfig,
            apiKey: providerConfig.apiKey ?? config_1.config.ANTHROPIC_API_KEY,
            timeout: providerConfig.timeout ?? config_1.config.AI_TIMEOUT_ANTHROPIC,
            priority: providerConfig.priority ?? 1,
        });
        if (this.config.apiKey) {
            this.client = new sdk_1.default({
                apiKey: this.config.apiKey,
            });
        }
    }
    isAvailable() {
        return super.isAvailable() && !!this.client;
    }
    async translate(request) {
        if (!this.client) {
            throw new Error('Anthropic client not initialized - missing API key');
        }
        const systemPrompt = this.buildSystemPrompt(request.style);
        const response = await this.withRetry(async () => {
            return this.withTimeout(this.client.messages.create({
                model: this.model,
                system: systemPrompt,
                messages: [
                    { role: 'user', content: request.text },
                ],
                max_tokens: 500,
                temperature: 0.7,
            }), this.config.timeout, 'Anthropic translation');
        }, 'Anthropic translation');
        return this.processResponse(response, request);
    }
    async withRetry(fn, operationName) {
        let lastError;
        const maxAttempts = this.config.maxRetries + 1;
        for (let attempt = 1; attempt <= maxAttempts; attempt++) {
            try {
                const result = await fn();
                return result;
            }
            catch (error) {
                lastError = error;
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
    isNonRetryableError(error) {
        if (error instanceof sdk_1.default.APIError) {
            // Non-retryable status codes
            if (error.status === 400 || // Bad Request
                error.status === 401 || // Unauthorized
                error.status === 403 || // Forbidden
                error.status === 404 || // Not Found
                error.status === 422) { // Unprocessable Entity
                return true;
            }
            // Rate limit (429) is retryable
            // Server errors (5xx) are retryable
        }
        return super.isNonRetryableError(error);
    }
    /**
     * Process the Anthropic response and extract translation
     */
    processResponse(response, request) {
        const translatedText = response.content
            .filter(block => block.type === 'text')
            .map(block => block.text)
            .join('')
            .trim();
        return {
            translatedText,
            provider: this.provider,
            model: this.model,
            usage: response.usage ? {
                promptTokens: response.usage.input_tokens,
                completionTokens: response.usage.output_tokens,
                totalTokens: response.usage.input_tokens + response.usage.output_tokens,
            } : undefined,
        };
    }
}
exports.ClaudeAdapter = ClaudeAdapter;
//# sourceMappingURL=claude.adapter.js.map