/**
 * AI Service
 *
 * Main service for AI translations with fallback strategy.
 * Implements provider fallback, per-provider timeout, and retry policy.
 * All behavior is driven by configuration, not hardcoded.
 */

import { AIProvider } from '@prisma/client';
import { IAIProvider, TranslateRequest, TranslateResponse } from './types';
import { providerFactory } from './provider.factory';
import { config } from '../../config';

export interface AIServiceConfig {
  enableFallback: boolean;
  maxFallbackAttempts: number;
}

export class AIService {
  private factory: typeof providerFactory;
  private serviceConfig: AIServiceConfig;

  constructor(
    factory = providerFactory,
    serviceConfig: Partial<AIServiceConfig> = {}
  ) {
    this.factory = factory;
    const providers = this.factory.getProviders();
    this.serviceConfig = {
      enableFallback: serviceConfig.enableFallback ?? true,
      maxFallbackAttempts: serviceConfig.maxFallbackAttempts ?? config.AI_MAX_FALLBACK_ATTEMPTS ?? providers.length,
    };
  }

  /**
   * Translate text with automatic fallback on failure
   */
  async translate(request: TranslateRequest): Promise<TranslateResponse> {
    const providers = this.factory.getProviders();
    
    if (providers.length === 0) {
      throw new Error('No AI providers available. Please configure at least one provider.');
    }

    let lastError: Error | undefined;
    const maxAttempts = Math.min(
      this.serviceConfig.maxFallbackAttempts,
      providers.length
    );

    for (let i = 0; i < maxAttempts; i++) {
      const provider = providers[i];
      
      try {
        const result = await provider.translate(request);
        return result;
      } catch (error) {
        lastError = error as Error;
        
        // Log the failure for monitoring
        console.warn(
          `AI Provider ${provider.provider} (${provider.model}) failed: ${lastError.message}. ` +
          `${this.serviceConfig.enableFallback && i < maxAttempts - 1 ? 'Trying next provider...' : 'No more providers available.'}`
        );

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
  async translateWithProvider(
    request: TranslateRequest,
    providerName: AIProvider
  ): Promise<TranslateResponse> {
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
  getAvailableProviders(): IAIProvider[] {
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
  hasAvailableProviders(): boolean {
    return this.factory.hasAvailableProviders();
  }
}

// Export singleton instance
export const aiService = new AIService();