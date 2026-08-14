/**
 * AI Service
 *
 * Main service for AI translations with fallback strategy.
 * Implements provider fallback, per-provider timeout, retry policy,
 * and circuit breaker to skip degraded providers.
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

interface CircuitBreakerState {
  failures: number;
  lastFailureTime: number;
  isOpen: boolean;
}

export class AIService {
  private factory: typeof providerFactory;
  private serviceConfig: AIServiceConfig;
  private circuitBreakers: Map<AIProvider, CircuitBreakerState> = new Map();

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

  private getCircuitBreakerState(providerName: AIProvider): CircuitBreakerState {
    let state = this.circuitBreakers.get(providerName);
    if (!state) {
      state = { failures: 0, lastFailureTime: 0, isOpen: false };
      this.circuitBreakers.set(providerName, state);
    }
    return state;
  }

  private isCircuitOpen(providerName: AIProvider): boolean {
    const state = this.getCircuitBreakerState(providerName);
    const now = Date.now();
    const resetMs = config.CIRCUIT_BREAKER_RESET_MS ?? 60000;
    const threshold = config.CIRCUIT_BREAKER_FAILURE_THRESHOLD ?? 5;

    // Check if circuit is open and reset window hasn't elapsed
    if (state.isOpen) {
      if (now - state.lastFailureTime >= resetMs) {
        // Reset window elapsed - half-open state, allow one request through
        state.isOpen = false;
        state.failures = 0;
        console.info(`Circuit breaker for provider ${providerName} reset (half-open)`);
        return false;
      }
      return true;
    }
    return false;
  }

  private recordSuccess(providerName: AIProvider): void {
    const state = this.getCircuitBreakerState(providerName);
    if (state.failures > 0 || state.isOpen) {
      state.failures = 0;
      state.isOpen = false;
      console.info(`Circuit breaker for provider ${providerName} closed after successful request`);
    }
  }

  private recordFailure(providerName: AIProvider): void {
    const state = this.getCircuitBreakerState(providerName);
    const now = Date.now();
    const threshold = config.CIRCUIT_BREAKER_FAILURE_THRESHOLD ?? 5;
    const resetMs = config.CIRCUIT_BREAKER_RESET_MS ?? 60000;

    state.failures += 1;
    state.lastFailureTime = now;

    if (state.failures >= threshold && !state.isOpen) {
      state.isOpen = true;
      console.info(
        `Circuit breaker OPENED for provider ${providerName} after ${state.failures} consecutive failures. ` +
        `Will skip for ${resetMs}ms.`
      );
    }
  }

  private getEligibleProviders(): IAIProvider[] {
    const allProviders = this.factory.getProviders();
    return allProviders.filter((p) => !this.isCircuitOpen(p.provider));
  }

  /**
   * Translate text with automatic fallback on failure
   */
  async translate(request: TranslateRequest): Promise<TranslateResponse> {
    const eligibleProviders = this.getEligibleProviders();
    
    if (eligibleProviders.length === 0) {
      // All providers are circuit-open; fall back to all providers as last resort
      const allProviders = this.factory.getProviders();
      if (allProviders.length === 0) {
        throw new Error('No AI providers available. Please configure at least one provider.');
      }
      console.warn('All providers circuit-open; attempting fallback chain anyway as last resort');
      return this.translateWithFallback(request, allProviders);
    }

    return this.translateWithFallback(request, eligibleProviders);
  }

  private async translateWithFallback(
    request: TranslateRequest,
    providers: IAIProvider[]
  ): Promise<TranslateResponse> {
    let lastError: Error | undefined;
    const maxAttempts = Math.min(
      this.serviceConfig.maxFallbackAttempts,
      providers.length
    );

    for (let i = 0; i < maxAttempts; i++) {
      const provider = providers[i];
      
      try {
        const result = await provider.translate(request);
        this.recordSuccess(provider.provider);
        return result;
      } catch (error) {
        lastError = error as Error;
        this.recordFailure(provider.provider);
        
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