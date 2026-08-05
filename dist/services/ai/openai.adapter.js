"use strict";
/**
 * OpenAI Adapter
 *
 * Implements the IAIProvider interface for OpenAI API.
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.OpenAIAdapter = void 0;
const client_1 = require("@prisma/client");
const openai_1 = __importDefault(require("openai"));
const base_adapter_1 = require("./base.adapter");
const config_1 = require("../../config");
class OpenAIAdapter extends base_adapter_1.BaseAdapter {
    provider = client_1.AIProvider.OPENAI;
    model = 'gpt-4o-mini';
    client = null;
    constructor(providerConfig = {}) {
        super({
            ...providerConfig,
            apiKey: providerConfig.apiKey ?? config_1.config.OPENAI_API_KEY,
            timeout: providerConfig.timeout ?? config_1.config.AI_TIMEOUT_OPENAI,
            priority: providerConfig.priority ?? 0,
        });
        if (this.config.apiKey) {
            this.client = new openai_1.default({
                apiKey: this.config.apiKey,
            });
        }
    }
    isAvailable() {
        return super.isAvailable() && !!this.client;
    }
    async translate(request) {
        if (!this.client) {
            throw new Error('OpenAI client not initialized - missing API key');
        }
        const systemPrompt = this.buildSystemPrompt(request.style);
        const response = await this.withRetry(async () => {
            return this.withTimeout(this.client.chat.completions.create({
                model: this.model,
                messages: [
                    { role: 'system', content: systemPrompt },
                    { role: 'user', content: request.text },
                ],
                temperature: 0.7,
                max_tokens: 500,
            }), this.config.timeout, 'OpenAI translation');
        }, 'OpenAI translation');
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
                // Check for non-retryable OpenAI errors
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
        if (error instanceof openai_1.default.APIError) {
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
     * Process the OpenAI response and extract translation
     */
    processResponse(response, request) {
        const translatedText = response.choices[0]?.message?.content?.trim() || '';
        return {
            translatedText,
            provider: this.provider,
            model: this.model,
            usage: response.usage ? {
                promptTokens: response.usage.prompt_tokens,
                completionTokens: response.usage.completion_tokens,
                totalTokens: response.usage.total_tokens,
            } : undefined,
        };
    }
}
exports.OpenAIAdapter = OpenAIAdapter;
//# sourceMappingURL=openai.adapter.js.map