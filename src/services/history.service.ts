import { PrismaClient, SlangStyle, AIProvider, Translation, Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma.js';

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

interface HistoryCursor {
  createdAt: string;
  id: number;
}

function encodeCursor(translation: Pick<Translation, 'createdAt' | 'id'>): string {
  return Buffer.from(JSON.stringify({
    createdAt: translation.createdAt.toISOString(),
    id: translation.id,
  })).toString('base64url');
}

function decodeCursor(cursor: string): HistoryCursor {
  try {
    const parsed = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as HistoryCursor;
    const createdAt = new Date(parsed.createdAt);

    if (!Number.isSafeInteger(parsed.id) || parsed.id < 1 || Number.isNaN(createdAt.getTime())) {
      throw new Error('Invalid cursor payload');
    }

    return { createdAt: createdAt.toISOString(), id: parsed.id };
  } catch {
    const error = new Error('Invalid history cursor') as Error & { code: string; statusCode: number };
    error.code = 'INVALID_CURSOR';
    error.statusCode = 400;
    throw error;
  }
}

export class HistoryService {
  private prisma: PrismaClient;
  private readonly DEFAULT_LIMIT = 20;
  private readonly MAX_LIMIT = 100;

  constructor(prismaClient: PrismaClient = prisma) {
    this.prisma = prismaClient;
  }

  /**
   * Get paginated history for a user with optional filters
   */
  async getHistory(params: HistoryListParams): Promise<HistoryListResult> {
    const { userId, cursor, limit = this.DEFAULT_LIMIT, favorite, search } = params;
    const safeLimit = Math.min(limit, this.MAX_LIMIT);

    const filters: Prisma.TranslationWhereInput[] = [{ userId }];

    if (favorite !== undefined) {
      filters.push({ favorite });
    }

    if (search && search.trim().length > 0) {
      const searchTerm = search.trim();
      filters.push({ OR: [
        { originalText: { contains: searchTerm, mode: 'insensitive' } },
        { translatedText: { contains: searchTerm, mode: 'insensitive' } },
      ] });
    }

    const baseWhere: Prisma.TranslationWhereInput = { AND: filters };
    const pageFilters = [...filters];

    // Handle keyset pagination. createdAt + id keeps the ordering stable when
    // multiple translations share the same timestamp.
    if (cursor) {
      const decodedCursor = decodeCursor(cursor);
      const cursorDate = new Date(decodedCursor.createdAt);
      pageFilters.push({
        OR: [
          { createdAt: { lt: cursorDate } },
          { createdAt: cursorDate, id: { lt: decodedCursor.id } },
        ],
      });
    }

    const pageWhere: Prisma.TranslationWhereInput = { AND: pageFilters };

    // totalCount describes all matching records, not only records after cursor.
    const totalCount = await this.prisma.translation.count({ where: baseWhere });

    // Fetch translations (newest first)
    const translations = await this.prisma.translation.findMany({
      where: pageWhere,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: safeLimit + 1, // Take one extra to determine if there's a next page
    });

    // Determine if there's a next page
    const hasNextPage = translations.length > safeLimit;
    const data = hasNextPage ? translations.slice(0, safeLimit) : translations;

    // Next cursor contains the full keyset ordering tuple.
    const nextCursor = hasNextPage && data.length > 0
      ? encodeCursor(data[data.length - 1])
      : null;

    return { data, nextCursor, totalCount };
  }

  /**
   * Toggle favorite flag on a user-owned translation
   */
  async toggleFavorite(userId: number, translationId: number): Promise<ToggleFavoriteResult | null> {
    // First, verify the translation exists and belongs to the user
    const translation = await this.prisma.translation.findFirst({
      where: { id: translationId, userId },
    });

    if (!translation) {
      return null; // Not found or not owned
    }

    // Toggle the favorite flag
    const updated = await this.prisma.translation.update({
      where: { id: translationId },
      data: { favorite: !translation.favorite },
    });

    return {
      id: updated.id,
      originalText: updated.originalText,
      translatedText: updated.translatedText,
      slangStyle: updated.slangStyle,
      aiProvider: updated.aiProvider,
      favorite: updated.favorite,
      createdAt: updated.createdAt,
    };
  }

  /**
   * Delete a user-owned translation
   */
  async deleteTranslation(userId: number, translationId: number): Promise<boolean> {
    // Verify the translation exists and belongs to the user
    const translation = await this.prisma.translation.findFirst({
      where: { id: translationId, userId },
    });

    if (!translation) {
      return false; // Not found or not owned
    }

    await this.prisma.translation.delete({
      where: { id: translationId },
    });

    return true;
  }
}

// Export singleton instance
export const historyService = new HistoryService();
