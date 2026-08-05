/**
 * Provider Factory
 * 
 * Resolves and manages AI provider adapters based on configuration.
 * Handles provider priority, enable/disable flags, and availability.
 */

import { AIProvider } from '@prisma/client';
import { IAIProvider, IProviderFactory, ProviderConfig } from './types';
import { OpenAIAdapter } from './openai.adapter';
import { ClaudeAdapter } from './claude.adapter';
import { GeminiAdapter } from './gemini.adapter';
import { OllamaAdapter } from './ollama.adapter';
import { config } from '../../config';

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
        enabled: true, // Ollama doesn't need API key, just needs to be running
        timeout: config.AI_TIMEOUT_OLLAMA,
        priority: this.getPriority(AIProvider.OLLAMA),
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
   * Create a provider instance based on name
   */
  private createProvider(name: AIProvider, providerConfig: ProviderConfig): IAIProvider | null {
    // Skip if not enabled
    if (!providerConfig.enabled) {
      return null;
    }

    switch (name) {
      case AIProvider.OPENAI:
        return new OpenAIAdapter(providerConfig);
      case AIProvider.ANTHROPIC:
        return new ClaudeAdapter(providerConfig);
      case AIProvider.GEMINI:
        return new GeminiAdapter(providerConfig);
      case AIProvider.OLLAMA:
        return new OllamaAdapter(providerConfig);
      default:
        return null;
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