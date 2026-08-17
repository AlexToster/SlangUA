/**
 * Gemini Adapter
 * 
 * Implements the IAIProvider interface for Google Gemini API.
 */

import { GoogleGenerativeAI, GenerativeModel } from '@google/generative-ai';
import { BaseAdapter } from './base.adapter';
import { TranslateRequest, TranslateResponse, ProviderConfig } from './types';
import { parseKeyList } from './key-pool';
import { config } from '../../config';

export class GeminiAdapter extends BaseAdapter {
  readonly id = 'gemini';
  readonly model = config.AI_MODEL_GEMINI;

  /**
   * One model handle per key. This SDK has no retry option to switch off - it
   * does not retry on its own - so BaseAdapter remains the only retry owner here
   * as well.
   */
  private readonly models = new Map<string, GenerativeModel>();

  constructor(providerConfig: Partial<ProviderConfig> = {}) {
    super({
      ...providerConfig,
      apiKeys: providerConfig.apiKeys ?? parseKeyList(config.GEMINI_API_KEY),
      timeout: providerConfig.timeout ?? config.AI_TIMEOUT_GEMINI,
      priority: providerConfig.priority ?? 2,
    });
  }

  private modelFor(apiKey: string): GenerativeModel {
    const cached = this.models.get(apiKey);
    if (cached) {
      return cached;
    }

    const model = new GoogleGenerativeAI(apiKey).getGenerativeModel({ model: this.model });
    this.models.set(apiKey, model);
    return model;
  }

  async translate(request: TranslateRequest): Promise<TranslateResponse> {
    const systemPrompt = await this.buildSystemPrompt(request.style);
    const fullPrompt = `${systemPrompt}\n\nUser: ${request.text}\n\nTranslation:`;

    const response = await this.withKeyRotation(async (apiKey) => {
      return this.withTimeout(
        this.modelFor(apiKey).generateContent(fullPrompt),
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

  // classifyKeyExhaustion is not overridden: this SDK throws plain Errors whose
  // messages ("[429 Too Many Requests] Resource has been exhausted...",
  // "API key not valid") are exactly what BaseAdapter's string classification
  // already covers. A free-tier daily cap is reported as RESOURCE_EXHAUSTED too,
  // which is why that phrase is classified as the cheap `rate` cooldown rather
  // than parking the key for an hour.

  /**
   * Process the Gemini response and extract translation
   */
  protected processResponse(response: Awaited<ReturnType<GenerativeModel['generateContent']>>, request: TranslateRequest): TranslateResponse {
    const translatedText = response.response.text().trim();
    
    // Gemini doesn't always provide usage info in the same way
    const usageMetadata = response.response.usageMetadata;
    
    return {
      translatedText,
      providerId: this.id,
      model: this.model,
      usage: usageMetadata ? {
        promptTokens: usageMetadata.promptTokenCount || 0,
        completionTokens: usageMetadata.candidatesTokenCount || 0,
        totalTokens: usageMetadata.totalTokenCount || 0,
      } : undefined,
    };
  }
}