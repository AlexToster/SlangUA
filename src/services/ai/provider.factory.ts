/**
 * Provider Factory
 * 
 * Resolves and manages AI provider adapters based on configuration.
 * Handles provider priority, enable/disable flags, and availability.
 */

import { AIProvider } from '@prisma/client';
import { IAIProvider, IProviderFactory, ProviderConfig } from './types';
import { OpenAICompatibleAdapter, OpenAICompatibleOptions } from './openai-compatible.adapter';
import { ClaudeAdapter } from './claude.adapter';
import { GeminiAdapter } from './gemini.adapter';
import { config } from '../../config';

/**
 * Base URL of the local Ollama instance in OpenAI-compatible form. Ollama
 * exposes `/v1/chat/completions` next to its native API, which is what lets it
 * be an instance of the shared adapter instead of a class of its own.
 */
function ollamaCompatibleBaseUrl(): string {
  return `${config.OLLAMA_BASE_URL.replace(/\/+$/, '')}/v1`;
}

/**
 * The OpenAI-compatible instances. Everything that differs between them is
 * data here; the adapter class is the same. `id` and `provider` are separate
 * fields on purpose - see types.ts.
 */
function compatibleInstances(): Partial<Record<AIProvider, OpenAICompatibleOptions>> {
  return {
    [AIProvider.OPENAI]: {
      id: 'openai',
      provider: AIProvider.OPENAI,
      baseURL: config.AI_BASE_URL_OPENAI,
      model: config.AI_MODEL_OPENAI,
    },
    [AIProvider.OLLAMA]: {
      id: 'ollama',
      provider: AIProvider.OLLAMA,
      baseURL: ollamaCompatibleBaseUrl(),
      model: config.AI_MODEL_OLLAMA,
      // A local server authenticates nobody.
      requiresApiKey: false,
    },
    [AIProvider.OPENROUTER]: {
      id: 'openrouter',
      provider: AIProvider.OPENROUTER,
      baseURL: config.AI_BASE_URL_OPENROUTER,
      model: config.AI_MODEL_OPENROUTER,
      // Nemotron and other reasoning-capable models would otherwise put their
      // chain of thought into the message returned to the user. A translation
      // is a direct transformation task, so reasoning is disabled.
      extraBody: { reasoning: { effort: 'none' } },
    },
  };
}

export class ProviderFactory implements IProviderFactory {
  private providers: Map<AIProvider, IAIProvider> = new Map();
  private priorityOrder: AIProvider[] = [];

  constructor() {
    this.initializeProviders();
  }

  /**
   * Initialize all providers based on configuration
   */
  private initializeProviders(): void {
    // Parse priority order from config
    const priorityString = config.AI_PROVIDER_PRIORITY;
    this.priorityOrder = priorityString
      .split(',')
      .map(p => p.trim().toUpperCase() as AIProvider)
      .filter(p => Object.values(AIProvider).includes(p));

    // Create provider instances with config
    const providerConfigs = this.buildProviderConfigs();

    // Initialize each provider
    for (const [providerName, providerConfig] of Object.entries(providerConfigs)) {
      const provider = this.createProvider(providerName as AIProvider, providerConfig);
      if (provider) {
        this.providers.set(providerName as AIProvider, provider);
      }
    }
  }

  /**
   * Build provider configurations from environment config
   */
  private buildProviderConfigs(): Record<AIProvider, ProviderConfig> {
    const baseRetryConfig = {
      maxRetries: config.AI_MAX_RETRIES,
      retryDelayMs: config.AI_RETRY_DELAY_MS,
    };

    return {
      [AIProvider.OPENAI]: {
        enabled: !!config.OPENAI_API_KEY,
        apiKey: config.OPENAI_API_KEY,
        timeout: config.AI_TIMEOUT_OPENAI,
        priority: this.getPriority(AIProvider.OPENAI),
        ...baseRetryConfig,
      },
      [AIProvider.ANTHROPIC]: {
        enabled: !!config.ANTHROPIC_API_KEY,
        apiKey: config.ANTHROPIC_API_KEY,
        timeout: config.AI_TIMEOUT_ANTHROPIC,
        priority: this.getPriority(AIProvider.ANTHROPIC),
        ...baseRetryConfig,
      },
      [AIProvider.GEMINI]: {
        enabled: !!config.GEMINI_API_KEY,
        apiKey: config.GEMINI_API_KEY,
        timeout: config.AI_TIMEOUT_GEMINI,
        priority: this.getPriority(AIProvider.GEMINI),
        ...baseRetryConfig,
      },
      [AIProvider.OLLAMA]: {
        // Ollama has no API key to key "configured" off, so it follows an
        // explicit flag; unset means enabled everywhere except production.
        enabled: config.OLLAMA_ENABLED ?? config.NODE_ENV !== 'production',
        requiresApiKey: false,
        timeout: config.AI_TIMEOUT_OLLAMA,
        priority: this.getPriority(AIProvider.OLLAMA),
        ...baseRetryConfig,
      },
      [AIProvider.OPENROUTER]: {
        enabled: !!config.OPENROUTER_API_KEY,
        apiKey: config.OPENROUTER_API_KEY,
        timeout: config.AI_TIMEOUT_OPENROUTER,
        priority: this.getPriority(AIProvider.OPENROUTER),
        ...baseRetryConfig,
      },
    };
  }

  /**
   * Get priority index for a provider (lower = higher priority)
   */
  private getPriority(provider: AIProvider): number {
    const index = this.priorityOrder.indexOf(provider);
    return index >= 0 ? index : 999; // Unknown providers go to the end
  }

  /**
   * Create a provider instance based on name.
   *
   * Only Anthropic and Gemini have classes of their own: the first for prompt
   * caching, the second because its native SDK has no system role and its own
   * error classification. Everything else is an OpenAI-compatible instance.
   */
  private createProvider(name: AIProvider, providerConfig: ProviderConfig): IAIProvider | null {
    // Skip if not enabled
    if (!providerConfig.enabled) {
      return null;
    }

    switch (name) {
      case AIProvider.ANTHROPIC:
        return new ClaudeAdapter(providerConfig);
      case AIProvider.GEMINI:
        return new GeminiAdapter(providerConfig);
      default: {
        const options = compatibleInstances()[name];
        return options ? new OpenAICompatibleAdapter(options, providerConfig) : null;
      }
    }
  }

  /**
   * Get all available providers ordered by priority
   */
  getProviders(): IAIProvider[] {
    return this.priorityOrder
      .map(provider => this.providers.get(provider))
      .filter((provider): provider is IAIProvider => 
        provider !== undefined && provider.isAvailable()
      );
  }

  /**
   * Get a specific provider by name
   */
  getProvider(name: AIProvider): IAIProvider | undefined {
    return this.providers.get(name);
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
    
    for (const provider of Object.values(AIProvider)) {
      const instance = this.providers.get(provider);
      const configured = !!instance;
      const available = instance?.isAvailable() ?? false;
      const priority = this.getPriority(provider);
      
      status[provider] = { available, configured, priority };
    }
    
    return status;
  }
}

// Export singleton instance
export const providerFactory = new ProviderFactory();