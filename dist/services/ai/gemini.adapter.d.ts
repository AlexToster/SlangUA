/**
 * Gemini Adapter
 *
 * Implements the IAIProvider interface for Google Gemini API.
 */
import { GenerativeModel } from '@google/generative-ai';
import { BaseAdapter } from './base.adapter';
import { TranslateRequest, TranslateResponse, ProviderConfig } from './types';
export declare class GeminiAdapter extends BaseAdapter {
    readonly provider: "GEMINI";
    readonly model = "gemini-1.5-flash";
    private client;
    private modelInstance;
    constructor(providerConfig?: Partial<ProviderConfig>);
    isAvailable(): boolean;
    translate(request: TranslateRequest): Promise<TranslateResponse>;
    protected withRetry<T>(fn: () => Promise<T>, operationName: string): Promise<T>;
    protected isNonRetryableError(error: unknown): boolean;
    /**
     * Process the Gemini response and extract translation
     */
    protected processResponse(response: Awaited<ReturnType<GenerativeModel['generateContent']>>, request: TranslateRequest): TranslateResponse;
}
//# sourceMappingURL=gemini.adapter.d.ts.map