/**
 * OpenAI Adapter
 *
 * Implements the IAIProvider interface for OpenAI API.
 */
import OpenAI from 'openai';
import { BaseAdapter } from './base.adapter';
import { TranslateRequest, TranslateResponse, ProviderConfig } from './types';
export declare class OpenAIAdapter extends BaseAdapter {
    readonly provider: "OPENAI";
    readonly model = "gpt-4o-mini";
    private client;
    constructor(providerConfig?: Partial<ProviderConfig>);
    isAvailable(): boolean;
    translate(request: TranslateRequest): Promise<TranslateResponse>;
    protected withRetry<T>(fn: () => Promise<T>, operationName: string): Promise<T>;
    protected isNonRetryableError(error: unknown): boolean;
    /**
     * Process the OpenAI response and extract translation
     */
    protected processResponse(response: OpenAI.Chat.Completions.ChatCompletion, request: TranslateRequest): TranslateResponse;
}
//# sourceMappingURL=openai.adapter.d.ts.map