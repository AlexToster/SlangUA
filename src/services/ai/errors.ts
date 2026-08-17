/**
 * AI layer errors
 *
 * Error types the AI layer raises on purpose, as opposed to whatever an SDK
 * throws. They exist so callers can branch on a class instead of matching
 * message strings.
 */

import { KeyExhaustionKind } from './key-pool';

/**
 * Every API key configured for one provider instance is currently parked.
 *
 * Deliberately **not** a provider failure: the provider is healthy, its keys are
 * spent. `AIService` therefore skips the provider without recording a circuit
 * breaker failure - opening the breaker would punish a provider for a limit that
 * resets on its own, and would keep it out of the chain after the keys came
 * back.
 */
export class AllKeysExhaustedError extends Error {
  readonly providerId: string;
  /** Milliseconds until the earliest key is usable again. */
  readonly retryAfterMs: number;
  readonly kind?: KeyExhaustionKind;

  constructor(
    providerId: string,
    retryAfterMs: number,
    kind?: KeyExhaustionKind,
    options?: { cause?: unknown }
  ) {
    super(
      `All API keys for provider "${providerId}" are exhausted; ` +
      `next key available in ${Math.ceil(retryAfterMs / 1000)}s`
    );
    this.name = 'AllKeysExhaustedError';
    this.providerId = providerId;
    this.retryAfterMs = retryAfterMs;
    this.kind = kind;

    if (options?.cause !== undefined) {
      this.cause = options.cause;
    }
  }
}

export function isAllKeysExhaustedError(error: unknown): error is AllKeysExhaustedError {
  return error instanceof AllKeysExhaustedError;
}
