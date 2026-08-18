/**
 * AI Service
 *
 * Main service for AI translations with fallback strategy.
 * Implements provider fallback, per-provider timeout, retry policy,
 * a circuit breaker to skip degraded providers, and the operator kill-switch
 * (see provider-switch.service.ts) which outranks all of them.
 * All behavior is driven by configuration, not hardcoded.
 */

import { IAIProvider, TranslateRequest, TranslateResponse } from './types';
import { providerFactory } from './provider.factory';
import { AllKeysExhaustedError, isAllKeysExhaustedError } from './errors';
import { providerSwitchService, ProviderSwitchService } from './provider-switch.service';
import { config } from '../../config';
import { logger } from '../../lib/logger';

export interface AIServiceConfig {
  enableFallback: boolean;
  maxFallbackAttempts: number | null;
}

/** One row of the operator view: provider health *and* operator intent. */
export interface ProviderOverviewEntry {
  id: string;
  /** False while the circuit breaker holds the provider open. */
  available: boolean;
  /** False when the deployment never configured the instance. */
  configured: boolean;
  /** Position in the fallback chain; lower is tried first. */
  priority: number;
  /** True while an operator has switched the provider off. */
  disabled: boolean;
  disabledAt: string | null;
  disabledBy: string | null;
  disabledReason: string | null;
}

interface CircuitBreakerState {
  failures: number;
  lastFailureTime: number;
  isOpen: boolean;
}

export class AIService {
  private factory: typeof providerFactory;
  private serviceConfig: AIServiceConfig;
  /** Operator kill-switch. Injected so unit tests need no Redis. */
  private switchService: ProviderSwitchService;
  /** Keyed by provider instance id, the same string the API returns. */
  private circuitBreakers: Map<string, CircuitBreakerState> = new Map();

  constructor(
    factory = providerFactory,
    serviceConfig: Partial<AIServiceConfig> = {},
    switchService: ProviderSwitchService = providerSwitchService
  ) {
    this.factory = factory;
    this.switchService = switchService;
    this.serviceConfig = {
      enableFallback: serviceConfig.enableFallback ?? true,
      // `null` means "as many attempts as there are providers", resolved per
      // request. Reading providers.length in the constructor froze the value at
      // whatever the factory happened to hold at import time.
      maxFallbackAttempts:
        serviceConfig.maxFallbackAttempts ?? config.AI_MAX_FALLBACK_ATTEMPTS ?? null,
    };
  }

  private getCircuitBreakerState(providerId: string): CircuitBreakerState {
    let state = this.circuitBreakers.get(providerId);
    if (!state) {
      state = { failures: 0, lastFailureTime: 0, isOpen: false };
      this.circuitBreakers.set(providerId, state);
    }
    return state;
  }

  private isCircuitOpen(providerId: string): boolean {
    const state = this.getCircuitBreakerState(providerId);
    const now = Date.now();
    const resetMs = config.CIRCUIT_BREAKER_RESET_MS ?? 60000;

    // Check if circuit is open and reset window hasn't elapsed
    if (state.isOpen) {
      if (now - state.lastFailureTime >= resetMs) {
        // Reset window elapsed - half-open state, allow one request through
        state.isOpen = false;
        state.failures = 0;
        logger.info({ providerId }, 'Circuit breaker reset (half-open)');
        return false;
      }
      return true;
    }
    return false;
  }

  private recordSuccess(providerId: string): void {
    const state = this.getCircuitBreakerState(providerId);
    if (state.failures > 0 || state.isOpen) {
      state.failures = 0;
      state.isOpen = false;
      logger.info({ providerId }, 'Circuit breaker closed after successful request');
    }
  }

  private recordFailure(providerId: string): void {
    const state = this.getCircuitBreakerState(providerId);
    const now = Date.now();
    const threshold = config.CIRCUIT_BREAKER_FAILURE_THRESHOLD ?? 5;
    const resetMs = config.CIRCUIT_BREAKER_RESET_MS ?? 60000;

    state.failures += 1;
    state.lastFailureTime = now;

    if (state.failures >= threshold && !state.isOpen) {
      state.isOpen = true;
      logger.warn(
        { providerId, failures: state.failures, resetMs },
        'Circuit breaker OPENED; provider will be skipped until the reset window elapses',
      );
    }
  }

  private getEligibleProviders(providers: IAIProvider[]): IAIProvider[] {
    return providers.filter((p) => !this.isCircuitOpen(p.id));
  }

  /**
   * When every breaker is open, probe only the provider that has been failing
   * the longest instead of walking the whole chain. Retrying all of them
   * defeated the breaker: an outage cost one full timeout per provider on every
   * request. One probe still lets the service recover on its own.
   */
  private pickRecoveryProbe(providers: IAIProvider[]): IAIProvider {
    return providers.reduce((oldest, candidate) => {
      const a = this.getCircuitBreakerState(candidate.id).lastFailureTime;
      const b = this.getCircuitBreakerState(oldest.id).lastFailureTime;
      return a < b ? candidate : oldest;
    });
  }

