/**
 * Key rotation unit tests.
 *
 * Exercises BaseAdapter.withKeyRotation through a minimal adapter, because the
 * interesting behaviour is the interaction between retry, classification and the
 * pool - not any single provider's SDK.
 */

import { describe, it, expect } from 'vitest';
import { BaseAdapter, NO_API_KEY } from '../../src/services/ai/base.adapter';
import { AllKeysExhaustedError } from '../../src/services/ai/errors';
import { InMemoryKeyCooldownStore } from '../../src/services/ai/key-pool';
import type { ProviderConfig, TranslateRequest, TranslateResponse } from '../../src/services/ai/types';

type Handler = (apiKey: string) => Promise<string>;

class TestAdapter extends BaseAdapter {
  readonly id = 'openai';
  readonly model = 'test-model';

  /** Keys the adapter actually attempted, in order. */
  readonly attempts: string[] = [];

  private readonly handler: Handler;

  constructor(handler: Handler, providerConfig: Partial<ProviderConfig> = {}) {
    super({
      // A fresh store per adapter: the production default is shared per process,
      // which would otherwise leak cooldowns between tests.
      keyCooldownStore: new InMemoryKeyCooldownStore(),
      ...providerConfig,
    });
    this.handler = handler;
  }

  /** Backoff is not what these tests are about. */
  protected override sleep(): Promise<void> {
    return Promise.resolve();
  }

  get poolSize(): number {
    return this.keyPool.size;
  }

  async translate(request: TranslateRequest): Promise<TranslateResponse> {
    const translatedText = await this.withKeyRotation(async (apiKey) => {
      this.attempts.push(apiKey);
      return this.handler(apiKey);
    }, `test ${request.style}`);

    return { translatedText, providerId: this.id, model: this.model };
  }
}

const request: TranslateRequest = { text: 'привіт', style: 'GEN_Z' };

const rateLimited = () => new Error('Rate limit reached for requests');
const outOfQuota = () => new Error('You exceeded your current quota, please check your plan');
const invalidKey = () => new Error('Invalid API key provided');

/** Capture a rejection without asserting on it, so its fields can be inspected. */
async function capture(fn: () => Promise<unknown>): Promise<unknown> {
  let caught: unknown;
  try {
    await fn();
  } catch (error) {
    caught = error;
  }
  return caught;
}

describe('BaseAdapter key rotation', () => {
  it('rotates to the next key when the current one is rate-limited', async () => {
    const adapter = new TestAdapter(
      async (key) => {
        if (key === 'k1') throw rateLimited();
        return `ok:${key}`;
      },
      { apiKeys: ['k1', 'k2'] }
    );

    const result = await adapter.translate(request);

    expect(result.translatedText).toBe('ok:k2');
    // One attempt per key: with a spare key there is no point sleeping out a
    // backoff against a limit that belongs to the key we just left.
    expect(adapter.attempts).toEqual(['k1', 'k2']);
  });

  it('rotates away from a key that was rejected as invalid', async () => {
    const adapter = new TestAdapter(
      async (key) => {
        if (key === 'k1') throw invalidKey();
        return `ok:${key}`;
      },
      { apiKeys: ['k1', 'k2'] }
    );

    await expect(adapter.translate(request)).resolves.toMatchObject({ translatedText: 'ok:k2' });
    expect(adapter.attempts).toEqual(['k1', 'k2']);
  });

  it('throws AllKeysExhaustedError once every key is spent, and parks them', async () => {
    const adapter = new TestAdapter(async () => { throw outOfQuota(); }, {
      apiKeys: ['k1', 'k2'],
    });

    const first = await capture(() => adapter.translate(request));
    expect(first).toBeInstanceOf(AllKeysExhaustedError);
    const exhausted = first as AllKeysExhaustedError;
    expect(exhausted.providerId).toBe('openai');
    expect(exhausted.kind).toBe('quota');
    expect(exhausted.retryAfterMs).toBeGreaterThan(0);
    expect(adapter.attempts).toEqual(['k1', 'k2']);

    // The next call spends no attempt at all: the pool refuses the lease without
    // an HTTP request, which is what makes skipping an exhausted provider cheaper
    // than the circuit breaker.
    const second = await capture(() => adapter.translate(request));
    expect(second).toBeInstanceOf(AllKeysExhaustedError);
    expect((second as AllKeysExhaustedError).kind).toBeUndefined();
    expect(adapter.attempts).toEqual(['k1', 'k2']);
  });

  it('lets an unrelated error through without consuming the pool', async () => {
    const adapter = new TestAdapter(async () => { throw new Error('upstream exploded'); }, {
      apiKeys: ['k1', 'k2'],
    });

    await expect(adapter.translate(request)).rejects.toThrow('upstream exploded');
    // Retried by withRetry (AI_MAX_RETRIES=2), never rotated: a 5xx is not a key
    // problem.
    expect(adapter.attempts).toEqual(['k1', 'k1', 'k1']);
  });

  it('keeps the plain backoff when there is only one key', async () => {
    const adapter = new TestAdapter(async () => { throw rateLimited(); }, {
      apiKeys: ['only'],
    });

    await expect(adapter.translate(request)).rejects.toBeInstanceOf(AllKeysExhaustedError);
    // AI_MAX_RETRIES=2 -> three attempts, then the key is parked.
    expect(adapter.attempts).toEqual(['only', 'only', 'only']);
  });

  it('treats a keyless instance as one usable, keyless pool entry', async () => {
    const adapter = new TestAdapter(async (key) => `ok:${key === NO_API_KEY ? 'none' : key}`, {
      requiresApiKey: false,
    });

    expect(adapter.poolSize).toBe(1);
    expect(adapter.isAvailable()).toBe(true);
    await expect(adapter.translate(request)).resolves.toMatchObject({ translatedText: 'ok:none' });
  });

  it('is unavailable when a key is required but none is configured', () => {
    const adapter = new TestAdapter(async () => 'never', { apiKeys: [] });

    expect(adapter.poolSize).toBe(0);
    expect(adapter.isAvailable()).toBe(false);
  });

  it('is unavailable when disabled, however many keys it has', () => {
    const adapter = new TestAdapter(async () => 'never', {
      apiKeys: ['k1', 'k2'],
      enabled: false,
    });

    expect(adapter.isAvailable()).toBe(false);
  });
});
