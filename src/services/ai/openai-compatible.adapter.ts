/**
 * OpenAI-Compatible Adapter
 *
 * One class for every provider that speaks the OpenAI Chat Completions wire
 * format: OpenAI itself, OpenRouter, a local Ollama (`/v1`), and any other
 * compatible server. It replaces the former OpenAIAdapter, OllamaAdapter and
 * OpenRouterAdapter — see plans/docs/05-decisions.md.
 *
 * Two fields are deliberately separate:
 * - `provider` is the Prisma AIProvider value persisted in
 *   `Translation.aiProvider`; it is a label of who served the translation.
 * - `id` names one configured instance. They coincide today, but two instances
 *   of the same provider must stay a config change, not a refactor.
 */

import { AIProvider } from '@prisma/client';
import OpenAI from 'openai';
import { BaseAdapter } from './base.adapter';
import { TranslateRequest, TranslateResponse, ProviderConfig } from './types';

/**
 * Per-instance description of an OpenAI-compatible endpoint.
 */
export interface OpenAICompatibleOptions {
  /** Instance id, used in logs and operation names (e.g. `openrouter`). */
  id: string;
  /** Value persisted in `Translation.aiProvider`. */
  provider: AIProvider;
  /** Full base URL including the API version segment, e.g. `.../v1`. */
  baseURL: string;
  model: string;
  /**
   * Local servers authenticate nobody. Set false and no key is required for
   * the instance to be available.
   */
  requiresApiKey?: boolean;
  /**
   * Sampling temperature, or null to omit the field entirely — reasoning
   * models reject any value other than 1.
   */
  temperature?: number | null;
  /** Output cap, or null to omit it. */
  maxTokens?: number | null;
  /**
   * Newer OpenAI models want `max_completion_tokens`; many compatible servers
   * only understand `max_tokens`, which stays the default.
   */
  maxTokensField?: 'max_tokens' | 'max_completion_tokens';
  /**
   * Provider-specific body fields merged into the request. OpenRouter needs
   * `reasoning: { effort: 'none' }` here, otherwise reasoning-capable models
   * put their chain of thought into the returned message.
   */
  extraBody?: Record<string, unknown>;
  /**
   * Extra headers for every request (OpenRouter's optional `HTTP-Referer` /
   * `X-Title` attribution headers would go here).
   */
  defaultHeaders?: Record<string, string>;
}

const DEFAULT_TEMPERATURE = 0.7;
const DEFAULT_MAX_TOKENS = 500;

export class OpenAICompatibleAdapter extends BaseAdapter {
  readonly provider: AIProvider;
  readonly model: string;

  private readonly instanceId: string;
  private readonly options: OpenAICompatibleOptions;
  private client: OpenAI | null = null;

  constructor(options: OpenAICompatibleOptions, providerConfig: Partial<ProviderConfig> = {}) {
    super({
      ...providerConfig,
      requiresApiKey: providerConfig.requiresApiKey ?? options.requiresApiKey ?? true,
    });

    this.options = options;
    this.instanceId = options.id;
    this.provider = options.provider;
    this.model = options.model;

    const keyRequired = this.config.requiresApiKey !== false;
    if (this.config.apiKey || !keyRequired) {
      this.client = new OpenAI({
        // The SDK refuses to construct without a key and would otherwise fall
        // back to process.env.OPENAI_API_KEY, which must never leak into a
        // request aimed at a different endpoint.
        apiKey: this.config.apiKey ?? 'not-required',
        baseURL: options.baseURL,
        // Retries belong to BaseAdapter so every provider observes the same
        // AI_MAX_RETRIES / AI_RETRY_DELAY_MS. The SDK's own default is 2, which
        // would silently multiply into up to 9 HTTP calls per translation.
        maxRetries: 0,
        // BaseAdapter's withTimeout protects the caller but cannot cancel an
        // in-flight request; this aborts it at the same deadline.
        timeout: this.config.timeout,
        ...(options.defaultHeaders ? { defaultHeaders: options.defaultHeaders } : {}),
      });
    }
  }

  override get id(): string {
    return this.instanceId;
  }

  isAvailable(): boolean {
    return super.isAvailable() && !!this.client;
  }

  async translate(request: TranslateRequest): Promise<TranslateResponse> {
    if (!this.client) {
      throw new Error(`${this.instanceId} client not initialized - missing API key`);
    }

    const systemPrompt = await this.buildSystemPrompt(request.style);
    const operationName = `${this.instanceId} translation`;
    const body = this.buildRequestBody(systemPrompt, request.text);

    const response = await this.withRetry(async () => {
      return this.withTimeout(
        this.client!.chat.completions.create(body),
        this.config.timeout,
        operationName
      );
    }, operationName);

    return this.processResponse(response, request);
  }

  /**
   * Assemble the request body. Optional fields are omitted rather than sent as
   * undefined, because strict compatible servers reject unknown-but-present
   * keys.
   */
  private buildRequestBody(
    systemPrompt: string,
    text: string
  ): OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming {
    const temperature = this.options.temperature === undefined
      ? DEFAULT_TEMPERATURE
      : this.options.temperature;
    const maxTokens = this.options.maxTokens === undefined
      ? DEFAULT_MAX_TOKENS
      : this.options.maxTokens;
    const maxTokensField = this.options.maxTokensField ?? 'max_tokens';

    const body: Record<string, unknown> = {
      model: this.model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: text },
      ],
      ...(temperature === null ? {} : { temperature }),
      ...(maxTokens === null ? {} : { [maxTokensField]: maxTokens }),
      ...(this.options.extraBody ?? {}),
    };

    // extraBody carries provider-specific fields the SDK's types don't know
    // about, so the assembled object is cast once, here.
    return body as unknown as OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming;
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
   * Process the response and extract the translation. `usage` is optional on
   * purpose: several compatible servers (Ollama among them) omit it.
   */
  protected processResponse(
    response: OpenAI.Chat.Completions.ChatCompletion,
    _request: TranslateRequest
  ): TranslateResponse {
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
