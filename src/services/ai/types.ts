/**
 * AI Provider Types
 * 
 * Core interfaces and types for the AI provider abstraction layer.
 */

import { KeyCooldownMs, KeyCooldownStore } from './key-pool';

/**
 * Translation request parameters
 */
export interface TranslateRequest {
  text: string;
  style: string;
}

/**
 * Translation response
 */
export interface TranslateResponse {
  translatedText: string;
  /**
   * Id of the configured instance that served the request, persisted as
   * `Translation.providerId`. A string rather than an enum: see
   * PROVIDER_ID_PATTERN in src/constants.
   */
  providerId: string;
  model: string;
  usage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
}

/**
 * Provider configuration
 */
export interface ProviderConfig {
  enabled: boolean;
  /**
   * Every API key configured for this instance, in priority order. A list
   * rather than a single value because free tiers are per key: `*_API_KEY`
   * accepts a comma-separated set, and the adapter rotates away from a key that
   * is rate-limited or out of quota instead of failing the request.
   *
   * Empty means "no key configured", which is only usable together with
   * `requiresApiKey: false`.
   */
  apiKeys?: string[];
  /**
   * Whether this provider needs an API key to be considered available.
   * Defaults to true. A local OpenAI-compatible server (Ollama, vLLM,
   * llama.cpp) authenticates nobody, so it sets this to false instead of
   * carrying a fake key just to pass `isAvailable()`.
   */
  requiresApiKey?: boolean;
  timeout: number;
  maxRetries: number;
  retryDelayMs: number;
  priority: number;
  /** How long a key stays parked after each kind of exhaustion. */
  keyCooldownMs?: KeyCooldownMs;
  /** Where per-key cooldowns are stored; defaults to the in-memory store. */
  keyCooldownStore?: KeyCooldownStore;
}

/**
 * AI Provider interface - all adapters must implement this
 */
export interface IAIProvider {
  /**
   * Identifier of this configured instance: lowercase, matching
   * PROVIDER_ID_PATTERN (`openai`, `openrouter`, `groq`). It is what gets
   * persisted in `Translation.providerId`, what keys the circuit breaker and the
   * key pool, and what appears in logs.
   *
   * Two instances of the same vendor (a second Gemini account, say) differ only
   * by id, which keeps that a config change rather than a refactor.
   */
  readonly id: string;

  /**
   * Model name used by this provider
   */
  readonly model: string;

  /**
   * Check if provider is configured and available
   */
  isAvailable(): boolean;

  /**
   * Translate text to slang style
   * @param request - Translation request with text and style
   * @returns Translation response
   */
  translate(request: TranslateRequest): Promise<TranslateResponse>;
}

/**
 * Provider factory interface
 */
export interface IProviderFactory {
  /**
   * Get all available providers ordered by priority
   */
  getProviders(): IAIProvider[];

  /**
   * Get a specific provider by instance id
   */
  getProvider(id: string): IAIProvider | undefined;

  /**
   * Get the primary (highest priority) available provider
   */
  getPrimaryProvider(): IAIProvider | undefined;
}