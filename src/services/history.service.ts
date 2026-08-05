import { PrismaClient, SlangStyle, AIProvider, Translation } from '@prisma/client';
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

    // Build where clause
    const where: any = { userId };

    if (favorite !== undefined) {
      where.favorite = favorite;
    }

    if (search && search.trim().length > 0) {
      const searchTerm = search.trim();
      where.OR = [
        { originalText: { contains: searchTerm, mode: 'insensitive' } },
        { translatedText: { contains: searchTerm, mode: 'insensitive' } },
      ];
    }

    // Handle cursor-based pagination
    // Cursor is the createdAt timestamp of the last item in the previous page
    if (cursor) {
      const cursorDate = new Date(cursor);
      if (!isNaN(cursorDate.getTime())) {
        where.createdAt = { lt: cursorDate };
      }
    }

    // Get total count for UI hints
    const totalCount = await this.prisma.translation.count({ where });

    // Fetch translations (newest first)
    const translations = await this.prisma.translation.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: safeLimit + 1, // Take one extra to determine if there's a next page
    });

    // Determine if there's a next page
    const hasNextPage = translations.length > safeLimit;
    const data = hasNextPage ? translations.slice(0, safeLimit) : translations;

    // Next cursor is the createdAt of the last item in the current page
    const nextCursor = hasNextPage && data.length > 0
      ? data[data.length - 1].createdAt.toISOString()
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