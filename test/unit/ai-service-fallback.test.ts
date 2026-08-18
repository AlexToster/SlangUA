/**
 * AIService fallback bookkeeping.
 *
 * Two properties under test. First: an exhausted key pool must not be recorded as
 * a provider failure. A provider whose keys are spent is healthy, and its keys come
 * back on their own - opening the circuit breaker would keep it out of the chain
 * long after the cooldown ended. Second: the operator kill-switch outranks the
 * breaker in both directions - a switched-off provider is never tried, and
 * nothing automatic ever switches it back on.
 */

import { describe, it, expect, vi } from 'vitest';
import { AIService } from '../../src/services/ai/ai.service';
import { AllKeysExhaustedError } from '../../src/services/ai/errors';
import type { providerFactory } from '../../src/services/ai/provider.factory';
import type {
  ProviderDisableRecord,
  ProviderSwitchService,
} from '../../src/services/ai/provider-switch.service';
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

const noRecord: ProviderDisableRecord = { by: '1', at: '2026-08-18T10:00:00.000Z', reason: null };

/** The kill-switch without Redis: a fixed set of switched-off provider ids. */
function fakeSwitch(disabledIds: string[] = []): ProviderSwitchService {
  return {
    list: async () => new Map(disabledIds.map((id) => [id, noRecord])),
    disable: async () => noRecord,
    enable: async () => undefined,
  } as unknown as ProviderSwitchService;
}

function makeService(providers: IAIProvider[], disabledIds: string[] = []): AIService {
  return new AIService(fakeFactory(providers), {}, fakeSwitch(disabledIds));
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
    const service = makeService([exhausted, healthy]);

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
    const service = makeService([broken, healthy]);

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
    const service = makeService([exhausted, healthy]);

    await expect(service.translate(request)).resolves.toMatchObject({
      providerId: 'gemini',
    });
  });

  it('serves an instance id this build has never heard of', async () => {
    // The point of the free-form providerId: an AI_EXTRA_INSTANCES entry is just
    // another id in the chain, with no enum to extend.
    const extra = fakeProvider('groq', async () => ok('groq'));
    const service = makeService([extra]);

    await expect(service.translate(request)).resolves.toMatchObject({
      providerId: 'groq',
    });
  });

  it('surfaces the exhaustion error when it is the only provider', async () => {
    const exhausted = fakeProvider('openai', async () => {
      throw new AllKeysExhaustedError('openai', 1_000, 'quota');
    });
    const service = makeService([exhausted]);

    // TranslationService turns any AI-layer error into 503 AI_PROVIDER_UNAVAILABLE,
    // so this needs no new error code of its own.
    await expect(service.translate(request)).rejects.toBeInstanceOf(AllKeysExhaustedError);
  });
});

describe('AIService operator kill-switch', () => {
  it('never sends a request to a switched-off provider', async () => {
    const off = fakeProvider('openai', async () => ok('openai'));
    const on = fakeProvider('gemini', async () => ok('gemini'));
    const service = makeService([off, on], ['openai']);

    await expect(service.translate(request)).resolves.toMatchObject({ providerId: 'gemini' });
    expect(off.translate).not.toHaveBeenCalled();
  });

  it('fails the request rather than using a switched-off provider as a last resort', async () => {
    const off = fakeProvider('openai', async () => ok('openai'));
    const service = makeService([off], ['openai']);

    await expect(service.translate(request)).rejects.toThrow(/switched off by an operator/);
    expect(off.translate).not.toHaveBeenCalled();
  });

  it('does not pick a switched-off provider as the recovery probe', async () => {
    // The breaker opens on the only permitted provider; the probe must stay inside
    // the permitted set, or a broken chain would quietly resurrect the switch.
    const broken = fakeProvider('gemini', async () => {
      throw new Error('upstream exploded');
    });
    const off = fakeProvider('openai', async () => ok('openai'));
    const service = makeService([off, broken], ['openai']);

    for (let i = 0; i < 7; i++) {
      await expect(service.translate(request)).rejects.toThrow();
    }

    // Five attempts before the breaker opened, then one probe per later request -
    // always the same provider, never the switched-off one.
    expect(broken.translate).toHaveBeenCalledTimes(7);
    expect(off.translate).not.toHaveBeenCalled();
  });

  it('refuses an explicit request for a switched-off provider', async () => {
    const off = fakeProvider('openai', async () => ok('openai'));
    const service = makeService([off], ['openai']);

    // translateWithProvider bypasses fallback, not the switch.
    await expect(service.translateWithProvider(request, 'openai')).rejects.toThrow(
      /switched off by an operator'?/
    );
    expect(off.translate).not.toHaveBeenCalled();
  });

  it('reports a stale switch for a provider that is no longer configured', async () => {
    // The instance disappeared from the configuration while switched off. If the
    // overview dropped the row, the switch could never be cleared.
    const service = makeService([], ['groq']);

    const overview = await service.getProviderOverview();
    expect(overview).toEqual([
      {
        id: 'groq',
        available: false,
        configured: false,
        priority: 999,
        disabled: true,
        disabledAt: noRecord.at,
        disabledBy: noRecord.by,
        disabledReason: null,
      },
    ]);
  });

  describe('hasPermittedProviders', () => {
    // The seam TranslationService uses to decide whether a warm preview cache may
    // answer at all. It must describe operator intent only - never breaker state.
    it('is true while at least one configured provider is permitted', async () => {
      const service = makeService(
        [fakeProvider('openai', async () => ok('openai')), fakeProvider('ollama', async () => ok('ollama'))],
        ['openai'],
      );

      expect(await service.hasPermittedProviders()).toBe(true);
    });

    it('is false once every configured provider is switched off', async () => {
      const service = makeService(
        [fakeProvider('openai', async () => ok('openai'))],
        ['openai'],
      );

      expect(await service.hasPermittedProviders()).toBe(false);
    });

    it('ignores a stale switch on an id this build no longer configures', async () => {
      // A switch left behind by a removed instance must not close translation for
      // the providers that are still configured and permitted.
      const service = makeService([fakeProvider('ollama', async () => ok('ollama'))], ['groq']);

      expect(await service.hasPermittedProviders()).toBe(true);
    });

    it('propagates a Redis failure instead of answering "nothing is disabled"', async () => {
      const brokenSwitch = {
        list: async () => {
          throw new Error('Redis is down');
        },
        disable: async () => noRecord,
        enable: async () => undefined,
      } as unknown as ProviderSwitchService;
      const service = new AIService(
        fakeFactory([fakeProvider('ollama', async () => ok('ollama'))]),
        {},
        brokenSwitch,
      );

      // Fails closed: the caller turns this into 503, never into a served request.
      await expect(service.hasPermittedProviders()).rejects.toThrow(/Redis is down/);
    });
  });
});
