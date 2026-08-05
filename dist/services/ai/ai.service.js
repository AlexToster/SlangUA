"use strict";
/**
 * AI Service
 *
 * Main service for AI translations with fallback strategy.
 * Implements provider fallback, per-provider timeout, and retry policy.
 * All behavior is driven by configuration, not hardcoded.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.aiService = exports.AIService = void 0;
const provider_factory_1 = require("./provider.factory");
const config_1 = require("../../config");
class AIService {
    factory;
    serviceConfig;
    constructor(factory = provider_factory_1.providerFactory, serviceConfig = {}) {
        this.factory = factory;
        const providers = this.factory.getProviders();
        this.serviceConfig = {
            enableFallback: serviceConfig.enableFallback ?? true,
            maxFallbackAttempts: serviceConfig.maxFallbackAttempts ?? config_1.config.AI_MAX_FALLBACK_ATTEMPTS ?? providers.length,
        };
    }
    /**
     * Translate text with automatic fallback on failure
     */
    async translate(request) {
        const providers = this.factory.getProviders();
        if (providers.length === 0) {
            throw new Error('No AI providers available. Please configure at least one provider.');
        }
        let lastError;
        const maxAttempts = Math.min(this.serviceConfig.maxFallbackAttempts, providers.length);
        for (let i = 0; i < maxAttempts; i++) {
            const provider = providers[i];
            try {
                const result = await provider.translate(request);
                return result;
            }
            catch (error) {
                lastError = error;
                // Log the failure for monitoring
                console.warn(`AI Provider ${provider.provider} (${provider.model}) failed: ${lastError.message}. ` +
                    `${this.serviceConfig.enableFallback && i < maxAttempts - 1 ? 'Trying next provider...' : 'No more providers available.'}`);
                // If fallback is disabled or this was the last attempt, throw
                if (!this.serviceConfig.enableFallback || i === maxAttempts - 1) {
                    throw lastError;
                }
                // Continue to next provider
            }
        }
        throw lastError || new Error('Translation failed with all providers');
    }
    /**
     * Translate with a specific provider (bypasses fallback)
     */
    async translateWithProvider(request, providerName) {
        const provider = this.factory.getProvider(providerName);
        if (!provider) {
            throw new Error(`Provider ${providerName} not found or not configured`);
        }
        if (!provider.isAvailable()) {
            throw new Error(`Provider ${providerName} is not available`);
        }
        return provider.translate(request);
    }
    /**
     * Get all available providers
     */
    getAvailableProviders() {
        return this.factory.getProviders();
    }
    /**
     * Get provider status for health checks
     */
    getProviderStatus() {
        return this.factory.getProviderStatus();
    }
    /**
     * Check if any provider is available
     */
    hasAvailableProviders() {
        return this.factory.hasAvailableProviders();
    }
}
exports.AIService = AIService;
// Export singleton instance
exports.aiService = new AIService();
//# sourceMappingURL=ai.service.js.map