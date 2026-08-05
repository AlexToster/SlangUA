"use strict";
/**
 * Provider Factory
 *
 * Resolves and manages AI provider adapters based on configuration.
 * Handles provider priority, enable/disable flags, and availability.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.providerFactory = exports.ProviderFactory = void 0;
const client_1 = require("@prisma/client");
const openai_adapter_1 = require("./openai.adapter");
const claude_adapter_1 = require("./claude.adapter");
const gemini_adapter_1 = require("./gemini.adapter");
const ollama_adapter_1 = require("./ollama.adapter");
const config_1 = require("../../config");
class ProviderFactory {
    providers = new Map();
    priorityOrder = [];
    constructor() {
        this.initializeProviders();
    }
    /**
     * Initialize all providers based on configuration
     */
    initializeProviders() {
        // Parse priority order from config
        const priorityString = config_1.config.AI_PROVIDER_PRIORITY;
        this.priorityOrder = priorityString
            .split(',')
            .map(p => p.trim().toUpperCase())
            .filter(p => Object.values(client_1.AIProvider).includes(p));
        // Create provider instances with config
        const providerConfigs = this.buildProviderConfigs();
        // Initialize each provider
        for (const [providerName, providerConfig] of Object.entries(providerConfigs)) {
            const provider = this.createProvider(providerName, providerConfig);
            if (provider) {
                this.providers.set(providerName, provider);
            }
        }
    }
    /**
     * Build provider configurations from environment config
     */
    buildProviderConfigs() {
        const baseRetryConfig = {
            maxRetries: config_1.config.AI_MAX_RETRIES,
            retryDelayMs: config_1.config.AI_RETRY_DELAY_MS,
        };
        return {
            [client_1.AIProvider.OPENAI]: {
                enabled: !!config_1.config.OPENAI_API_KEY,
                apiKey: config_1.config.OPENAI_API_KEY,
                timeout: config_1.config.AI_TIMEOUT_OPENAI,
                priority: this.getPriority(client_1.AIProvider.OPENAI),
                ...baseRetryConfig,
            },
            [client_1.AIProvider.ANTHROPIC]: {
                enabled: !!config_1.config.ANTHROPIC_API_KEY,
                apiKey: config_1.config.ANTHROPIC_API_KEY,
                timeout: config_1.config.AI_TIMEOUT_ANTHROPIC,
                priority: this.getPriority(client_1.AIProvider.ANTHROPIC),
                ...baseRetryConfig,
            },
            [client_1.AIProvider.GEMINI]: {
                enabled: !!config_1.config.GEMINI_API_KEY,
                apiKey: config_1.config.GEMINI_API_KEY,
                timeout: config_1.config.AI_TIMEOUT_GEMINI,
                priority: this.getPriority(client_1.AIProvider.GEMINI),
                ...baseRetryConfig,
            },
            [client_1.AIProvider.OLLAMA]: {
                enabled: true, // Ollama doesn't need API key, just needs to be running
                timeout: config_1.config.AI_TIMEOUT_OLLAMA,
                priority: this.getPriority(client_1.AIProvider.OLLAMA),
                ...baseRetryConfig,
            },
        };
    }
    /**
     * Get priority index for a provider (lower = higher priority)
     */
    getPriority(provider) {
        const index = this.priorityOrder.indexOf(provider);
        return index >= 0 ? index : 999; // Unknown providers go to the end
    }
    /**
     * Create a provider instance based on name
     */
    createProvider(name, providerConfig) {
        // Skip if not enabled
        if (!providerConfig.enabled) {
            return null;
        }
        switch (name) {
            case client_1.AIProvider.OPENAI:
                return new openai_adapter_1.OpenAIAdapter(providerConfig);
            case client_1.AIProvider.ANTHROPIC:
                return new claude_adapter_1.ClaudeAdapter(providerConfig);
            case client_1.AIProvider.GEMINI:
                return new gemini_adapter_1.GeminiAdapter(providerConfig);
            case client_1.AIProvider.OLLAMA:
                return new ollama_adapter_1.OllamaAdapter(providerConfig);
            default:
                return null;
        }
    }
    /**
     * Get all available providers ordered by priority
     */
    getProviders() {
        return this.priorityOrder
            .map(provider => this.providers.get(provider))
            .filter((provider) => provider !== undefined && provider.isAvailable());
    }
    /**
     * Get a specific provider by name
     */
    getProvider(name) {
        return this.providers.get(name);
    }
    /**
     * Get the primary (highest priority) available provider
     */
    getPrimaryProvider() {
        const providers = this.getProviders();
        return providers[0];
    }
    /**
     * Check if any provider is available
     */
    hasAvailableProviders() {
        return this.getProviders().length > 0;
    }
    /**
     * Get provider status for debugging/monitoring
     */
    getProviderStatus() {
        const status = {};
        for (const provider of Object.values(client_1.AIProvider)) {
            const instance = this.providers.get(provider);
            const configured = !!instance;
            const available = instance?.isAvailable() ?? false;
            const priority = this.getPriority(provider);
            status[provider] = { available, configured, priority };
        }
        return status;
    }
}
exports.ProviderFactory = ProviderFactory;
// Export singleton instance
exports.providerFactory = new ProviderFactory();
//# sourceMappingURL=provider.factory.js.map