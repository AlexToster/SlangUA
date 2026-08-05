/**
 * AI Service
 *
 * Main service for AI translations with fallback strategy.
 * Implements provider fallback, per-provider timeout, and retry policy.
 * All behavior is driven by configuration, not hardcoded.
 */
import { AIProvider } from '@prisma/client';
import { IAIProvider, TranslateRequest, TranslateResponse } from './types';
export interface AIServiceConfig {
    enableFallback: boolean;
    maxFallbackAttempts: number;
}
export declare class AIService {
    private factory;
    private serviceConfig;
    constructor(factory?: import("./provider.factory").ProviderFactory, serviceConfig?: Partial<AIServiceConfig>);
    /**
     * Translate text with automatic fallback on failure
     */
    translate(request: TranslateRequest): Promise<TranslateResponse>;
    /**
     * Translate with a specific provider (bypasses fallback)
     */
    translateWithProvider(request: TranslateRequest, providerName: AIProvider): Promise<TranslateResponse>;
    /**
     * Get all available providers
     */
    getAvailableProviders(): IAIProvider[];
    /**
     * Get provider status for health checks
     */
    getProviderStatus(): Record<string, {
        available: boolean;
        configured: boolean;
        priority: number;
    }>;
    /**
     * Check if any provider is available
     */
    hasAvailableProviders(): boolean;
}
export declare const aiService: AIService;
//# sourceMappingURL=ai.service.d.ts.map