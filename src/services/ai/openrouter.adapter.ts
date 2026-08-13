/**
 * OpenRouter Adapter
 *
 * Implements the IAIProvider interface for OpenRouter (openrouter.ai) —
 * a routing layer giving access to many models, including free-tier ones.
 * Default model here is a free Nemotron model.
 *
 * IMPORTANT: @openrouter/sdk is ESM-only. This project compiles to
 * CommonJS (no "type": "module" in package.json), so a static
 * `import { OpenRouter } from '@openrouter/sdk'` would compile to
 * `require(...)` and throw ERR_REQUIRE_ESM at runtime. We load it lazily
 * with a dynamic `import()` instead, cached after the first call.
 */

import { AIProvider } from '@prisma/client';
import { BaseAdapter } from './base.adapter';
import { TranslateRequest, TranslateResponse, ProviderConfig } from './types';
import { config } from '../../config';

type OpenRouterClient = InstanceType<typeof import('@openrouter/sdk').OpenRouter>;
type OpenRouterChatResult = import('@openrouter/sdk/models').ChatResult;
type OpenRouterChatContentItem = import('@openrouter/sdk/models').ChatContentItems;
type OpenRouterResponse = import('@openrouter/sdk/models/operations').SendChatCompletionRequestResponse;

let openRouterModulePromise: Promise<typeof import('@openrouter/sdk')> | null = null;

function loadOpenRouterModule(): Promise<typeof import('@openrouter/sdk')> {
  if (!openRouterModulePromise) {
    openRouterModulePromise = import('@openrouter/sdk');
  }
  return openRouterModulePromise;
}

export class OpenRouterAdapter extends BaseAdapter {
  readonly provider = AIProvider.OPENROUTER;
  readonly model = config.AI_MODEL_OPENROUTER;

  private client: OpenRouterClient | null = null;
  private clientReady: Promise<void> | null = null;

  constructor(providerConfig: Partial<ProviderConfig> = {}) {
    super({
      ...providerConfig,
      apiKey: providerConfig.apiKey ?? config.OPENROUTER_API_KEY,
      timeout: providerConfig.timeout ?? config.AI_TIMEOUT_OPENROUTER,
      priority: providerConfig.priority ?? 4,
    });

    if (this.config.apiKey) {
      this.clientReady = this.initClient(this.config.apiKey);
    }
  }

  private async initClient(apiKey: string): Promise<void> {
    const { OpenRouter } = await loadOpenRouterModule();
    this.client = new OpenRouter({
      apiKey,
      // Abort the SDK request at the adapter timeout. BaseAdapter's timeout
      // guards the caller, but cannot cancel an in-flight HTTP request.
      timeoutMs: this.config.timeout,
      // Retry policy belongs to BaseAdapter so every provider observes the
      // same AI_MAX_RETRIES / AI_RETRY_DELAY_MS configuration. The SDK's
      // default backoff can otherwise keep retrying for up to an hour.
      retryConfig: { strategy: 'none' },
    });
  }

  // Client loads asynchronously, so we can't check `!!this.client` here
  // the way OpenAI/Gemini adapters do — `translate()` awaits clientReady
  // before actually using it.
  isAvailable(): boolean {
    return super.isAvailable() && !!this.config.apiKey;
  }

  async translate(request: TranslateRequest): Promise<TranslateResponse> {
    if (!this.config.apiKey) {
      throw new Error('OpenRouter client not initialized - missing API key');
    }
    if (this.clientReady) {
      await this.clientReady;
    }
    if (!this.client) {
      throw new Error('OpenRouter client not initialized - missing API key');
    }

    const systemPrompt = await this.buildSystemPrompt(request.style);

    const response = await this.withRetry(async () => {
      return this.withTimeout(
        this.client!.chat.send({
          chatRequest: {
            model: this.model,
            messages: [
              { role: 'system', content: systemPrompt },
              { role: 'user', content: request.text },
            ],
            temperature: 0.7,
            maxTokens: 500,
            // Nemotron and other reasoning-capable models can otherwise put
            // their chain of thought into the message returned to the user.
            // A translation is a direct transformation task, so disable it.
            reasoning: { effort: 'none' },
            stream: false,
          },
        }),
        this.config.timeout,
        'OpenRouter translation'
      );
    }, 'OpenRouter translation');

    // The SDK's return type includes EventStream even with stream: false.
    // Guard it at runtime so an unexpected streaming response cannot become an
    // empty successful translation.
    if (!this.isChatResult(response)) {
      throw new Error('OpenRouter returned an unexpected streaming response');
    }

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
        return await fn();
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
    // Exact error shape from @openrouter/sdk isn't pinned down here.
    // If test:typecheck or a live 401 test disagrees with `status`/
    // `statusCode`, check node_modules/@openrouter/sdk's error type
    // and fix this field name — don't guess further than this.
    const status = (error as { status?: number; statusCode?: number })?.status
      ?? (error as { status?: number; statusCode?: number })?.statusCode;
    if (status === 400 || status === 401 || status === 403 || status === 404 || status === 422) {
      return true;
    }
    return super.isNonRetryableError(error);
  }

  private isChatResult(response: OpenRouterResponse): response is OpenRouterChatResult {
    return 'choices' in response && Array.isArray(response.choices);
  }

  private extractTextContent(
    content: string | OpenRouterChatContentItem[] | null | undefined
  ): string {
    if (typeof content === 'string') {
      return content.trim();
    }

    return content
      ?.map((part) => (
        part.type === 'text' && 'text' in part && typeof part.text === 'string'
          ? part.text
          : ''
      ))
      .join('')
      .trim() ?? '';
  }

  protected processResponse(response: OpenRouterChatResult, request: TranslateRequest): TranslateResponse {
    const content = response.choices[0]?.message?.content;
    const translatedText = this.extractTextContent(content);

    return {
      translatedText,
      provider: this.provider,
      model: this.model,
      usage: response.usage ? {
        promptTokens: response.usage.promptTokens ?? 0,
        completionTokens: response.usage.completionTokens ?? 0,
        totalTokens: response.usage.totalTokens ?? 0,
      } : undefined,
    };
  }
}
