/**
 * OpenAI Adapter
 *
 * Implements the IAIProvider interface for OpenAI API.
 */

import { AIProvider } from '@prisma/client';
import OpenAI from 'openai';
import { BaseAdapter } from './base.adapter';
import { TranslateRequest, TranslateResponse, ProviderConfig } from './types';
import { config } from '../../config';

export class OpenAIAdapter extends BaseAdapter {
  readonly provider = AIProvider.OPENAI;
  readonly model = config.AI_MODEL_OPENAI;

  private client: OpenAI | null = null;

  constructor(providerConfig: Partial<ProviderConfig> = {}) {
    super({
      ...providerConfig,
      apiKey: providerConfig.apiKey ?? config.OPENAI_API_KEY,
      timeout: providerConfig.timeout ?? config.AI_TIMEOUT_OPENAI,
      priority: providerConfig.priority ?? 0,
    });

    if (this.config.apiKey) {
      this.client = new OpenAI({
        apiKey: this.config.apiKey,
      });
    }
  }

  isAvailable(): boolean {
    return super.isAvailable() && !!this.client;
  }

  async translate(request: TranslateRequest): Promise<TranslateResponse> {
    if (!this.client) {
      throw new Error('OpenAI client not initialized - missing API key');
    }

    const systemPrompt = this.buildSystemPrompt(request.style);

    const response = await this.withRetry(async () => {
      return this.withTimeout(
        this.client!.chat.completions.create({
          model: this.model,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: request.text },
          ],
          temperature: 0.7,
          max_tokens: 500,
        }),
        this.config.timeout,
        'OpenAI translation'
      );
    }, 'OpenAI translation');

    return this.processResponse(response, request);
  }

  protected async withRetry<T>(
    fn: () => Promise<T>,
    operationName: string
  ): Promise<T> {
    let lastError: Error | undefined;
    const maxAttempts = this.config.maxRetries + 1;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        const result = await fn();
        return result;
      } catch (error) {
        lastError = error as Error;

        // Check for non-retryable OpenAI errors
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

  protected isNonRetryableError(error: unknown): boolean {
    if (error instanceof OpenAI.APIError) {
      // Non-retryable status codes
      if (error.status === 400 || // Bad Request
          error.status === 401 || // Unauthorized
          error.status === 403 || // Forbidden
          error.status === 404 || // Not Found
          error.status === 422) { // Unprocessable Entity
        return true;
      }
      // Rate limit (429) is retryable
      // Server errors (5xx) are retryable
    }
    return super.isNonRetryableError(error);
  }

  /**
   * Process the OpenAI response and extract translation
   */
  protected processResponse(response: OpenAI.Chat.Completions.ChatCompletion, request: TranslateRequest): TranslateResponse {
    const translatedText = response.choices[0]?.message?.content?.trim() || '';
    
    return {
      translatedText,
      provider: this.provider,
      model: this.model,
      usage: response.usage ? {
        promptTokens: response.usage.prompt_tokens,
        completionTokens: response.usage.completion_tokens,
        totalTokens: response.usage.total_tokens,
      } : undefined,
    };
  }
}