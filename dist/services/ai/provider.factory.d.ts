/**
 * Provider Factory
 *
 * Resolves and manages AI provider adapters based on configuration.
 * Handles provider priority, enable/disable flags, and availability.
 */
import { AIProvider } from '@prisma/client';
import { IAIProvider, IProviderFactory } from './types';
export declare class ProviderFactory implements IProviderFactory {
    private providers;
    private priorityOrder;
    constructor();
    /**
     * Initialize all providers based on configuration
     */
    private initializeProviders;
    /**
     * Build provider configurations from environment config
     */
    private buildProviderConfigs;
    /**
     * Get priority index for a provider (lower = higher priority)
     */
    private getPriority;
    /**
     * Create a provider instance based on name
     */
    private createProvider;
    /**
     * Get all available providers ordered by priority
     */
    getProviders(): IAIProvider[];
    /**
     * Get a specific provider by name
     */
    getProvider(name: AIProvider): IAIProvider | undefined;
    /**
     * Get the primary (highest priority) available provider
     */
    getPrimaryProvider(): IAIProvider | undefined;
    /**
     * Check if any provider is available
     */
    hasAvailableProviders(): boolean;
    /**
     * Get provider status for debugging/monitoring
     */
    getProviderStatus(): Record<string, {
        available: boolean;
        configured: boolean;
        priority: number;
    }>;
}
export declare const providerFactory: ProviderFactory;
//# sourceMappingURL=provider.factory.d.ts.map