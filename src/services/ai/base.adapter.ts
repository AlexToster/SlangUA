/**
 * Base AI Adapter
 *
 * Abstract base class providing common functionality for all AI providers:
 * - Retry logic with exponential backoff
 * - Timeout handling
 * - API key rotation across a pool of keys
 * - Configuration management
 */

import { IAIProvider, TranslateRequest, TranslateResponse, ProviderConfig } from './types';
import { config } from '../../config';
import { loadStyle } from '../../style-engine/loader.js';
import { KeyExhaustionKind, KeyPool } from './key-pool';
import { classifyKeyExhaustionFromMessage } from './key-exhaustion.js';
import { AllKeysExhaustedError } from './errors';
import { logger } from '../../lib/logger';

/**
 * Sentinel used as the single pool entry of an instance that needs no key, so
 * that keyed and keyless providers share one code path. Adapters translate it
 * into whatever their SDK accepts.
 */
export const NO_API_KEY = '';

interface RetryOptions {
  /**
   * Stop retrying as soon as the error looks like key exhaustion. Set when the
   * pool has another key to try: backing off against a limit that belongs to
   * this key alone just delays the request by seconds for nothing.
   */
  abortOnKeyExhaustion?: boolean;
}

export abstract class BaseAdapter implements IAIProvider {
  /**
   * Instance id, supplied by the subclass. Every subclass declares it as a field
   * or a getter, so it is only readable after `super()` returns - which is why
   * the key pool below is built lazily.
   */
  abstract readonly id: string;
  abstract readonly model: string;

  protected readonly config: ProviderConfig;

  /**
   * Keys resolved in the constructor; the pool itself is built on first use
   * because its id comes from `this.id`, which does not exist yet while the base
   * constructor runs - subclass field initializers run after `super()`.
   */
  private readonly poolKeys: string[];
  private keyPoolInstance: KeyPool | null = null;

  constructor(providerConfig: Partial<ProviderConfig> = {}) {
    this.config = {
      enabled: providerConfig.enabled ?? true,
      apiKeys: providerConfig.apiKeys ?? [],
      requiresApiKey: providerConfig.requiresApiKey ?? true,
      timeout: providerConfig.timeout ?? 30000,
      maxRetries: providerConfig.maxRetries ?? config.AI_MAX_RETRIES,
      retryDelayMs: providerConfig.retryDelayMs ?? config.AI_RETRY_DELAY_MS,
      priority: providerConfig.priority ?? 0,
      keyCooldownMs: providerConfig.keyCooldownMs ?? {
        rate: config.AI_KEY_COOLDOWN_RATE_MS,
        quota: config.AI_KEY_COOLDOWN_QUOTA_MS,
        invalid: config.AI_KEY_COOLDOWN_INVALID_MS,
      },
      keyCooldownStore: providerConfig.keyCooldownStore,
    };

    this.poolKeys = this.config.apiKeys && this.config.apiKeys.length > 0
      ? this.config.apiKeys
      // A keyless instance still gets one pool entry, so rotation, cooldowns and
      // the client cache do not need a second branch for it.
      : (this.config.requiresApiKey === false ? [NO_API_KEY] : []);
  }

  /**
   * The keys this instance may use. `size === 0` means no key is configured,
   * which is what makes a key-requiring provider unavailable.
   */
  protected get keyPool(): KeyPool {
    if (!this.keyPoolInstance) {
      // The pool is keyed by instance id, never by a key value: cooldown state
      // must never carry a secret into a store, a log line or a metric label.
      this.keyPoolInstance = new KeyPool({
        id: this.id,
        keys: this.poolKeys,
        cooldownMs: this.config.keyCooldownMs!,
        store: this.config.keyCooldownStore,
      });
    }
    return this.keyPoolInstance;
  }

  /**
   * Check if provider is configured and available.
   *
   * A provider that authenticates nobody (a local OpenAI-compatible server)
   * declares `requiresApiKey: false`, which gives it one keyless pool entry
   * instead of a placeholder key.
   */
  isAvailable(): boolean {
    if (!this.config.enabled) {
      return false;
    }
    return this.keyPool.size > 0;
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
   * Execute a function with retry logic and exponential backoff.
   *
   * This is the single implementation for every provider: adapters override only
   * `isNonRetryableError()` to classify their SDK's errors. `operationName` is
   * kept for call-site readability and future logging.
   */
  protected async withRetry<T>(
    fn: () => Promise<T>,
    operationName: string,
    options: RetryOptions = {}
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

        // Another key is waiting: hand the error up immediately instead of
        // sleeping out a backoff that this key's limit will outlive anyway.
        if (options.abortOnKeyExhaustion && this.classifyKeyExhaustion(error)) {
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
   * Run `fn` with a key from the pool, rotating to the next key when the current
   * one is rate-limited or out of quota. Every key gets at most one turn per
   * request, so a request can never walk the pool twice.
   *
   * Throws `AllKeysExhaustedError` when no key is usable - which `AIService`
   * treats as "skip this provider" rather than "this provider is broken". Any
   * other error propagates unchanged: a bad request or a server error is not a
   * key problem and must not consume the pool.
   */
  protected async withKeyRotation<T>(
    fn: (apiKey: string) => Promise<T>,
    operationName: string
  ): Promise<T> {
    const attempts = this.keyPool.size;
    let lastError: Error | undefined;
    let lastKind: KeyExhaustionKind | undefined;

    for (let attempt = 0; attempt < attempts; attempt++) {
      const lease = await this.keyPool.next();
      if (!lease) {
        break;
      }

      try {
        return await this.withRetry(() => fn(lease.key), operationName, {
          // With a single key there is nowhere to rotate to, so keep the plain
          // backoff behaviour: a short rate limit is often over by then.
          abortOnKeyExhaustion: this.keyPool.size > 1,
        });
      } catch (error) {
        const kind = this.classifyKeyExhaustion(error);
        if (!kind) {
          throw error;
        }

        lastError = error as Error;
        lastKind = kind;
        await this.keyPool.penalize(lease.index, kind);

        // Only the index is logged - the key itself must never reach a log line.
        const logPayload = {
          providerId: this.id,
          keyIndex: lease.index,
          poolSize: this.keyPool.size,
          kind,
        };
        if (kind === 'invalid') {
          logger.error(logPayload, 'AI API key rejected as invalid; parked and rotating');
        } else {
          logger.warn(logPayload, 'AI API key exhausted; parked and rotating');
        }
      }
    }

    throw new AllKeysExhaustedError(
      this.id,
      await this.keyPool.retryAfterMs(),
      lastKind,
      { cause: lastError }
    );
  }

  /**
   * Decide whether an error means "this key is spent" and how long it should be
   * parked. Returning null means the error has nothing to do with the key, so
   * rotation must not swallow it.
   *
   * The base implementation matches provider-agnostic wording, which covers
   * Gemini's messages as well; SDKs with structured errors (OpenAI-compatible,
   * Anthropic) override it and inspect the status code first.
   *
   * The heuristic itself lives in `./key-exhaustion` so the STT service can use
   * the same one without being an `IAIProvider`.
   */
  protected classifyKeyExhaustion(error: unknown): KeyExhaustionKind | null {
    return classifyKeyExhaustionFromMessage(error);
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