  /**
   * Translate text with automatic fallback on failure.
   *
   * The operator kill-switch is read once per request and applied *before* the
   * circuit breakers, for two reasons. It must be the strongest of the two
   * mechanisms - a breaker reopens on its own after a cooldown, and a provider a
   * human switched off must never come back that way - and a single snapshot
   * keeps the whole fallback chain of one request consistent even if an operator
   * flips a switch halfway through it.
   */
  async translate(request: TranslateRequest): Promise<TranslateResponse> {
    const disabled = await this.switchService.list();
    const configured = this.factory.getProviders();
    const permitted = configured.filter((p) => !disabled.has(p.id));

    if (permitted.length === 0) {
      if (configured.length > 0) {
        // Deliberate operator action, not an outage. Logged as its own message so
        // an on-call reading the logs is not sent looking for a broken provider.
        logger.error(
          { disabled: [...disabled.keys()] },
          'Every configured AI provider is switched off by an operator',
        );
        throw new Error('All AI providers are switched off by an operator.');
      }
      throw new Error('No AI providers available. Please configure at least one provider.');
    }

    const eligibleProviders = this.getEligibleProviders(permitted);

    if (eligibleProviders.length === 0) {
      // The probe is picked among the permitted providers only: recovering by
      // reaching for a switched-off provider would defeat the switch.
      const probe = this.pickRecoveryProbe(permitted);
      logger.warn(
        { providerId: probe.id },
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
        this.recordSuccess(provider.id);
        return result;
      } catch (error) {
        lastError = error as Error;

        // An exhausted key pool is not a provider failure: the endpoint is
        // healthy, its keys are spent and come back on their own. Counting it
        // would open the breaker and keep the provider out of the chain long
        // after the cooldown ended. Skipping costs nothing here - the pool
        // refuses the lease without making an HTTP call at all.
        const keysExhausted = isAllKeysExhaustedError(error);
        if (!keysExhausted) {
          this.recordFailure(provider.id);
        }

        const willRetry = this.serviceConfig.enableFallback && i < maxAttempts - 1;
        logger.warn(
          {
            err: lastError,
            providerId: provider.id,
            model: provider.model,
            willRetry,
            keysExhausted,
            ...(keysExhausted ? { retryAfterMs: (error as AllKeysExhaustedError).retryAfterMs } : {}),
          },
          keysExhausted ? 'AI provider skipped: all API keys exhausted' : 'AI provider failed',
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
   * Translate with a specific provider (bypasses fallback).
   *
   * It bypasses fallback, not the kill-switch: "use exactly this provider" is
   * still traffic the operator forbade.
   */
  async translateWithProvider(
    request: TranslateRequest,
    providerId: string
  ): Promise<TranslateResponse> {
    const provider = this.factory.getProvider(providerId);

    if (!provider) {
      throw new Error(`Provider ${providerId} not found or not configured`);
    }

    if (!provider.isAvailable()) {
      throw new Error(`Provider ${providerId} is not available`);
    }

    if ((await this.switchService.list()).has(providerId)) {
      throw new Error(`Provider ${providerId} is switched off by an operator`);
    }

    return provider.translate(request);
  }

  /**
   * Does the operator still permit traffic to at least one configured provider?
   *
   * Split out of translate() for callers that must answer "is translation open
   * at all?" *before* they can serve a request without touching a provider — the
   * warm preview cache in TranslationService. Without that check, killing the
   * last provider during an incident would still hand cached output to whoever
   * happened to have a matching entry inside the preview TTL, which is not the
   * behaviour the panel promises.
   *
   * Deliberately ignores the circuit breakers: a breaker heals itself, and a
   * cached answer is exactly what should still be served through an outage.
   * Only the human decision counts here. A Redis failure propagates, as
   * everywhere the switch is read — resolving it to "nothing is disabled" would
   * serve traffic the operator forbade.
   */
  async hasPermittedProviders(): Promise<boolean> {
    const disabled = await this.switchService.list();
    return this.factory.getProviders().some((provider) => !disabled.has(provider.id));
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
   * Provider health merged with operator intent, for the admin panel.
   *
   * Ids that exist only in the kill-switch are included as well. A switch left
   * behind by a provider that was later unconfigured or renamed would otherwise
   * be invisible - and an invisible switch cannot be cleared.
   */
  async getProviderOverview(): Promise<ProviderOverviewEntry[]> {
    const disabled = await this.switchService.list();
    const status = this.factory.getProviderStatus();
    const ids = new Set<string>([...Object.keys(status), ...disabled.keys()]);

    return [...ids]
      .map((id) => {
        const entry = status[id] ?? { available: false, configured: false, priority: 999 };
        const record = disabled.get(id);
        return {
          id,
          available: entry.available,
          configured: entry.configured,
          priority: entry.priority,
          disabled: record !== undefined,
          disabledAt: record?.at ?? null,
          disabledBy: record?.by ?? null,
          disabledReason: record?.reason ?? null,
        };
      })
      // Sorted by the fallback order the service actually uses, so the panel
      // shows the chain rather than an arbitrary object order.
      .sort((a, b) => a.priority - b.priority || a.id.localeCompare(b.id));
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