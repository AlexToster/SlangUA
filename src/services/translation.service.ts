import { PrismaClient, SlangStyle, AIProvider, Translation } from '@prisma/client';
import { aiService } from './ai/ai.service.js';
import { prisma } from '../lib/prisma.js';
import { getStyleMetadata } from '../style-engine/loader.js';
import { userService } from './user.service.js';

export interface TranslateInput {
  text: string;
  style: SlangStyle;
}

export interface TranslationResult {
  id: number;
  originalText: string;
  translatedText: string;
  slangStyle: SlangStyle;
  aiProvider: AIProvider;
  favorite: boolean;
  createdAt: Date;
}

export class TranslationService {
  private prisma: PrismaClient;

  // Patterns that may indicate prompt injection attempts
  private readonly PROMPT_INJECTION_PATTERNS = [
    /ignore\s+previous\s+instructions/i,
    /disregard\s+previous\s+instructions/i,
    /forget\s+previous\s+instructions/i,
    /system\s+prompt/i,
    /you\s+are\s+now/i,
    /act\s+as\s+if/i,
    /pretend\s+to\s+be/i,
    /roleplay\s+as/i,
    /simulate\s+being/i,
    /new\s+instructions:/i,
    /override\s+instructions/i,
    /bypass\s+safety/i,
    /ignore\s+safety/i,
    /disable\s+safety/i,
    /jailbreak/i,
    /DAN\s+mode/i,
    /developer\s+mode/i,
    /<\|.*?\|>/g, // Special tokens
    /\[INST\].*?\[\/INST\]/gis, // Instruction tags
    /<<SYS>>.*?<\/SYS>>/gis, // System prompt tags
  ];

  constructor(prismaClient: PrismaClient = prisma) {
    this.prisma = prismaClient;
  }

  /**
   * Sanitize text for prompt injection protection
   * Returns sanitized text and whether any suspicious patterns were found
   */
  private sanitizeForPromptInjection(text: string): { sanitized: string; suspicious: boolean } {
    let sanitized = text;
    let suspicious = false;

    for (const pattern of this.PROMPT_INJECTION_PATTERNS) {
      if (pattern.test(text)) {
        suspicious = true;
        // Replace suspicious patterns with safe placeholder
        sanitized = sanitized.replace(pattern, '[FILTERED]');
      }
    }

    // Also trim excessive whitespace and normalize
    sanitized = sanitized.trim().replace(/\s+/g, ' ');

    return { sanitized, suspicious };
  }

  /**
   * Translate text to slang style
   * Performs sanitization, AI translation, and persistence
   * Basic validation (length, style enum) is handled by Zod schema at route level (400)
   * Prompt injection detection is the only semantic validation here (422)
   * Age restriction check for age-restricted styles (403)
   */
  async translate(userId: number, input: TranslateInput): Promise<TranslationResult> {
    const { text, style } = input;

    // 0. Age restriction check - before any AI call
    let styleMetadata;
    try {
      styleMetadata = await getStyleMetadata(style);
    } catch {
      const error = new Error('Selected style is unavailable.') as Error & { code: string; statusCode: number };
      error.code = 'STYLE_UNAVAILABLE';
      error.statusCode = 400;
      throw error;
    }
    if (styleMetadata.ageRestricted) {
      const profile = await userService.getProfile(userId);
      if (!profile || !profile.ageConfirmedAdult) {
        const error = new Error('This style requires age confirmation.') as Error & { code: string; statusCode: number };
        error.code = 'AGE_RESTRICTED_STYLE';
        error.statusCode = 403;
        throw error;
      }
    }

    // 1. Sanitize for prompt injection (only semantic validation at service layer)
    const { sanitized: sanitizedText, suspicious } = this.sanitizeForPromptInjection(text);

    // If suspicious content detected, reject with 422
    if (suspicious) {
      const error = new Error('Input contains potentially malicious content');
      (error as any).code = 'PROMPT_INJECTION_DETECTED';
      (error as any).statusCode = 422;
      throw error;
    }

    // 2. Call AI service for translation
    let aiResponse;
    try {
      aiResponse = await aiService.translate({
        text: sanitizedText,
        style,
      });
    } catch (error) {
      // Log the raw provider error server-side for diagnostics
      console.error('[TranslationService] All AI providers failed:', error);
      // Throw generic message to client (no raw SDK details)
      const err = new Error('All AI providers are currently unavailable. Please try again later.');
      (err as any).code = 'AI_PROVIDER_UNAVAILABLE';
      (err as any).statusCode = 503;
      throw err;
    }

    // 3. Persist translation record
    const translation = await this.prisma.translation.create({
      data: {
        userId,
        originalText: text, // Store original text, not sanitized
        translatedText: aiResponse.translatedText,
        slangStyle: style,
        aiProvider: aiResponse.provider,
        favorite: false,
      },
    });

    // 4. Return full translation record
    return {
      id: translation.id,
      originalText: translation.originalText,
      translatedText: translation.translatedText,
      slangStyle: translation.slangStyle,
      aiProvider: translation.aiProvider,
      favorite: translation.favorite,
      createdAt: translation.createdAt,
    };
  }
}

// Export singleton instance
export const translationService = new TranslationService();
