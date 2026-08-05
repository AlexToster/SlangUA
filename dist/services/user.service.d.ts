import { PrismaClient, SlangStyle } from '@prisma/client';
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
export declare class UserService {
    private prisma;
    private readonly IMMUTABLE_FIELDS;
    constructor(prismaClient?: PrismaClient);
    /**
     * Get current user's profile
     */
    getProfile(userId: number): Promise<UserProfile | null>;
    /**
     * Update user's application-level preferences
     * Only mutable fields (defaultSlangStyle, notificationsEnabled) can be updated
     * Attempting to update immutable fields throws an error
     */
    updatePreferences(userId: number, input: UpdatePreferencesInput): Promise<UserProfile>;
}
export declare const userService: UserService;
//# sourceMappingURL=user.service.d.ts.map