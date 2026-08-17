/**
 * AIService fallback bookkeeping.
 *
 * The property under test: an exhausted key pool must not be recorded as a
 * provider failure. A provider whose keys are spent is healthy, and its keys come
 * back on their own - opening the circuit breaker would keep it out of the chain
 * long after the cooldown ended.
 */

import { describe, it, expect, vi } from 'vitest';
import { AIService } from '../../src/services/ai/ai.service';
import { AllKeysExhaustedError } from '../../src/services/ai/errors';
import type { providerFactory } from '../../src/services/ai/provider.factory';
import type { IAIProvider, TranslateRequest, TranslateResponse } from '../../src/services/ai/types';

const request: TranslateRequest = { text: 'привіт', style: 'GEN_Z' };

function fakeProvider(
  id: string,
  translate: (request: TranslateRequest) => Promise<TranslateResponse>
): IAIProvider {
  return {
    id,
    model: `${id}-model`,
    isAvailable: () => true,
    translate: vi.fn(translate),
  };
}

/**
 * ProviderFactory has private members, so a structural stand-in cannot satisfy
 * its type; the cast is the whole point of the seam.
 */
function fakeFactory(providers: IAIProvider[]): typeof providerFactory {
  return {
    getProviders: () => providers,
    getProvider: (id: string) => providers.find((p) => p.id === id),
    getPrimaryProvider: () => providers[0],
    hasAvailableProviders: () => providers.length > 0,
    getProviderStatus: () => ({}),
  } as unknown as typeof providerFactory;
}

const ok = (providerId: string): TranslateResponse => ({
  translatedText: `served by ${providerId}`,
  providerId,
  model: `${providerId}-model`,
});

describe('AIService fallback', () => {
  it('keeps trying a key-exhausted provider on later requests', async () => {
    const exhausted = fakeProvider('openai', async () => {
      throw new AllKeysExhaustedError('openai', 45_000, 'rate');
    });
    const healthy = fakeProvider('ollama', async () => ok('ollama'));
    const service = new AIService(fakeFactory([exhausted, healthy]));

    // Six requests is one more than CIRCUIT_BREAKER_FAILURE_THRESHOLD (5).
    for (let i = 0; i < 6; i++) {
      const result = await service.translate(request);
      expect(result.providerId).toBe('ollama');
    }

    // Still asked every time: no breaker was opened. The attempt is free anyway,
    // because the pool refuses the lease without a network call.
    expect(exhausted.translate).toHaveBeenCalledTimes(6);
  });

  it('opens the breaker for a genuinely failing provider', async () => {
    const broken = fakeProvider('openai', async () => {
      throw new Error('upstream exploded');
    });
    const healthy = fakeProvider('ollama', async () => ok('ollama'));
    const service = new AIService(fakeFactory([broken, healthy]));

    for (let i = 0; i < 6; i++) {
      await service.translate(request);
    }

    // Five failures open the circuit, so the sixth request skips the provider.
    expect(broken.translate).toHaveBeenCalledTimes(5);
  });

  it('falls back to the next provider when the first one has no keys left', async () => {
    const exhausted = fakeProvider('openai', async () => {
      throw new AllKeysExhaustedError('openai', 1_000, 'quota');
    });
    const healthy = fakeProvider('gemini', async () => ok('gemini'));
    const service = new AIService(fakeFactory([exhausted, healthy]));

    await expect(service.translate(request)).resolves.toMatchObject({
      providerId: 'gemini',
    });
  });

  it('serves an instance id this build has never heard of', async () => {
    // The point of the free-form providerId: an AI_EXTRA_INSTANCES entry is just
    // another id in the chain, with no enum to extend.
    const extra = fakeProvider('groq', async () => ok('groq'));
    const service = new AIService(fakeFactory([extra]));

    await expect(service.translate(request)).resolves.toMatchObject({
      providerId: 'groq',
    });
  });

  it('surfaces the exhaustion error when it is the only provider', async () => {
    const exhausted = fakeProvider('openai', async () => {
      throw new AllKeysExhaustedError('openai', 1_000, 'quota');
    });
    const service = new AIService(fakeFactory([exhausted]));

    // TranslationService turns any AI-layer error into 503 AI_PROVIDER_UNAVAILABLE,
    // so this needs no new error code of its own.
    await expect(service.translate(request)).rejects.toBeInstanceOf(AllKeysExhaustedError);
  });
});
