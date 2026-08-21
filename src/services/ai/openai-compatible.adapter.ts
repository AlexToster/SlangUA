/**
 * OpenAI-Compatible Adapter
 *
 * One class for every provider that speaks the OpenAI Chat Completions wire
 * format: OpenAI itself, OpenRouter, a local Ollama (`/v1`), and any other
 * compatible server. It replaces the former OpenAIAdapter, OllamaAdapter and
 * OpenRouterAdapter — see plans/docs/05-decisions.md.
 *
 * An instance is fully described by data: an `id`, a base URL and a model. That
 * is what lets `AI_EXTRA_INSTANCES` add a provider without touching code, and
 * why `id` is free-form (see PROVIDER_ID_PATTERN) rather than an enum value.
 */

import OpenAI from 'openai';
import { BaseAdapter, NO_API_KEY } from './base.adapter';
import { TranslateRequest, TranslateResponse, ProviderConfig } from './types';
import { KeyExhaustionKind } from './key-pool';
import { classifyOpenAIKeyExhaustion } from './key-exhaustion.js';

/**
 * Per-instance description of an OpenAI-compatible endpoint.
 */
export interface OpenAICompatibleOptions {
  /**
   * Instance id: lowercase, matching PROVIDER_ID_PATTERN. Persisted in
   * `Translation.providerId` and used in logs and operation names.
   */
  id: string;
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
  readonly id: string;
  readonly model: string;

  private readonly options: OpenAICompatibleOptions;
  /**
   * One SDK client per key. Cached because a client holds connection state, and
   * bounded by the number of configured keys.
   */
  private readonly clients = new Map<string, OpenAI>();

  constructor(options: OpenAICompatibleOptions, providerConfig: Partial<ProviderConfig> = {}) {
    super({
      ...providerConfig,
      requiresApiKey: providerConfig.requiresApiKey ?? options.requiresApiKey ?? true,
    });

    this.options = options;
    this.id = options.id;
    this.model = options.model;
  }

  private clientFor(apiKey: string): OpenAI {
    const cached = this.clients.get(apiKey);
    if (cached) {
      return cached;
    }

    const client = new OpenAI({
      // The SDK refuses to construct without a key and would otherwise fall
      // back to process.env.OPENAI_API_KEY, which must never leak into a
      // request aimed at a different endpoint.
      apiKey: apiKey === NO_API_KEY ? 'not-required' : apiKey,
      baseURL: this.options.baseURL,
      // Retries belong to BaseAdapter so every provider observes the same
      // AI_MAX_RETRIES / AI_RETRY_DELAY_MS. The SDK's own default is 2, which
      // would silently multiply into up to 9 HTTP calls per translation - and
      // would reuse a key the pool already knows is exhausted.
      maxRetries: 0,
      // BaseAdapter's withTimeout protects the caller but cannot cancel an
      // in-flight request; this aborts it at the same deadline.
      timeout: this.config.timeout,
      ...(this.options.defaultHeaders ? { defaultHeaders: this.options.defaultHeaders } : {}),
    });

    this.clients.set(apiKey, client);
    return client;
  }

  async translate(request: TranslateRequest): Promise<TranslateResponse> {
    const systemPrompt = await this.buildSystemPrompt(request.style);
    const operationName = `${this.id} translation`;
    const body = this.buildRequestBody(systemPrompt, request.text);

    const response = await this.withKeyRotation(async (apiKey) => {
      return this.withTimeout(
        this.clientFor(apiKey).chat.completions.create(body),
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
   * Classify a key-level failure from a structured SDK error.
   *
   * The heuristic lives in `./key-exhaustion` because the STT service speaks the
   * same wire format over its own key pool without being an `IAIProvider`. It
   * ends in the same message-based fallback the base class uses, so overriding
   * here loses nothing.
   */
  protected classifyKeyExhaustion(error: unknown): KeyExhaustionKind | null {
    return classifyOpenAIKeyExhaustion(error);
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
      providerId: this.id,
      model: this.model,
      usage: response.usage ? {
        promptTokens: response.usage.prompt_tokens,
        completionTokens: response.usage.completion_tokens,
        totalTokens: response.usage.total_tokens,
      } : undefined,
    };
  }
}
