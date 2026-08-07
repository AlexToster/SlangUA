/**
 * Claude (Anthropic) Adapter
 * 
 * Implements the IAIProvider interface for Anthropic Claude API.
 * Provider identifier stored in database is ANTHROPIC (per Prisma schema).
 */

import { AIProvider } from '@prisma/client';
import Anthropic from '@anthropic-ai/sdk';
import { BaseAdapter } from './base.adapter';
import { TranslateRequest, TranslateResponse, ProviderConfig } from './types';
import { config } from '../../config';

export class ClaudeAdapter extends BaseAdapter {
  readonly provider = AIProvider.ANTHROPIC;
  readonly model = config.AI_MODEL_ANTHROPIC;

  private client: Anthropic | null = null;

  constructor(providerConfig: Partial<ProviderConfig> = {}) {
    super({
      ...providerConfig,
      apiKey: providerConfig.apiKey ?? config.ANTHROPIC_API_KEY,
      timeout: providerConfig.timeout ?? config.AI_TIMEOUT_ANTHROPIC,
      priority: providerConfig.priority ?? 1,
    });

    if (this.config.apiKey) {
      this.client = new Anthropic({
        apiKey: this.config.apiKey,
      });
    }
  }

  isAvailable(): boolean {
    return super.isAvailable() && !!this.client;
  }

  async translate(request: TranslateRequest): Promise<TranslateResponse> {
    if (!this.client) {
      throw new Error('Anthropic client not initialized - missing API key');
    }

    const systemPrompt = await this.buildSystemPrompt(request.style);

    const response = await this.withRetry(async () => {
      return this.withTimeout(
        this.client!.messages.create({
          model: this.model,
          system: systemPrompt,
          messages: [
            { role: 'user', content: request.text },
          ],
          max_tokens: 500,
          temperature: 0.7,
        }),
        this.config.timeout,
        'Anthropic translation'
      );
    }, 'Anthropic translation');

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
    if (error instanceof Anthropic.APIError) {
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
   * Process the Anthropic response and extract translation
   */
  protected processResponse(response: Anthropic.Messages.Message, request: TranslateRequest): TranslateResponse {
    const translatedText = response.content
      .filter(block => block.type === 'text')
      .map(block => block.text)
      .join('')
      .trim();

    return {
      translatedText,
      provider: this.provider,
      model: this.model,
      usage: response.usage ? {
        promptTokens: response.usage.input_tokens,
        completionTokens: response.usage.output_tokens,
        totalTokens: response.usage.input_tokens + response.usage.output_tokens,
      } : undefined,
    };
  }
}