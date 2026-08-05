/**
 * Claude (Anthropic) Adapter
 *
 * Implements the IAIProvider interface for Anthropic Claude API.
 * Provider identifier stored in database is ANTHROPIC (per Prisma schema).
 */
import Anthropic from '@anthropic-ai/sdk';
import { BaseAdapter } from './base.adapter';
import { TranslateRequest, TranslateResponse, ProviderConfig } from './types';
export declare class ClaudeAdapter extends BaseAdapter {
    readonly provider: "ANTHROPIC";
    readonly model = "claude-3-haiku-20240307";
    private client;
    constructor(providerConfig?: Partial<ProviderConfig>);
    isAvailable(): boolean;
    translate(request: TranslateRequest): Promise<TranslateResponse>;
    protected withRetry<T>(fn: () => Promise<T>, operationName: string): Promise<T>;
    protected isNonRetryableError(error: unknown): boolean;
    /**
     * Process the Anthropic response and extract translation
     */
    protected processResponse(response: Anthropic.Messages.Message, request: TranslateRequest): TranslateResponse;
}
//# sourceMappingURL=claude.adapter.d.ts.map