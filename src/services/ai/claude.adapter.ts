/**
 * Claude (Anthropic) Adapter
 *
 * Implements the IAIProvider interface for Anthropic Claude API.
 * Instance id persisted in `Translation.providerId` is `anthropic`.
 */

import Anthropic from '@anthropic-ai/sdk';
import { BaseAdapter } from './base.adapter';
import { TranslateRequest, TranslateResponse, ProviderConfig } from './types';
import { KeyExhaustionKind, parseKeyList } from './key-pool';
import { config } from '../../config';

export class ClaudeAdapter extends BaseAdapter {
  readonly id = 'anthropic';
  readonly model = config.AI_MODEL_ANTHROPIC;

  /** One SDK client per key; see OpenAICompatibleAdapter for the rationale. */
  private readonly clients = new Map<string, Anthropic>();

  constructor(providerConfig: Partial<ProviderConfig> = {}) {
    super({
      ...providerConfig,
      apiKeys: providerConfig.apiKeys ?? parseKeyList(config.ANTHROPIC_API_KEY),
      timeout: providerConfig.timeout ?? config.AI_TIMEOUT_ANTHROPIC,
      priority: providerConfig.priority ?? 1,
    });
  }

  private clientFor(apiKey: string): Anthropic {
    const cached = this.clients.get(apiKey);
    if (cached) {
      return cached;
    }

    const client = new Anthropic({
      apiKey,
      // Retries belong to BaseAdapter so every provider observes the same
      // AI_MAX_RETRIES / AI_RETRY_DELAY_MS. The SDK's own default is 2, which
      // silently multiplied into up to 9 HTTP calls per translation - and would
      // reuse a key the pool already knows is exhausted.
      maxRetries: 0,
      // withTimeout protects the caller but cannot cancel an in-flight
      // request; this aborts it at the same deadline.
      timeout: this.config.timeout,
    });

    this.clients.set(apiKey, client);
    return client;
  }

  async translate(request: TranslateRequest): Promise<TranslateResponse> {
    const systemPrompt = await this.buildSystemPrompt(request.style);

    const response = await this.withKeyRotation(async (apiKey) => {
      return this.withTimeout(
        this.clientFor(apiKey).messages.create({
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
   * Anthropic reports a spent credit balance as 400 `invalid_request_error` with
   * "credit balance is too low", so the message is checked as well as the status.
   */
  protected classifyKeyExhaustion(error: unknown): KeyExhaustionKind | null {
    if (error instanceof Anthropic.APIError) {
      const message = error.message.toLowerCase();

      if (message.includes('credit balance') || message.includes('quota')) {
        return 'quota';
      }
      if (error.status === 429) {
        return 'rate';
      }
      if (error.status === 401) {
        return 'invalid';
      }
      if (error.status !== undefined) {
        return null;
      }
    }
    return super.classifyKeyExhaustion(error);
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
      providerId: this.id,
      model: this.model,
      usage: response.usage ? {
        promptTokens: response.usage.input_tokens,
        completionTokens: response.usage.output_tokens,
        totalTokens: response.usage.input_tokens + response.usage.output_tokens,
      } : undefined,
    };
  }
}