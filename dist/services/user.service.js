"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.userService = exports.UserService = void 0;
const prisma_js_1 = require("../lib/prisma.js");
class UserService {
    prisma;
    // Immutable fields that cannot be modified via API (Telegram-sourced)
    IMMUTABLE_FIELDS = [
        'telegramId',
        'username',
        'firstName',
        'lastName',
        'languageCode',
    ];
    constructor(prismaClient = prisma_js_1.prisma) {
        this.prisma = prismaClient;
    }
    /**
     * Get current user's profile
     */
    async getProfile(userId) {
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
    async updatePreferences(userId, input) {
        // Check for immutable fields in the input
        const inputKeys = Object.keys(input);
        const immutableFieldsInInput = inputKeys.filter((key) => this.IMMUTABLE_FIELDS.includes(key));
        if (immutableFieldsInInput.length > 0) {
            const error = new Error(`Cannot modify immutable fields: ${immutableFieldsInInput.join(', ')}`);
            error.code = 'IMMUTABLE_FIELD';
            error.statusCode = 400;
            throw error;
        }
        // Build update data with only allowed fields
        const updateData = {};
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
                const error = new Error('User not found');
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
exports.UserService = UserService;
// Export singleton instance
exports.userService = new UserService();
//# sourceMappingURL=user.service.js.map