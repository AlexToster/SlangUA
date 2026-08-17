/**
 * Provider Factory
 *
 * Resolves and manages AI provider adapters based on configuration.
 * Handles provider priority, enable/disable flags, and availability.
 *
 * Instances are keyed by a free-form `providerId` (see PROVIDER_ID_PATTERN), not
 * by a database enum: adding a provider is a configuration change, and
 * `AI_EXTRA_INSTANCES` can introduce one that this file has never heard of.
 */

import { IAIProvider, IProviderFactory, ProviderConfig } from './types';
import { OpenAICompatibleAdapter, OpenAICompatibleOptions } from './openai-compatible.adapter';
import { ClaudeAdapter } from './claude.adapter';
import { GeminiAdapter } from './gemini.adapter';
import { parseKeyList } from './key-pool';
import { BUILTIN_PROVIDER_IDS, PROVIDER_ID_PATTERN } from '../../constants';
import { config } from '../../config';
import { logger } from '../../lib/logger';

const DEFAULT_EXTRA_TIMEOUT_MS = 30000;

/**
 * Base URL of the local Ollama instance in OpenAI-compatible form. Ollama
 * exposes `/v1/chat/completions` next to its native API, which is what lets it
 * be an instance of the shared adapter instead of a class of its own.
 */
function ollamaCompatibleBaseUrl(): string {
  return `${config.OLLAMA_BASE_URL.replace(/\/+$/, '')}/v1`;
}

/** Environment-variable segment for an instance id: `open-router` -> `OPEN_ROUTER`. */
function envSuffix(id: string): string {
  return id.toUpperCase().replace(/-/g, '_');
}

/**
 * Ids listed in `AI_EXTRA_INSTANCES`, filtered to the ones that can be used.
 *
 * A rejected entry is logged and skipped rather than thrown: a typo in an
 * optional extra provider must not stop the service from starting on the
 * providers that are configured correctly.
 */
function extraInstanceIds(): string[] {
  const seen = new Set<string>();
  const ids: string[] = [];

  for (const raw of config.AI_EXTRA_INSTANCES.split(',')) {
    const id = raw.trim().toLowerCase();
    if (!id || seen.has(id)) {
      continue;
    }
    seen.add(id);

    if (!PROVIDER_ID_PATTERN.test(id)) {
      logger.error({ id }, 'AI_EXTRA_INSTANCES: ignored id (expected lowercase [a-z0-9_-], max 32 chars)');
      continue;
    }
    if ((BUILTIN_PROVIDER_IDS as readonly string[]).includes(id)) {
      logger.error({ id }, 'AI_EXTRA_INSTANCES: ignored id that shadows a built-in provider');
      continue;
    }

    ids.push(id);
  }

  return ids;
}

/**
 * Describe an extra OpenAI-compatible instance from `AI_BASE_URL_<ID>` and
 * `AI_MODEL_<ID>`. These cannot live in the Zod schema, because their names
 * depend on a value the schema is validating; they are validated here instead.
 */
function extraInstanceOptions(id: string): OpenAICompatibleOptions | null {
  const suffix = envSuffix(id);
  const baseURL = process.env[`AI_BASE_URL_${suffix}`]?.trim();
  const model = process.env[`AI_MODEL_${suffix}`]?.trim();

  if (!baseURL || !model) {
    logger.error(
      { id, needs: [`AI_BASE_URL_${suffix}`, `AI_MODEL_${suffix}`] },
      'AI_EXTRA_INSTANCES: ignored instance with missing base URL or model',
    );
    return null;
  }

  return { id, baseURL, model };
}

/** Timeout of an extra instance, from `AI_TIMEOUT_<ID>`. */
function extraInstanceTimeout(id: string): number {
  const raw = process.env[`AI_TIMEOUT_${envSuffix(id)}`];
  const parsed = raw === undefined ? NaN : Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_EXTRA_TIMEOUT_MS;
}

/**
 * The OpenAI-compatible instances. Everything that differs between them is data
 * here; the adapter class is the same.
 */
