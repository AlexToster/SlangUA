"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.translationService = exports.TranslationService = void 0;
const ai_service_js_1 = require("./ai/ai.service.js");
const prisma_js_1 = require("../lib/prisma.js");
class TranslationService {
    prisma;
    // Patterns that may indicate prompt injection attempts
    PROMPT_INJECTION_PATTERNS = [
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
    constructor(prismaClient = prisma_js_1.prisma) {
        this.prisma = prismaClient;
    }
    /**
     * Sanitize text for prompt injection protection
     * Returns sanitized text and whether any suspicious patterns were found
     */
    sanitizeForPromptInjection(text) {
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
     */
    async translate(userId, input) {
        const { text, style } = input;
        // 1. Sanitize for prompt injection (only semantic validation at service layer)
        const { sanitized: sanitizedText, suspicious } = this.sanitizeForPromptInjection(text);
        // If suspicious content detected, reject with 422
        if (suspicious) {
            const error = new Error('Input contains potentially malicious content');
            error.code = 'PROMPT_INJECTION_DETECTED';
            error.statusCode = 422;
            throw error;
        }
        // 2. Call AI service for translation
        let aiResponse;
        try {
            aiResponse = await ai_service_js_1.aiService.translate({
                text: sanitizedText,
                style,
            });
        }
        catch (error) {
            // Log the raw provider error server-side for diagnostics
            console.error('[TranslationService] All AI providers failed:', error);
            // Throw generic message to client (no raw SDK details)
            const err = new Error('All AI providers are currently unavailable. Please try again later.');
            err.code = 'AI_PROVIDER_UNAVAILABLE';
            err.statusCode = 503;
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
exports.TranslationService = TranslationService;
// Export singleton instance
exports.translationService = new TranslationService();
//# sourceMappingURL=translation.service.js.map