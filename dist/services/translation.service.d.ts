import { PrismaClient, SlangStyle, AIProvider } from '@prisma/client';
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
export declare class TranslationService {
    private prisma;
    private readonly PROMPT_INJECTION_PATTERNS;
    constructor(prismaClient?: PrismaClient);
    /**
     * Sanitize text for prompt injection protection
     * Returns sanitized text and whether any suspicious patterns were found
     */
    private sanitizeForPromptInjection;
    /**
     * Translate text to slang style
     * Performs sanitization, AI translation, and persistence
     * Basic validation (length, style enum) is handled by Zod schema at route level (400)
     * Prompt injection detection is the only semantic validation here (422)
     */
    translate(userId: number, input: TranslateInput): Promise<TranslationResult>;
}
export declare const translationService: TranslationService;
//# sourceMappingURL=translation.service.d.ts.map