/**
 * Base AI Adapter
 * 
 * Abstract base class providing common functionality for all AI providers:
 * - Retry logic with exponential backoff
 * - Timeout handling
 * - Configuration management
 */

import { AIProvider } from '@prisma/client';
import { IAIProvider, TranslateRequest, TranslateResponse, ProviderConfig } from './types';
import { config } from '../../config';
import { loadStyle } from '../../style-engine/loader.js';

export abstract class BaseAdapter implements IAIProvider {
  abstract readonly provider: AIProvider;
  abstract readonly model: string;

  protected readonly config: ProviderConfig;

  constructor(providerConfig: Partial<ProviderConfig> = {}) {
    this.config = {
      enabled: providerConfig.enabled ?? true,
      apiKey: providerConfig.apiKey,
      timeout: providerConfig.timeout ?? 30000,
      maxRetries: providerConfig.maxRetries ?? config.AI_MAX_RETRIES,
      retryDelayMs: providerConfig.retryDelayMs ?? config.AI_RETRY_DELAY_MS,
      priority: providerConfig.priority ?? 0,
    };
  }

  /**
   * Check if provider is configured and available
   */
  isAvailable(): boolean {
    return this.config.enabled && !!this.config.apiKey;
  }

  /**
   * Translate text to slang style - must be implemented by subclasses
   */
  abstract translate(request: TranslateRequest): Promise<TranslateResponse>;

  /**
   * Execute a function with timeout
   */
  protected async withTimeout<T>(
    promise: Promise<T>,
    timeoutMs: number,
    operationName: string
  ): Promise<T> {
    let timeoutId: NodeJS.Timeout;
    
    const timeoutPromise = new Promise<never>((_, reject) => {
      timeoutId = setTimeout(() => {
        reject(new Error(`${operationName} timed out after ${timeoutMs}ms`));
      }, timeoutMs);
    });

    try {
      const result = await Promise.race([promise, timeoutPromise]);
      clearTimeout(timeoutId!);
      return result;
    } catch (error) {
      clearTimeout(timeoutId!);
      throw error;
    }
  }

  /**
   * Execute a function with retry logic
   */
  protected async withRetry<T>(
    fn: () => Promise<T>,
    operationName: string
  ): Promise<T> {
    let lastError: Error | undefined;
    const maxAttempts = this.config.maxRetries + 1;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        return await fn();
      } catch (error) {
        lastError = error as Error;
        
        // Don't retry on certain errors (e.g., invalid API key, bad request)
        if (this.isNonRetryableError(error)) {
          throw error;
        }

        if (attempt < maxAttempts) {
          const delay = this.config.retryDelayMs * Math.pow(2, attempt - 1);
          await this.sleep(delay);
        }
      }
    }

    throw lastError;
  }

  /**
   * Check if an error is non-retryable
   * Override in subclasses for provider-specific logic
   */
  protected isNonRetryableError(error: unknown): boolean {
    if (error instanceof Error) {
      const message = error.message.toLowerCase();
      // Common non-retryable errors
      if (message.includes('invalid api key') ||
          message.includes('unauthorized') ||
          message.includes('forbidden') ||
          message.includes('bad request') ||
          message.includes('quota exceeded') ||
          message.includes('insufficient_quota')) {
        return true;
      }
    }
    return false;
  }

  /**
   * Sleep utility
   */
  protected sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Build system prompt for slang translation
   */
  protected async buildSystemPrompt(style: string): Promise<string> {
    const { systemPrompt } = await loadStyle(style);
    return systemPrompt;
  }
}