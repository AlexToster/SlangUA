"use strict";
/**
 * Gemini Adapter
 *
 * Implements the IAIProvider interface for Google Gemini API.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.GeminiAdapter = void 0;
const client_1 = require("@prisma/client");
const generative_ai_1 = require("@google/generative-ai");
const base_adapter_1 = require("./base.adapter");
const config_1 = require("../../config");
class GeminiAdapter extends base_adapter_1.BaseAdapter {
    provider = client_1.AIProvider.GEMINI;
    model = 'gemini-1.5-flash';
    client = null;
    modelInstance = null;
    constructor(providerConfig = {}) {
        super({
            ...providerConfig,
            apiKey: providerConfig.apiKey ?? config_1.config.GEMINI_API_KEY,
            timeout: providerConfig.timeout ?? config_1.config.AI_TIMEOUT_GEMINI,
            priority: providerConfig.priority ?? 2,
        });
        if (this.config.apiKey) {
            this.client = new generative_ai_1.GoogleGenerativeAI(this.config.apiKey);
            this.modelInstance = this.client.getGenerativeModel({ model: this.model });
        }
    }
    isAvailable() {
        return super.isAvailable() && !!this.modelInstance;
    }
    async translate(request) {
        if (!this.modelInstance) {
            throw new Error('Gemini model not initialized - missing API key');
        }
        const systemPrompt = this.buildSystemPrompt(request.style);
        const fullPrompt = `${systemPrompt}\n\nUser: ${request.text}\n\nTranslation:`;
        const response = await this.withRetry(async () => {
            return this.withTimeout(this.modelInstance.generateContent(fullPrompt), this.config.timeout, 'Gemini translation');
        }, 'Gemini translation');
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
        if (error instanceof Error) {
            const message = error.message.toLowerCase();
            // Check for specific Gemini API errors that are non-retryable
            if (message.includes('api key not valid') ||
                message.includes('permission denied') ||
                message.includes('quota exceeded') ||
                message.includes('invalid argument') ||
                message.includes('not found')) {
                return true;
            }
        }
        return super.isNonRetryableError(error);
    }
    /**
     * Process the Gemini response and extract translation
     */
    processResponse(response, request) {
        const translatedText = response.response.text().trim();
        // Gemini doesn't always provide usage info in the same way
        const usageMetadata = response.response.usageMetadata;
        return {
            translatedText,
            provider: this.provider,
            model: this.model,
            usage: usageMetadata ? {
                promptTokens: usageMetadata.promptTokenCount || 0,
                completionTokens: usageMetadata.candidatesTokenCount || 0,
                totalTokens: usageMetadata.totalTokenCount || 0,
            } : undefined,
        };
    }
}
exports.GeminiAdapter = GeminiAdapter;
//# sourceMappingURL=gemini.adapter.js.map