function compatibleInstances(extraIds: string[]): Record<string, OpenAICompatibleOptions> {
  const instances: Record<string, OpenAICompatibleOptions> = {
    openai: {
      id: 'openai',
      baseURL: config.AI_BASE_URL_OPENAI,
      model: config.AI_MODEL_OPENAI,
    },
    ollama: {
      id: 'ollama',
      baseURL: ollamaCompatibleBaseUrl(),
      model: config.AI_MODEL_OLLAMA,
      // A local server authenticates nobody.
      requiresApiKey: false,
    },
    openrouter: {
      id: 'openrouter',
      baseURL: config.AI_BASE_URL_OPENROUTER,
      model: config.AI_MODEL_OPENROUTER,
      // Nemotron and other reasoning-capable models would otherwise put their
      // chain of thought into the message returned to the user. A translation
      // is a direct transformation task, so reasoning is disabled.
      extraBody: { reasoning: { effort: 'none' } },
    },
  };

  for (const id of extraIds) {
    const options = extraInstanceOptions(id);
    if (options) {
      instances[id] = options;
    }
  }

  return instances;
}

export class ProviderFactory implements IProviderFactory {
  private providers: Map<string, IAIProvider> = new Map();
  private priorityOrder: string[] = [];
  private compatible: Record<string, OpenAICompatibleOptions> = {};

  constructor() {
    this.initializeProviders();
  }

  /**
   * Initialize all providers based on configuration
   */
  private initializeProviders(): void {
    const extraIds = extraInstanceIds();
    this.compatible = compatibleInstances(extraIds);

    // Parse priority order from config. Ids that no instance answers to are
    // dropped with a warning: silently ignoring a typo here would quietly change
    // the fallback chain.
    const knownIds = new Set<string>([...BUILTIN_PROVIDER_IDS, ...extraIds]);
    this.priorityOrder = config.AI_PROVIDER_PRIORITY.split(',')
      .map((p) => p.trim().toLowerCase())
      .filter((p) => p.length > 0)
      .filter((p) => {
        if (knownIds.has(p)) {
          return true;
        }
        logger.warn({ id: p }, 'AI_PROVIDER_PRIORITY: unknown provider id ignored');
        return false;
      });

    const providerConfigs = this.buildProviderConfigs(extraIds);

    for (const [id, providerConfig] of Object.entries(providerConfigs)) {
      const provider = this.createProvider(id, providerConfig);
      if (provider) {
        this.providers.set(id, provider);
      }
    }
  }

  /**
   * Build provider configurations from environment config.
   *
   * Every `*_API_KEY` is parsed as a comma-separated pool, so "is this provider
   * enabled?" becomes "does it have at least one key?".
   */
  private buildProviderConfigs(extraIds: string[]): Record<string, ProviderConfig> {
    const baseRetryConfig = {
      maxRetries: config.AI_MAX_RETRIES,
      retryDelayMs: config.AI_RETRY_DELAY_MS,
    };

    const keys = {
      openai: parseKeyList(config.OPENAI_API_KEY),
      anthropic: parseKeyList(config.ANTHROPIC_API_KEY),
      gemini: parseKeyList(config.GEMINI_API_KEY),
      openrouter: parseKeyList(config.OPENROUTER_API_KEY),
    };

    const configs: Record<string, ProviderConfig> = {
      openai: {
        enabled: keys.openai.length > 0,
        apiKeys: keys.openai,
        timeout: config.AI_TIMEOUT_OPENAI,
        priority: this.getPriority('openai'),
        ...baseRetryConfig,
      },
      anthropic: {
        enabled: keys.anthropic.length > 0,
        apiKeys: keys.anthropic,
        timeout: config.AI_TIMEOUT_ANTHROPIC,
        priority: this.getPriority('anthropic'),
        ...baseRetryConfig,
      },
      gemini: {
        enabled: keys.gemini.length > 0,
        apiKeys: keys.gemini,
        timeout: config.AI_TIMEOUT_GEMINI,
        priority: this.getPriority('gemini'),
        ...baseRetryConfig,
      },
      ollama: {
        // Ollama has no API key to key "configured" off, so it follows an
        // explicit flag; unset means enabled everywhere except production.
        enabled: config.OLLAMA_ENABLED ?? config.NODE_ENV !== 'production',
        requiresApiKey: false,
        timeout: config.AI_TIMEOUT_OLLAMA,
        priority: this.getPriority('ollama'),
        ...baseRetryConfig,
      },
      openrouter: {
        enabled: keys.openrouter.length > 0,
        apiKeys: keys.openrouter,
        timeout: config.AI_TIMEOUT_OPENROUTER,
        priority: this.getPriority('openrouter'),
        ...baseRetryConfig,
      },
    };

    for (const id of extraIds) {
      // An extra instance whose endpoint or model is missing was already
      // reported; without options there is nothing to configure.
      if (!this.compatible[id]) {
        continue;
      }
      const extraKeys = parseKeyList(process.env[`${envSuffix(id)}_API_KEY`]);
      configs[id] = {
        enabled: extraKeys.length > 0,
        apiKeys: extraKeys,
        timeout: extraInstanceTimeout(id),
        priority: this.getPriority(id),
        ...baseRetryConfig,
      };
      if (extraKeys.length === 0) {
        logger.warn(
          { id, needs: `${envSuffix(id)}_API_KEY` },
          'AI_EXTRA_INSTANCES: instance has no API key and stays disabled',
        );
      }
    }

    return configs;
  }

