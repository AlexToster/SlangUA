import { User, RefreshToken } from '@prisma/client';
import { JWTPayload } from 'jose';
export interface TelegramUser {
    id: number;
    first_name: string;
    last_name?: string;
    username?: string;
    language_code?: string;
    is_premium?: boolean;
}
export interface TelegramInitData {
    query_id?: string;
    user?: TelegramUser;
    receiver?: TelegramUser;
    chat?: TelegramUser;
    chat_type?: string;
    chat_instance?: string;
    start_param?: string;
    can_send_after?: number;
    auth_date: number;
    hash: string;
}
export interface AuthTokens {
    accessToken: string;
    refreshToken: string;
}
export interface JWTPayloadWithJTI extends JWTPayload {
    jti: string;
    telegramId: string;
    userId: number;
}
export declare class AuthService {
    private prisma;
    private jwtSecret;
    private refreshTokenHmacSecret;
    private accessTokenTtl;
    private refreshTokenTtl;
    private authDateTtl;
    private telegramBotToken;
    constructor();
    /**
     * Parse Telegram initData string into an object
     */
    parseInitData(initData: string): TelegramInitData;
    /**
     * Verify Telegram initData HMAC-SHA256 signature
     * Per Telegram docs: secret_key = HMAC-SHA256(bot_token, "WebAppData")
     * Then data_check_string = sorted key=value pairs joined by \n (excluding hash)
     * hash = HMAC-SHA256(secret_key, data_check_string)
     */
    verifyTelegramInitData(initData: string): {
        valid: boolean;
        data?: TelegramInitData;
        error?: string;
    };
    /**
     * Generate a random refresh token (opaque string)
     */
    generateRefreshToken(): string;
    /**
     * Hash refresh token using HMAC-SHA256 with server-side secret
     * This allows equality lookup in the database
     */
    hashRefreshToken(token: string): string;
    /**
     * Generate JWT access token with jti claim referencing the refresh token
     */
    generateAccessToken(userId: number, telegramId: string, refreshTokenId: number): Promise<string>;
    /**
     * Verify JWT access token and return payload
     */
    verifyAccessToken(token: string): Promise<JWTPayloadWithJTI | null>;
    /**
     * Upsert user by telegramId
     */
    upsertUser(telegramUser: TelegramUser): Promise<User>;
    /**
     * Create refresh token record in database
     */
    createRefreshToken(userId: number, token: string, deviceInfo?: Record<string, unknown>): Promise<RefreshToken>;
    /**
     * Find refresh token by hashed token
     */
    findRefreshToken(hashedToken: string): Promise<(RefreshToken & {
        user: User;
    }) | null>;
    /**
     * Invalidate (delete) a refresh token
     */
    invalidateRefreshToken(hashedToken: string): Promise<void>;
    /**
     * Invalidate refresh token by ID (jti)
     */
    invalidateRefreshTokenById(id: number): Promise<void>;
    /**
     * Authenticate via Telegram initData
     * Returns access token and refresh token
     */
    authenticateWithTelegram(initData: string, deviceInfo?: Record<string, unknown>): Promise<AuthTokens>;
    /**
     * Refresh access token using refresh token
     * Rotates refresh token (invalidates old, creates new)
     */
    refreshTokens(refreshToken: string): Promise<AuthTokens>;
    /**
     * Logout - invalidate refresh token referenced by access token's jti
     */
    logout(accessToken: string): Promise<void>;
    /**
     * Parse TTL string (e.g., "15m", "7d") to milliseconds
     */
    private parseTtlToMs;
}
export declare const authService: AuthService;
//# sourceMappingURL=auth.service.d.ts.map