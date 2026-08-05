import { PrismaClient, SlangStyle, AIProvider, Translation } from '@prisma/client';
export interface HistoryListParams {
    userId: number;
    cursor?: string;
    limit?: number;
    favorite?: boolean;
    search?: string;
}
export interface HistoryListResult {
    data: Translation[];
    nextCursor: string | null;
    totalCount: number;
}
export interface ToggleFavoriteResult {
    id: number;
    originalText: string;
    translatedText: string;
    slangStyle: SlangStyle;
    aiProvider: AIProvider;
    favorite: boolean;
    createdAt: Date;
}
export declare class HistoryService {
    private prisma;
    private readonly DEFAULT_LIMIT;
    private readonly MAX_LIMIT;
    constructor(prismaClient?: PrismaClient);
    /**
     * Get paginated history for a user with optional filters
     */
    getHistory(params: HistoryListParams): Promise<HistoryListResult>;
    /**
     * Toggle favorite flag on a user-owned translation
     */
    toggleFavorite(userId: number, translationId: number): Promise<ToggleFavoriteResult | null>;
    /**
     * Delete a user-owned translation
     */
    deleteTranslation(userId: number, translationId: number): Promise<boolean>;
}
export declare const historyService: HistoryService;
//# sourceMappingURL=history.service.d.ts.map