  /**
   * Get priority index for a provider (lower = higher priority)
   */
  private getPriority(id: string): number {
    const index = this.priorityOrder.indexOf(id);
    return index >= 0 ? index : 999; // Unlisted providers go to the end
  }

  /**
   * Create a provider instance for an id.
   *
   * Only Anthropic and Gemini have classes of their own: the first for prompt
   * caching, the second because its native SDK has no system role and its own
   * error classification. Everything else is an OpenAI-compatible instance.
   */
  private createProvider(id: string, providerConfig: ProviderConfig): IAIProvider | null {
    // Skip if not enabled
    if (!providerConfig.enabled) {
      return null;
    }

    switch (id) {
      case 'anthropic':
        return new ClaudeAdapter(providerConfig);
      case 'gemini':
        return new GeminiAdapter(providerConfig);
      default: {
        const options = this.compatible[id];
        return options ? new OpenAICompatibleAdapter(options, providerConfig) : null;
      }
    }
  }

  /**
   * Get all available providers ordered by priority.
   *
   * Every configured instance takes part in the chain; `AI_PROVIDER_PRIORITY`
   * only orders it. An instance the list does not mention sorts last instead of
   * disappearing, which is what makes an extra instance usable without editing
   * two variables.
   */
  getProviders(): IAIProvider[] {
    return [...this.providers.values()]
      .filter((provider) => provider.isAvailable())
      .sort((a, b) => this.getPriority(a.id) - this.getPriority(b.id));
  }

  /**
   * Get a specific provider by instance id
   */
  getProvider(id: string): IAIProvider | undefined {
    return this.providers.get(id);
  }

  /**
   * Get the primary (highest priority) available provider
   */
  getPrimaryProvider(): IAIProvider | undefined {
    const providers = this.getProviders();
    return providers[0];
  }

  /**
   * Check if any provider is available
   */
  hasAvailableProviders(): boolean {
    return this.getProviders().length > 0;
  }

  /**
   * Get provider status for debugging/monitoring
   */
  getProviderStatus(): Record<string, { available: boolean; configured: boolean; priority: number }> {
    const status: Record<string, { available: boolean; configured: boolean; priority: number }> = {};
    const ids = new Set<string>([
      ...BUILTIN_PROVIDER_IDS,
      ...Object.keys(this.compatible),
      ...this.providers.keys(),
    ]);

    for (const id of ids) {
      const instance = this.providers.get(id);
      status[id] = {
        available: instance?.isAvailable() ?? false,
        configured: !!instance,
        priority: this.getPriority(id),
      };
    }

    return status;
  }
}

// Export singleton instance
export const providerFactory = new ProviderFactory();
