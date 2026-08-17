/**
 * AI Provider Types
 * 
 * Core interfaces and types for the AI provider abstraction layer.
 */

import { AIProvider } from '@prisma/client';

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
  provider: AIProvider;
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
  apiKey?: string;
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
}

/**
 * AI Provider interface - all adapters must implement this
 */
export interface IAIProvider {
  /**
   * Unique provider identifier (matches Prisma AIProvider enum)
   */
  readonly provider: AIProvider;

  /**
   * Instance identifier used in logs and operation names.
   *
   * Today it is always the lowercased `provider`, but it is a separate field
   * on purpose: `provider` is the value persisted in `Translation.aiProvider`,
   * while `id` names one configured instance. Two instances of the same
   * provider (say, two Gemini keys) would share `provider` and differ by `id`,
   * and that has to stay a config change rather than a refactor.
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
   * Get a specific provider by name
   */
  getProvider(name: AIProvider): IAIProvider | undefined;

  /**
   * Get the primary (highest priority) available provider
   */
  getPrimaryProvider(): IAIProvider | undefined;
}