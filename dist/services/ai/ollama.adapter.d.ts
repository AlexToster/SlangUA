/**
 * Ollama Adapter
 *
 * Implements the IAIProvider interface for local Ollama API.
 * No API key required - connects to local Ollama instance.
 */
import { BaseAdapter } from './base.adapter';
import { TranslateRequest, TranslateResponse, ProviderConfig } from './types';
export declare class OllamaAdapter extends BaseAdapter {
    readonly provider: "OLLAMA";
    readonly model = "llama3.1:8b";
    private client;
    private baseUrl;
    constructor(providerConfig?: Partial<ProviderConfig>);
    isAvailable(): boolean;
    translate(request: TranslateRequest): Promise<TranslateResponse>;
    protected withRetry<T>(fn: () => Promise<T>, operationName: string): Promise<T>;
    protected isNonRetryableError(error: unknown): boolean;
    /**
     * Process the Ollama response and extract translation
     */
    protected processResponse(response: {
        message: {
            content: string;
        };
    }, request: TranslateRequest): TranslateResponse;
}
//# sourceMappingURL=ollama.adapter.d.ts.map