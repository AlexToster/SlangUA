/**
 * Gemini Adapter
 * 
 * Implements the IAIProvider interface for Google Gemini API.
 */

import { AIProvider } from '@prisma/client';
import { GoogleGenerativeAI, GenerativeModel } from '@google/generative-ai';
import { BaseAdapter } from './base.adapter';
import { TranslateRequest, TranslateResponse, ProviderConfig } from './types';
import { config } from '../../config';

export class GeminiAdapter extends BaseAdapter {
  readonly provider = AIProvider.GEMINI;
  readonly model = config.AI_MODEL_GEMINI;

  private client: GoogleGenerativeAI | null = null;
  private modelInstance: GenerativeModel | null = null;

  constructor(providerConfig: Partial<ProviderConfig> = {}) {
    super({
      ...providerConfig,
      apiKey: providerConfig.apiKey ?? config.GEMINI_API_KEY,
      timeout: providerConfig.timeout ?? config.AI_TIMEOUT_GEMINI,
      priority: providerConfig.priority ?? 2,
    });

    if (this.config.apiKey) {
      this.client = new GoogleGenerativeAI(this.config.apiKey);
      this.modelInstance = this.client.getGenerativeModel({ model: this.model });
    }
  }

  isAvailable(): boolean {
    return super.isAvailable() && !!this.modelInstance;
  }

  async translate(request: TranslateRequest): Promise<TranslateResponse> {
    if (!this.modelInstance) {
      throw new Error('Gemini model not initialized - missing API key');
    }

    const systemPrompt = await this.buildSystemPrompt(request.style);
    const fullPrompt = `${systemPrompt}\n\nUser: ${request.text}\n\nTranslation:`;

    const response = await this.withRetry(async () => {
      return this.withTimeout(
        this.modelInstance!.generateContent(fullPrompt),
        this.config.timeout,
        'Gemini translation'
      );
    }, 'Gemini translation');

    return this.processResponse(response, request);
  }

  protected isNonRetryableError(error: unknown): boolean {
    if (error instanceof Error) {
      const message = error.message.toLowerCase();
      // Check for specific Gemini API errors that are non-retryable
      if (message.includes('api key not valid') ||
          message.includes('permission denied') ||
          message.includes('quota exceeded') ||
          message.includes('invalid argument') ||
          message.includes('not found')) {
        return true;
      }
    }
    return super.isNonRetryableError(error);
  }

  /**
   * Process the Gemini response and extract translation
   */
  protected processResponse(response: Awaited<ReturnType<GenerativeModel['generateContent']>>, request: TranslateRequest): TranslateResponse {
    const translatedText = response.response.text().trim();
    
    // Gemini doesn't always provide usage info in the same way
    const usageMetadata = response.response.usageMetadata;
    
    return {
      translatedText,
      provider: this.provider,
      model: this.model,
      usage: usageMetadata ? {
        promptTokens: usageMetadata.promptTokenCount || 0,
        completionTokens: usageMetadata.candidatesTokenCount || 0,
        totalTokens: usageMetadata.totalTokenCount || 0,
      } : undefined,
    };
  }
}