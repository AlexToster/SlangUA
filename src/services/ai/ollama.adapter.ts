/**
 * Ollama Adapter
 * 
 * Implements the IAIProvider interface for local Ollama API.
 * No API key required - connects to local Ollama instance.
 */

import { AIProvider } from '@prisma/client';
import { Ollama } from 'ollama';
import { BaseAdapter } from './base.adapter';
import { TranslateRequest, TranslateResponse, ProviderConfig } from './types';
import { config } from '../../config';

export class OllamaAdapter extends BaseAdapter {
  readonly provider = AIProvider.OLLAMA;
  readonly model = config.AI_MODEL_OLLAMA;

  private client: Ollama | null = null;

  constructor(providerConfig: Partial<ProviderConfig> = {}) {
    super({
      ...providerConfig,
      // Ollama doesn't need an API key
      apiKey: providerConfig.apiKey ?? 'ollama-local',
      timeout: providerConfig.timeout ?? config.AI_TIMEOUT_OLLAMA,
      priority: providerConfig.priority ?? 3,
    });

    this.client = new Ollama({ host: config.OLLAMA_BASE_URL });
  }

  isAvailable(): boolean {
    // Ollama is available if the client is initialized
    // We could add a health check here, but for now just check client exists
    return this.config.enabled && !!this.client;
  }

  async translate(request: TranslateRequest): Promise<TranslateResponse> {
    if (!this.client) {
      throw new Error('Ollama client not initialized');
    }

    const systemPrompt = this.buildSystemPrompt(request.style);

    const response = await this.withRetry(async () => {
      return this.withTimeout(
        this.client!.chat({
          model: this.model,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: request.text },
          ],
          options: {
            temperature: 0.7,
            num_predict: 500,
          },
        }),
        this.config.timeout,
        'Ollama translation'
      );
    }, 'Ollama translation');

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
    if (error instanceof Error) {
      const message = error.message.toLowerCase();
      // Ollama specific non-retryable errors
      if (message.includes('model not found') ||
          message.includes('connection refused') ||
          message.includes('econnrefused') ||
          message.includes('invalid model') ||
          message.includes('pull model')) {
        return true;
      }
    }
    return super.isNonRetryableError(error);
  }

  /**
   * Process the Ollama response and extract translation
   */
  protected processResponse(response: { message: { content: string } }, request: TranslateRequest): TranslateResponse {
    const translatedText = response.message.content.trim();
    
    return {
      translatedText,
      provider: this.provider,
      model: this.model,
      // Ollama doesn't provide token usage in the same way
      usage: undefined,
    };
  }
}