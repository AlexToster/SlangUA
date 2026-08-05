import { PrismaClient, User, SlangStyle } from '@prisma/client';
import { prisma } from '../lib/prisma.js';

export interface UserProfile {
  telegramId: string;
  username: string | null;
  firstName: string | null;
  lastName: string | null;
  languageCode: string | null;
  defaultSlangStyle: SlangStyle | null;
  notificationsEnabled: boolean;
  createdAt: Date;
}

export interface UpdatePreferencesInput {
  defaultSlangStyle?: SlangStyle;
  notificationsEnabled?: boolean;
}

export class UserService {
  private prisma: PrismaClient;

  // Immutable fields that cannot be modified via API (Telegram-sourced)
  private readonly IMMUTABLE_FIELDS = [
    'telegramId',
    'username',
    'firstName',
    'lastName',
    'languageCode',
  ] as const;

  constructor(prismaClient: PrismaClient = prisma) {
    this.prisma = prismaClient;
  }

  /**
   * Get current user's profile
   */
  async getProfile(userId: number): Promise<UserProfile | null> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        telegramId: true,
        username: true,
        firstName: true,
        lastName: true,
        languageCode: true,
        defaultSlangStyle: true,
        notificationsEnabled: true,
        createdAt: true,
      },
    });

    if (!user) {
      return null;
    }

    return {
      telegramId: user.telegramId,
      username: user.username,
      firstName: user.firstName,
      lastName: user.lastName,
      languageCode: user.languageCode,
      defaultSlangStyle: user.defaultSlangStyle,
      notificationsEnabled: user.notificationsEnabled,
      createdAt: user.createdAt,
    };
  }

  /**
   * Update user's application-level preferences
   * Only mutable fields (defaultSlangStyle, notificationsEnabled) can be updated
   * Attempting to update immutable fields throws an error
   */
  async updatePreferences(
    userId: number,
    input: UpdatePreferencesInput
  ): Promise<UserProfile> {
    // Check for immutable fields in the input
    const inputKeys = Object.keys(input) as Array<keyof UpdatePreferencesInput>;
    const immutableFieldsInInput = inputKeys.filter((key) =>
      this.IMMUTABLE_FIELDS.includes(key as any)
    );

    if (immutableFieldsInInput.length > 0) {
      const error = new Error(
        `Cannot modify immutable fields: ${immutableFieldsInInput.join(', ')}`
      ) as Error & { code: string; statusCode: number };
      error.code = 'IMMUTABLE_FIELD';
      error.statusCode = 400;
      throw error;
    }

    // Build update data with only allowed fields
    const updateData: Partial<UpdatePreferencesInput> = {};

    if (input.defaultSlangStyle !== undefined) {
      updateData.defaultSlangStyle = input.defaultSlangStyle;
    }

    if (input.notificationsEnabled !== undefined) {
      updateData.notificationsEnabled = input.notificationsEnabled;
    }

    // If no valid fields to update, return current profile
    if (Object.keys(updateData).length === 0) {
      const profile = await this.getProfile(userId);
      if (!profile) {
        const error = new Error('User not found') as Error & { code: string; statusCode: number };
        error.code = 'USER_NOT_FOUND';
        error.statusCode = 404;
        throw error;
      }
      return profile;
    }

    const updatedUser = await this.prisma.user.update({
      where: { id: userId },
      data: updateData,
      select: {
        telegramId: true,
        username: true,
        firstName: true,
        lastName: true,
        languageCode: true,
        defaultSlangStyle: true,
        notificationsEnabled: true,
        createdAt: true,
      },
    });

    return {
      telegramId: updatedUser.telegramId,
      username: updatedUser.username,
      firstName: updatedUser.firstName,
      lastName: updatedUser.lastName,
      languageCode: updatedUser.languageCode,
      defaultSlangStyle: updatedUser.defaultSlangStyle,
      notificationsEnabled: updatedUser.notificationsEnabled,
      createdAt: updatedUser.createdAt,
    };
  }
}

// Export singleton instance
export const userService = new UserService();