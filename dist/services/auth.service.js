"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.authService = exports.AuthService = void 0;
const crypto_1 = require("crypto");
const jose_1 = require("jose");
const index_js_1 = require("../config/index.js");
const prisma_js_1 = require("../lib/prisma.js");
class AuthService {
    prisma;
    jwtSecret;
    refreshTokenHmacSecret;
    accessTokenTtl;
    refreshTokenTtl;
    authDateTtl;
    telegramBotToken;
    constructor() {
        this.prisma = prisma_js_1.prisma;
        this.jwtSecret = new TextEncoder().encode(index_js_1.config.JWT_SECRET);
        this.refreshTokenHmacSecret = new TextEncoder().encode(index_js_1.config.REFRESH_TOKEN_HMAC_SECRET);
        this.accessTokenTtl = index_js_1.config.JWT_ACCESS_TTL;
        this.refreshTokenTtl = index_js_1.config.JWT_REFRESH_TTL;
        this.authDateTtl = index_js_1.config.AUTH_DATE_TTL;
        this.telegramBotToken = index_js_1.config.TELEGRAM_BOT_TOKEN;
    }
    /**
     * Parse Telegram initData string into an object
     */
    parseInitData(initData) {
        const params = new URLSearchParams(initData);
        const result = {};
        for (const [key, value] of params.entries()) {
            result[key] = value;
        }
        const hash = result.hash;
        delete result.hash;
        return {
            query_id: result.query_id,
            user: result.user ? JSON.parse(result.user) : undefined,
            receiver: result.receiver ? JSON.parse(result.receiver) : undefined,
            chat: result.chat ? JSON.parse(result.chat) : undefined,
            chat_type: result.chat_type,
            chat_instance: result.chat_instance,
            start_param: result.start_param,
            can_send_after: result.can_send_after ? parseInt(result.can_send_after, 10) : undefined,
            auth_date: parseInt(result.auth_date, 10),
            hash,
        };
    }
    /**
     * Verify Telegram initData HMAC-SHA256 signature
     * Per Telegram docs: secret_key = HMAC-SHA256(bot_token, "WebAppData")
     * Then data_check_string = sorted key=value pairs joined by \n (excluding hash)
     * hash = HMAC-SHA256(secret_key, data_check_string)
     */
    verifyTelegramInitData(initData) {
        try {
            const parsed = this.parseInitData(initData);
            // Reconstruct data_check_string (sorted key=value pairs, excluding hash)
            const params = new URLSearchParams(initData);
            const dataCheckStringParts = [];
            for (const [key, value] of params.entries()) {
                if (key !== 'hash') {
                    dataCheckStringParts.push(`${key}=${value}`);
                }
            }
            dataCheckStringParts.sort();
            const dataCheckString = dataCheckStringParts.join('\n');
            // Compute secret key: HMAC-SHA256(bot_token, "WebAppData")
            const secretKey = (0, crypto_1.createHmac)('sha256', 'WebAppData').update(this.telegramBotToken).digest();
            // Compute expected hash: HMAC-SHA256(secret_key, data_check_string)
            const expectedHash = (0, crypto_1.createHmac)('sha256', secretKey).update(dataCheckString).digest('hex');
            // Timing-safe comparison
            const providedHashBuffer = Buffer.from(parsed.hash, 'hex');
            const expectedHashBuffer = Buffer.from(expectedHash, 'hex');
            if (providedHashBuffer.length !== expectedHashBuffer.length ||
                !(0, crypto_1.timingSafeEqual)(providedHashBuffer, expectedHashBuffer)) {
                return { valid: false, error: 'Invalid HMAC signature' };
            }
            // Validate auth_date TTL
            const now = Math.floor(Date.now() / 1000);
            const authDate = parsed.auth_date;
            if (now - authDate > this.authDateTtl) {
                return { valid: false, error: 'Expired auth_date' };
            }
            return { valid: true, data: parsed };
        }
        catch (error) {
            return { valid: false, error: 'Invalid initData format' };
        }
    }
    /**
     * Generate a random refresh token (opaque string)
     */
    generateRefreshToken() {
        return (0, crypto_1.randomBytes)(32).toString('base64url');
    }
    /**
     * Hash refresh token using HMAC-SHA256 with server-side secret
     * This allows equality lookup in the database
     */
    hashRefreshToken(token) {
        return (0, crypto_1.createHmac)('sha256', this.refreshTokenHmacSecret).update(token).digest('hex');
    }
    /**
     * Generate JWT access token with jti claim referencing the refresh token
     */
    async generateAccessToken(userId, telegramId, refreshTokenId) {
        const jti = `rt_${refreshTokenId}`;
        const token = await new jose_1.SignJWT({
            userId,
            telegramId,
            jti
        })
            .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
            .setIssuedAt()
            .setExpirationTime(this.accessTokenTtl)
            .setJti(jti)
            .sign(this.jwtSecret);
        return token;
    }
    /**
     * Verify JWT access token and return payload
     */
    async verifyAccessToken(token) {
        try {
            const { payload } = await (0, jose_1.jwtVerify)(token, this.jwtSecret);
            return payload;
        }
        catch {
            return null;
        }
    }
    /**
     * Upsert user by telegramId
     */
    async upsertUser(telegramUser) {
        return this.prisma.user.upsert({
            where: { telegramId: String(telegramUser.id) },
            update: {
                username: telegramUser.username ?? null,
                firstName: telegramUser.first_name ?? null,
                lastName: telegramUser.last_name ?? null,
                languageCode: telegramUser.language_code ?? null,
            },
            create: {
                telegramId: String(telegramUser.id),
                username: telegramUser.username ?? null,
                firstName: telegramUser.first_name ?? null,
                lastName: telegramUser.last_name ?? null,
                languageCode: telegramUser.language_code ?? null,
            },
        });
    }
    /**
     * Create refresh token record in database
     */
    async createRefreshToken(userId, token, deviceInfo) {
        const hashedToken = this.hashRefreshToken(token);
        const expiresAt = new Date(Date.now() + this.parseTtlToMs(this.refreshTokenTtl));
        return this.prisma.refreshToken.create({
            data: {
                userId,
                hashedToken,
                expiresAt,
                deviceInfo: deviceInfo,
            },
        });
    }
    /**
     * Find refresh token by hashed token
     */
    async findRefreshToken(hashedToken) {
        return this.prisma.refreshToken.findUnique({
            where: { hashedToken },
            include: { user: true },
        });
    }
    /**
     * Invalidate (delete) a refresh token
     */
    async invalidateRefreshToken(hashedToken) {
        await this.prisma.refreshToken.delete({
            where: { hashedToken },
        }).catch(() => {
            // Ignore if not found (already invalidated)
        });
    }
    /**
     * Invalidate refresh token by ID (jti)
     */
    async invalidateRefreshTokenById(id) {
        await this.prisma.refreshToken.delete({
            where: { id },
        }).catch(() => {
            // Ignore if not found
        });
    }
    /**
     * Authenticate via Telegram initData
     * Returns access token and refresh token
     */
    async authenticateWithTelegram(initData, deviceInfo) {
        // Verify initData
        const verification = this.verifyTelegramInitData(initData);
        if (!verification.valid || !verification.data) {
            throw new Error(verification.error || 'Telegram authentication failed');
        }
        const { user: telegramUser } = verification.data;
        if (!telegramUser) {
            throw new Error('No user data in initData');
        }
        // Upsert user
        const user = await this.upsertUser(telegramUser);
        // Generate refresh token
        const refreshToken = this.generateRefreshToken();
        const refreshTokenRecord = await this.createRefreshToken(user.id, refreshToken, deviceInfo);
        // Generate access token with jti referencing refresh token
        const accessToken = await this.generateAccessToken(user.id, user.telegramId, refreshTokenRecord.id);
        return { accessToken, refreshToken };
    }
    /**
     * Refresh access token using refresh token
     * Rotates refresh token (invalidates old, creates new)
     */
    async refreshTokens(refreshToken) {
        const hashedToken = this.hashRefreshToken(refreshToken);
        // Find refresh token record
        const tokenRecord = await this.findRefreshToken(hashedToken);
        if (!tokenRecord) {
            throw new Error('Invalid refresh token');
        }
        // Check expiration
        if (tokenRecord.expiresAt < new Date()) {
            // Clean up expired token
            await this.invalidateRefreshToken(hashedToken);
            throw new Error('Refresh token expired');
        }
        // Invalidate old refresh token
        await this.invalidateRefreshToken(hashedToken);
        // Create new refresh token
        const newRefreshToken = this.generateRefreshToken();
        const newTokenRecord = await this.createRefreshToken(tokenRecord.userId, newRefreshToken, tokenRecord.deviceInfo);
        // Generate new access token
        const accessToken = await this.generateAccessToken(tokenRecord.userId, tokenRecord.user.telegramId, newTokenRecord.id);
        return { accessToken, refreshToken: newRefreshToken };
    }
    /**
     * Logout - invalidate refresh token referenced by access token's jti
     */
    async logout(accessToken) {
        const payload = await this.verifyAccessToken(accessToken);
        if (!payload || !payload.jti) {
            throw new Error('Invalid access token');
        }
        // Extract refresh token ID from jti (format: rt_<id>)
        const jtiParts = payload.jti.split('_');
        if (jtiParts.length !== 2 || jtiParts[0] !== 'rt') {
            throw new Error('Invalid token format');
        }
        const refreshTokenId = parseInt(jtiParts[1], 10);
        if (isNaN(refreshTokenId)) {
            throw new Error('Invalid token format');
        }
        // Invalidate only this specific refresh token
        await this.invalidateRefreshTokenById(refreshTokenId);
    }
    /**
     * Parse TTL string (e.g., "15m", "7d") to milliseconds
     */
    parseTtlToMs(ttl) {
        const match = ttl.match(/^(\d+)([smhd])$/);
        if (!match) {
            return 7 * 24 * 60 * 60 * 1000; // Default 7 days
        }
        const value = parseInt(match[1], 10);
        const unit = match[2];
        switch (unit) {
            case 's': return value * 1000;
            case 'm': return value * 60 * 1000;
            case 'h': return value * 60 * 60 * 1000;
            case 'd': return value * 24 * 60 * 60 * 1000;
            default: return 7 * 24 * 60 * 60 * 1000;
        }
    }
}
exports.AuthService = AuthService;
// Export singleton instance
exports.authService = new AuthService();
//# sourceMappingURL=auth.service.js.map