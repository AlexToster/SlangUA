"use strict";
/**
 * Ollama Adapter
 *
 * Implements the IAIProvider interface for local Ollama API.
 * No API key required - connects to local Ollama instance.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.OllamaAdapter = void 0;
const client_1 = require("@prisma/client");
const ollama_1 = require("ollama");
const base_adapter_1 = require("./base.adapter");
const config_1 = require("../../config");
class OllamaAdapter extends base_adapter_1.BaseAdapter {
    provider = client_1.AIProvider.OLLAMA;
    model = 'llama3.1:8b';
    client = null;
    baseUrl;
    constructor(providerConfig = {}) {
        super({
            ...providerConfig,
            // Ollama doesn't need an API key
            apiKey: providerConfig.apiKey ?? 'ollama-local',
            timeout: providerConfig.timeout ?? config_1.config.AI_TIMEOUT_OLLAMA,
            priority: providerConfig.priority ?? 3,
        });
        this.baseUrl = process.env.OLLAMA_BASE_URL || 'http://localhost:11434';
        this.client = new ollama_1.Ollama({ host: this.baseUrl });
    }
    isAvailable() {
        // Ollama is available if the client is initialized
        // We could add a health check here, but for now just check client exists
        return this.config.enabled && !!this.client;
    }
    async translate(request) {
        if (!this.client) {
            throw new Error('Ollama client not initialized');
        }
        const systemPrompt = this.buildSystemPrompt(request.style);
        const response = await this.withRetry(async () => {
            return this.withTimeout(this.client.chat({
                model: this.model,
                messages: [
                    { role: 'system', content: systemPrompt },
                    { role: 'user', content: request.text },
                ],
                options: {
                    temperature: 0.7,
                    num_predict: 500,
                },
            }), this.config.timeout, 'Ollama translation');
        }, 'Ollama translation');
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
            // Ollama specific non-retryable errors
            if (message.includes('model not found') ||
                message.includes('connection refused') ||
                message.includes('econnrefused') ||
                message.includes('invalid model') ||
                message.includes('pull model')) {
                return true;
            }
        }
        return super.isNonRetryableError(error);
    }
    /**
     * Process the Ollama response and extract translation
     */
    processResponse(response, request) {
        const translatedText = response.message.content.trim();
        return {
            translatedText,
            provider: this.provider,
            model: this.model,
            // Ollama doesn't provide token usage in the same way
            usage: undefined,
        };
    }
}
exports.OllamaAdapter = OllamaAdapter;
//# sourceMappingURL=ollama.adapter.js.map