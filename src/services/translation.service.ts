import { PrismaClient, SlangStyle, AIProvider, Translation } from '@prisma/client';
import { aiService } from './ai/ai.service.js';
import { prisma } from '../lib/prisma.js';
import { logger } from '../lib/logger.js';
import { config } from '../config/index.js';
import { getStyleMetadata, RegistryEntry } from '../style-engine/loader.js';
import { userService } from './user.service.js';
import { previewCacheService, PreviewData } from './preview-cache.service.js';
import { HISTORY_MAX_ENTRIES } from '../constants/index.js';

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

  // Patterns that may indicate prompt injection attempts
  // Includes English and Ukrainian variants; case-insensitive
  private readonly PROMPT_INJECTION_PATTERNS = [
    // Ignore/disregard/forget previous instructions (EN + UK)
    /ignore\s+previous\s+instructions/i,
    /disregard\s+previous\s+instructions/i,
    /forget\s+previous\s+instructions/i,
    /ігноруй\s+попередн(і|ьої)\s+інструкц(ії|ія)/i,
    /проігноруй\s+попередн(і|ьої)\s+інструкц(ії|ія)/i,
    /не\s+звертай\s+увагу\s+на\s+попередн(і|ьої)\s+інструкц(ії|ія)/i,
    /забу(д[ьи]|ти)\s+попередн(і|ьої)\s+інструкц(ії|ія)/i,

    // System prompt - narrowed: require imperative verb nearby (EN + UK)
    // Matches: "ignore system prompt", "reveal system prompt", "show system prompt",
    // "bypass system prompt", "override system prompt", "disregard system prompt"
    // and Ukrainian equivalents
    /(ignore|reveal|show|bypass|override|disregard)\s+(system\s+)?prompt/i,
    /(ігноруй|покажи|розкрий|обійди|перевизнач)\s+(системн(ий|а|е|ою)?\s+)?промпт/i,

    // Roleplay/pretend/act as (EN + UK)
    /you\s+are\s+now/i,
    /act\s+as\s+if/i,
    /pretend\s+to\s+be/i,
    /roleplay\s+as/i,
    /simulate\s+being/i,
    /ти\s+зараз\s+(є|становся)/i,
    /ти\s+тепер\s+(є|становся)/i,
    /прикинься\s+що\s+ти/i,
    /притворися\s+що\s+ти/i,
    /притворися\s+/i,
    /прикинься\s+/i,
    /відіграй\s+роль\s+/i,
    /ролплей\s+як\s+/i,
    /симулюй\s+/i,
    /імітуй\s+/i,

    // New/override instructions (EN + UK)
    /new\s+instructions:/i,
    /override\s+instructions/i,
    /нов(і|а)\s+інструкц(ії|ія):/i,
    /зміни\s+інструкц(ії|ію)/i,
    /перевизнач\s+інструкц(ії|ію)/i,

    // Bypass/ignore/disable safety (EN + UK)
    /bypass\s+safety/i,
    /ignore\s+safety/i,
    /disable\s+safety/i,
    /обійди\s+безпеку/i,
    /обходи\s+безпеку/i,
    /ігноруй\s+безпеку/i,
    /вимкни\s+безпеку/i,
    /відключи\s+безпеку/i,

    // Jailbreak / DAN / developer mode (EN + UK + transliterated)
    /jailbreak/i,
    /джайлбрейк/i,
    /джейлбрейк/i,
    /DAN\s+mode/i,
    /DAN\s+режим/i,
    /developer\s+mode/i,
    /режим\s+розробника/i,
    /девелопер\s+режим/i,
    /dev\s+mode/i,

    // Special tokens / instruction tags.
    // Declared WITHOUT the /g flag on purpose - see sanitizeForPromptInjection().
    /<\|.*?\|>/is,
    /\[INST\].*?\[\/INST\]/is,
    /<<SYS>>.*?<\/SYS>>/is,
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
   *
   * None of the patterns carry the /g flag: a global regex reused across calls
   * keeps `lastIndex` between `.test()` invocations, which produced intermittent
   * false negatives. Global replacement is done on a per-call clone instead.
   */
  private sanitizeForPromptInjection(text: string): { sanitized: string; suspicious: boolean } {
    let sanitized = text;
    let suspicious = false;

    for (const pattern of this.PROMPT_INJECTION_PATTERNS) {
      if (pattern.test(text)) {
        suspicious = true;
        // Replace every occurrence, not just the first one
        sanitized = sanitized.replace(new RegExp(pattern.source, `${pattern.flags}g`), '[FILTERED]');
      }
    }

    // Also trim excessive whitespace and normalize
    sanitized = sanitized.trim().replace(/\s+/g, ' ');

    return { sanitized, suspicious };
  }

  /**
   * Resolve style metadata from the registry.
   * An unknown or disabled style is a client error (400), never a silent fallback.
   */
  private async resolveStyleMetadata(style: SlangStyle): Promise<RegistryEntry> {
    try {
      return await getStyleMetadata(style);
    } catch {
      const error = new Error('Selected style is unavailable.') as Error & { code: string; statusCode: number };
      error.code = 'STYLE_UNAVAILABLE';
      error.statusCode = 400;
      throw error;
    }
  }

  /**
   * The single real enforcement point of the age gate. `GET /styles` only exposes
   * the `ageRestricted` flag so the UI can lock the entry; that lock is cosmetic.
   * Must run on every request path, including cache hits.
   */
  private async assertAgeAllowed(userId: number, styleMetadata: RegistryEntry): Promise<void> {
    if (!styleMetadata.ageRestricted) {
      return;
    }
    const profile = await userService.getProfile(userId);
    if (!profile || !profile.ageConfirmedAdult) {
      const error = new Error('This style requires age confirmation.') as Error & { code: string; statusCode: number };
      error.code = 'AGE_RESTRICTED_STYLE';
      error.statusCode = 403;
      throw error;
    }
  }

  /**
   * Reject prompt injection attempts (422) and return the sanitized text.
   * Must run on every request path, including cache hits.
   */
  private assertNoPromptInjection(normalizedText: string): string {
    const { sanitized, suspicious } = this.sanitizeForPromptInjection(normalizedText);
    if (suspicious) {
      const error = new Error('Input contains potentially malicious content') as Error & { code: string; statusCode: number };
      error.code = 'PROMPT_INJECTION_DETECTED';
      error.statusCode = 422;
      throw error;
    }
    return sanitized;
  }

  /**
   * Call the AI layer. Expects text that has already been normalized, age-gated
   * and checked for prompt injection by the caller. Does NOT persist anything.
   */
  private async translateCore(
    normalizedText: string,
    sanitizedText: string,
    style: SlangStyle
  ): Promise<PreviewResult> {
    let aiResponse;
    try {
      aiResponse = await aiService.translate({
        text: sanitizedText,
        style,
      });
    } catch (error) {
      // Log the raw provider error server-side for diagnostics
      logger.error({ err: error }, '[TranslationService] All AI providers failed');
      // Throw generic message to client (no raw SDK details)
      const err = new Error('All AI providers are currently unavailable. Please try again later.') as Error & { code: string; statusCode: number };
      err.code = 'AI_PROVIDER_UNAVAILABLE';
      err.statusCode = 503;
      throw err;
    }

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

    // Get style metadata from the registry (version feeds the cache key)
    const styleMetadata = await this.resolveStyleMetadata(style);
    const styleVersion = styleMetadata.version;

    // Age gate and prompt-injection check run BEFORE the cache lookup on purpose.
    // A warm cache must never become a way around them: age confirmation can be
    // revoked while a cached entry is still inside its TTL.
    await this.assertAgeAllowed(userId, styleMetadata);
    const sanitizedText = this.assertNoPromptInjection(normalizedText);

    // Check cache for identical request (HMAC-based deduplication)
    const cachedPreviewId = await previewCacheService.checkCacheHit(
      userId,
      normalizedText,
      style,
      styleVersion
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
    const previewResult = await this.translateCore(normalizedText, sanitizedText, style);

    // Store in cache with encryption, get previewId
    const previewData: PreviewData = {
      originalText: previewResult.originalText,
      translatedText: previewResult.translatedText,
      style: previewResult.slangStyle,
      styleVersion,
      aiProvider: previewResult.aiProvider,
      userId,
      createdAt: Date.now(),
      // Same TTL the Redis key gets - both must come from one setting
      expiresAt: Date.now() + config.PREVIEW_CACHE_TTL_SECONDS * 1000,
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
      // Look up the existing translation by previewId and userId
      const existingTranslation = await this.prisma.translation.findFirst({
        where: { previewId, userId },
      });
      if (existingTranslation) {
        const error = new Error('This preview has already been saved') as Error & { code: string; statusCode: number; existingTranslation: Translation };
        error.code = 'PREVIEW_ALREADY_SAVED';
        error.statusCode = 409;
        error.existingTranslation = existingTranslation;
        throw error;
      }
      // Fallback: record not found despite idempotency marker - throw bare 409
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
          styleVersion: previewData.styleVersion,
          aiProvider: previewData.aiProvider as AIProvider,
          favorite: false,
        },
      });
    } catch (error: any) {
      if (error?.code === 'P2002') {
        // Look up the existing translation by previewId and userId
        const existingTranslation = await this.prisma.translation.findFirst({
          where: { previewId, userId },
        });
        if (existingTranslation) {
          const duplicate = new Error('This preview has already been saved') as Error & { code: string; statusCode: number; existingTranslation: Translation };
          duplicate.code = 'PREVIEW_ALREADY_SAVED';
          duplicate.statusCode = 409;
          duplicate.existingTranslation = existingTranslation;
          throw duplicate;
        }
        // Fallback: record not found despite constraint violation - throw bare 409
        const duplicate = new Error('This preview has already been saved') as Error & { code: string; statusCode: number };
        duplicate.code = 'PREVIEW_ALREADY_SAVED';
        duplicate.statusCode = 409;
        throw duplicate;
      }
      throw error;
    }

    // Delete preview data after successful save (keeps idempotency marker)
    await previewCacheService.deletePreview(previewId, previewData);

    await this.pruneHistory(userId);

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
   *
   * Implements HMAC-based cache deduplication (same as translatePreview):
   * - Checks cache for identical request (userId + normalized text + style + styleVersion)
   * - If cache hit, returns existing translation without calling LLM
   * - If cache miss, calls LLM, persists to database
   */
  async translate(userId: number, input: TranslateInput): Promise<TranslationResult> {
    const { text, style } = input;

    // Validate and normalize text first
    const { normalizedText } = this.validateAndNormalizeText(text);

    // Get style metadata from the registry (version feeds the cache key)
    const styleMetadata = await this.resolveStyleMetadata(style);
    const styleVersion = styleMetadata.version;

    // Age gate and prompt-injection check run BEFORE the cache lookup on purpose.
    // See translatePreview() - a cache hit must not skip either check.
    await this.assertAgeAllowed(userId, styleMetadata);
    const sanitizedText = this.assertNoPromptInjection(normalizedText);

    // Check cache for identical request (HMAC-based deduplication)
    const cachedPreviewId = await previewCacheService.checkCacheHit(
      userId,
      normalizedText,
      style,
      styleVersion
    );

    if (cachedPreviewId) {
      // Cache hit - retrieve existing preview data and persist as translation
      const cachedData = await previewCacheService.getPreview(cachedPreviewId, userId);
      if (cachedData) {
        // previewId is deliberately NOT written here. It is a @unique column owned
        // by the preview -> save flow; claiming it on this direct path made a second
        // warm-cache request violate the constraint and surface as a 500.
        const translation = await this.prisma.translation.create({
          data: {
            userId,
            originalText: cachedData.originalText,
            translatedText: cachedData.translatedText,
            slangStyle: cachedData.style as SlangStyle,
            styleVersion,
            aiProvider: cachedData.aiProvider as AIProvider,
            favorite: false,
          },
        });

        await this.pruneHistory(userId);

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
      // If cached data not found (expired/deleted), fall through to generate new
    }

    // Cache miss - perform translation
    const previewResult = await this.translateCore(normalizedText, sanitizedText, style);

    // Persist translation record with style version
    const translation = await this.prisma.translation.create({
      data: {
        userId,
        originalText: previewResult.originalText,
        translatedText: previewResult.translatedText,
        slangStyle: previewResult.slangStyle,
        styleVersion,
        aiProvider: previewResult.aiProvider,
        favorite: false,
      },
    });

    await this.pruneHistory(userId);

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
  /**
   * Keep a user's history at HISTORY_MAX_ENTRIES rows by deleting the oldest
   * non-favorite translations. Called after every insert.
   *
   * The cap lives here, not in the client: the UI label ("5/100") is cosmetic
   * and a client could simply not send it. Favorites are exempt on purpose -
   * silently deleting something the user starred is worse than going over.
   *
   * A failure here must never fail the save the user asked for, so it is logged
   * and swallowed; the next insert retries the prune.
   */
  private async pruneHistory(userId: number): Promise<void> {
    try {
      const total = await this.prisma.translation.count({ where: { userId } });
      const excess = total - HISTORY_MAX_ENTRIES;
      if (excess <= 0) return;

      const stale = await this.prisma.translation.findMany({
        where: { userId, favorite: false },
        orderBy: { createdAt: 'asc' },
        take: excess,
        select: { id: true },
      });
      if (stale.length === 0) return;

      await this.prisma.translation.deleteMany({
        where: { userId, id: { in: stale.map(row => row.id) } },
      });
      logger.debug({ userId, pruned: stale.length }, 'History pruned to cap');
    } catch (err) {
      logger.warn({ err, userId }, 'History prune failed');
    }
  }
}

// Export singleton instance
export const translationService = new TranslationService();
