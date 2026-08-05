/**
 * Base AI Adapter
 *
 * Abstract base class providing common functionality for all AI providers:
 * - Retry logic with exponential backoff
 * - Timeout handling
 * - Configuration management
 */
import { AIProvider } from '@prisma/client';
import { IAIProvider, TranslateRequest, TranslateResponse, ProviderConfig } from './types';
export declare abstract class BaseAdapter implements IAIProvider {
    abstract readonly provider: AIProvider;
    abstract readonly model: string;
    protected readonly config: ProviderConfig;
    constructor(providerConfig?: Partial<ProviderConfig>);
    /**
     * Check if provider is configured and available
     */
    isAvailable(): boolean;
    /**
     * Translate text to slang style - must be implemented by subclasses
     */
    abstract translate(request: TranslateRequest): Promise<TranslateResponse>;
    /**
     * Execute a function with timeout
     */
    protected withTimeout<T>(promise: Promise<T>, timeoutMs: number, operationName: string): Promise<T>;
    /**
     * Execute a function with retry logic
     */
    protected withRetry<T>(fn: () => Promise<T>, operationName: string): Promise<T>;
    /**
     * Check if an error is non-retryable
     * Override in subclasses for provider-specific logic
     */
    protected isNonRetryableError(error: unknown): boolean;
    /**
     * Sleep utility
     */
    protected sleep(ms: number): Promise<void>;
    /**
     * Build system prompt for slang translation
     */
    protected buildSystemPrompt(style: string): string;
}
//# sourceMappingURL=base.adapter.d.ts.map