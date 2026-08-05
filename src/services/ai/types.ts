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