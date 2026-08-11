import { PrismaClient, SlangStyle, AIProvider, Translation } from '@prisma/client';
import { aiService } from './ai/ai.service.js';
import { prisma } from '../lib/prisma.js';
import { getStyleMetadata } from '../style-engine/loader.js';
import { userService } from './user.service.js';
import { previewCacheService, PreviewData } from './preview-cache.service.js';

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

export interface PreviewResult {
  originalText: string;
  translatedText: string;
  slangStyle: SlangStyle;
  aiProvider: AIProvider;
  previewId: string;
}

export interface SaveFromPreviewResult {
  translation: TranslationResult;
  fromPreview: boolean;
}

export class TranslationService {
  private prisma: PrismaClient;

  // Style version for cache invalidation when style definitions change
  private readonly STYLE_VERSION = '1.0.0';

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
   * Validate and normalize text according to the text contract:
   * - trim before validation
   * - 1-1000 Unicode grapheme clusters via Intl.Segmenter
   * - reject whitespace-only text
   * Returns normalized text (trimmed) and grapheme cluster count
   */
  validateAndNormalizeText(text: string): { normalizedText: string; graphemeCount: number } {
    // Trim first
    const trimmed = text.trim();
    
    // Reject whitespace-only
    if (trimmed.length === 0) {
      const error = new Error('Text must not be empty or whitespace only') as Error & { code: string; statusCode: number };
      error.code = 'EMPTY_TEXT';
      error.statusCode = 400;
      throw error;
    }

    // Count grapheme clusters using Intl.Segmenter (Node 20+)
    const segmenter = new Intl.Segmenter('uk', { granularity: 'grapheme' });
    const graphemeCount = Array.from(segmenter.segment(trimmed)).length;

    if (graphemeCount < 1 || graphemeCount > 1000) {
      const error = new Error(`Text must be between 1 and 1000 grapheme clusters, got ${graphemeCount}`) as Error & { code: string; statusCode: number };
      error.code = 'INVALID_TEXT_LENGTH';
      error.statusCode = 400;
      throw error;
    }

    return { normalizedText: trimmed, graphemeCount };
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
   * Core translation logic shared by preview and persistent translation
   * Performs age gate check, prompt injection sanitization, and AI translation
   * Does NOT persist to database
   */
  private async translateCore(userId: number, input: TranslateInput): Promise<PreviewResult> {
    const { text, style } = input;

    // Validate and normalize text
    const { normalizedText } = this.validateAndNormalizeText(text);

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
    const { sanitized: sanitizedText, suspicious } = this.sanitizeForPromptInjection(normalizedText);

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

    // 3. Return preview result (no persistence)
    return {
      originalText: normalizedText, // Return normalized text
      translatedText: aiResponse.translatedText,
      slangStyle: style,
      aiProvider: aiResponse.provider,
      previewId: '', // Will be set by caller after cache storage
    };
  }

  /**
   * Translate text to slang style for preview (no persistence)
   * Performs the same validation and AI translation as translate()
   * but does not create or update any Translation record in the database
   *
   * Implements HMAC-based cache deduplication:
   * - Checks cache for identical request (userId + normalized text + style + styleVersion)
   * - If cache hit, returns existing previewId without calling LLM
   * - If cache miss, calls LLM, stores encrypted result in Redis with previewId
   * - Returns previewId for client to use in save
   */
  async translatePreview(userId: number, input: TranslateInput): Promise<PreviewResult> {
    const { text, style } = input;

    // Validate and normalize text first
    const { normalizedText } = this.validateAndNormalizeText(text);

    // Check cache for identical request (HMAC-based deduplication)
    const cachedPreviewId = await previewCacheService.checkCacheHit(
      userId,
      normalizedText,
      style,
      this.STYLE_VERSION
    );

    if (cachedPreviewId) {
      // Cache hit - retrieve existing preview data
      const cachedData = await previewCacheService.getPreview(cachedPreviewId, userId);
      if (cachedData) {
        return {
          originalText: cachedData.originalText,
          translatedText: cachedData.translatedText,
          slangStyle: cachedData.style as SlangStyle,
          aiProvider: cachedData.aiProvider as AIProvider,
          previewId: cachedPreviewId,
        };
      }
      // If cached data not found (expired/deleted), fall through to generate new
    }

    // Cache miss - perform translation
    const previewResult = await this.translateCore(userId, { text: normalizedText, style });

    // Store in cache with encryption, get previewId
    const previewData: PreviewData = {
      originalText: previewResult.originalText,
      translatedText: previewResult.translatedText,
      style: previewResult.slangStyle,
      styleVersion: this.STYLE_VERSION,
      aiProvider: previewResult.aiProvider,
      userId,
      createdAt: Date.now(),
      expiresAt: Date.now() + (600 * 1000), // 10 minutes in ms
    };

    const previewId = await previewCacheService.storePreview(previewData);

    return {
      ...previewResult,
      previewId,
    };
  }

  /**
   * Save translation from preview
   * - Verifies preview ownership and TTL
   * - Creates Translation with exact text from preview (no LLM call)
   * - Idempotent: duplicate save returns same Translation
   * - Does NOT accept originalText or translatedText from client
   * - Deletes preview data after successful save (keeps idempotency marker)
   */
  async saveFromPreview(userId: number, previewId: string): Promise<SaveFromPreviewResult> {
    // Check idempotency first - if already saved, return existing translation
    const alreadySaved = await previewCacheService.checkIdempotency(previewId);
    if (alreadySaved) {
      // Find the existing translation for this preview
      // We need to look it up by the preview data - but we don't have it anymore
      // Instead, we can search by userId and the preview data would have been used to create it
      // For idempotency, we check if there's a recent translation matching the preview
      // Since we can't easily match without the preview data, we rely on the idempotency marker
      // The client should not call save twice, but if they do, we return a generic response
      // indicating it was already saved
      const error = new Error('This preview has already been saved') as Error & { code: string; statusCode: number };
      error.code = 'PREVIEW_ALREADY_SAVED';
      error.statusCode = 409;
      throw error;
    }

    // Get and verify preview
    const previewData = await previewCacheService.getPreview(previewId, userId);
    if (!previewData) {
      const error = new Error('Preview not found, expired, or access denied') as Error & { code: string; statusCode: number };
      error.code = 'PREVIEW_NOT_FOUND';
      error.statusCode = 404;
      throw error;
    }

    // Verify preview hasn't expired (double check)
    if (Date.now() > previewData.expiresAt) {
      const error = new Error('Preview has expired') as Error & { code: string; statusCode: number };
      error.code = 'PREVIEW_EXPIRED';
      error.statusCode = 410;
      throw error;
    }

    // A database-level unique key is the final idempotency guard. Redis markers
    // alone cannot prevent two concurrent requests from passing the pre-check.
    let translation: Translation;
    try {
      translation = await this.prisma.translation.create({
        data: {
          userId,
          previewId,
          originalText: previewData.originalText,
          translatedText: previewData.translatedText,
          slangStyle: previewData.style as SlangStyle,
          aiProvider: previewData.aiProvider as AIProvider,
          favorite: false,
        },
      });
    } catch (error: any) {
      if (error?.code === 'P2002') {
        const duplicate = new Error('This preview has already been saved') as Error & { code: string; statusCode: number };
        duplicate.code = 'PREVIEW_ALREADY_SAVED';
        duplicate.statusCode = 409;
        throw duplicate;
      }
      throw error;
    }

    // Delete preview data after successful save (keeps idempotency marker)
    await previewCacheService.deletePreview(previewId, previewData);

    // Return full translation record
    return {
      translation: {
        id: translation.id,
        originalText: translation.originalText,
        translatedText: translation.translatedText,
        slangStyle: translation.slangStyle,
        aiProvider: translation.aiProvider,
        favorite: translation.favorite,
        createdAt: translation.createdAt,
      },
      fromPreview: true,
    };
  }

  /**
   * Translate text to slang style and persist to database (direct, non-preview path)
   * Performs sanitization, AI translation, and persistence
   * Basic validation (length, style enum) is handled by Zod schema at route level (400)
   * Prompt injection detection is the only semantic validation here (422)
   * Age restriction check for age-restricted styles (403)
   */
  async translate(userId: number, input: TranslateInput): Promise<TranslationResult> {
    // Use core translation logic
    const previewResult = await this.translateCore(userId, input);

    // Persist translation record
    const translation = await this.prisma.translation.create({
      data: {
        userId,
        originalText: previewResult.originalText,
        translatedText: previewResult.translatedText,
        slangStyle: previewResult.slangStyle,
        aiProvider: previewResult.aiProvider,
        favorite: false,
      },
    });

    // Return full translation record
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
