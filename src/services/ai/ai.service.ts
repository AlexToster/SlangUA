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
import { logger } from '../../lib/logger';

export interface AIServiceConfig {
  enableFallback: boolean;
  maxFallbackAttempts: number | null;
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
    this.serviceConfig = {
      enableFallback: serviceConfig.enableFallback ?? true,
      // `null` means "as many attempts as there are providers", resolved per
      // request. Reading providers.length in the constructor froze the value at
      // whatever the factory happened to hold at import time.
      maxFallbackAttempts:
        serviceConfig.maxFallbackAttempts ?? config.AI_MAX_FALLBACK_ATTEMPTS ?? null,
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

    // Check if circuit is open and reset window hasn't elapsed
    if (state.isOpen) {
      if (now - state.lastFailureTime >= resetMs) {
        // Reset window elapsed - half-open state, allow one request through
        state.isOpen = false;
        state.failures = 0;
        logger.info({ provider: providerName }, 'Circuit breaker reset (half-open)');
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
      logger.info({ provider: providerName }, 'Circuit breaker closed after successful request');
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
      logger.warn(
        { provider: providerName, failures: state.failures, resetMs },
        'Circuit breaker OPENED; provider will be skipped until the reset window elapses',
      );
    }
  }

  private getEligibleProviders(): IAIProvider[] {
    const allProviders = this.factory.getProviders();
    return allProviders.filter((p) => !this.isCircuitOpen(p.provider));
  }

  /**
   * When every breaker is open, probe only the provider that has been failing
   * the longest instead of walking the whole chain. Retrying all of them
   * defeated the breaker: an outage cost one full timeout per provider on every
   * request. One probe still lets the service recover on its own.
   */
  private pickRecoveryProbe(providers: IAIProvider[]): IAIProvider {
    return providers.reduce((oldest, candidate) => {
      const a = this.getCircuitBreakerState(candidate.provider).lastFailureTime;
      const b = this.getCircuitBreakerState(oldest.provider).lastFailureTime;
      return a < b ? candidate : oldest;
    });
  }

  /**
   * Translate text with automatic fallback on failure
   */
  async translate(request: TranslateRequest): Promise<TranslateResponse> {
    const eligibleProviders = this.getEligibleProviders();

    if (eligibleProviders.length === 0) {
      const allProviders = this.factory.getProviders();
      if (allProviders.length === 0) {
        throw new Error('No AI providers available. Please configure at least one provider.');
      }
      const probe = this.pickRecoveryProbe(allProviders);
      logger.warn(
        { provider: probe.provider },
        'All providers circuit-open; probing the longest-failing one',
      );
      return this.translateWithFallback(request, [probe]);
    }

    return this.translateWithFallback(request, eligibleProviders);
  }

  private async translateWithFallback(
    request: TranslateRequest,
    providers: IAIProvider[]
  ): Promise<TranslateResponse> {
    let lastError: Error | undefined;
    const configuredMax = this.serviceConfig.maxFallbackAttempts;
    const maxAttempts = Math.min(configuredMax ?? providers.length, providers.length);

    for (let i = 0; i < maxAttempts; i++) {
      const provider = providers[i];

      try {
        const result = await provider.translate(request);
        this.recordSuccess(provider.provider);
        return result;
      } catch (error) {
        lastError = error as Error;
        this.recordFailure(provider.provider);

        const willRetry = this.serviceConfig.enableFallback && i < maxAttempts - 1;
        logger.warn(
          { err: lastError, provider: provider.provider, model: provider.model, willRetry },
          'AI provider failed',
        );

        // If fallback is disabled or this was the last attempt, throw
        if (!willRetry) {
          throw lastError;
        }
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