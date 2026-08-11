import { getRedisClient } from '../lib/redis.js';
import { config } from '../config/index.js';
import { createHmac, createCipheriv, createDecipheriv, randomBytes, randomUUID } from 'crypto';
import { derivePreviewKey } from '../lib/preview-keys.js';

export interface PreviewData {
  originalText: string;
  translatedText: string;
  style: string;
  styleVersion: string;
  aiProvider: string;
  userId: number;
  createdAt: number;
  expiresAt: number;
}

export interface PreviewCacheEntry {
  previewId: string;
  data: PreviewData;
}

/**
 * Service for managing preview cache with encryption and HMAC-based deduplication
 * 
 * Security considerations:
 * - Preview data (containing text) is encrypted at application level before storing in Redis
 * - HMAC cache key uses userId + normalized text + style + styleVersion (no text in Redis key)
 * - TTL: 10 minutes (600 seconds)
 * - Data is deleted after successful save, except for short idempotency marker
 * - No logging of text content
 */
export class PreviewCacheService {
  private redis = getRedisClient();
  private readonly encryptionKey: Buffer;
  private readonly algorithm = 'aes-256-gcm';
  private readonly ivLength = 12; // 96 bits for GCM

  constructor() {
    this.encryptionKey = derivePreviewKey('preview-encryption');
  }

  /**
   * Normalize text for HMAC cache key: trim, collapse whitespace
   */
  private normalizeText(text: string): string {
    return text.trim().replace(/\s+/g, ' ');
  }

  /**
   * Generate HMAC cache key for deduplication
   * Key format: preview:hmac:{hmacHex}
   * HMAC input: userId:normalizedText:style:styleVersion
   * NO text stored in Redis key
   */
  private generateHmacCacheKey(userId: number, text: string, style: string, styleVersion: string): string {
    const normalizedText = this.normalizeText(text);
    const hmacInput = `${userId}:${normalizedText}:${style}:${styleVersion}`;
    const hmac = createHmac('sha256', derivePreviewKey('preview-deduplication'))
      .update(hmacInput)
      .digest('hex');
    return `preview:hmac:${hmac}`;
  }

  /**
   * Generate preview storage key
   * Key format: preview:data:{previewId}
   */
  private generateDataKey(previewId: string): string {
    return `preview:data:${previewId}`;
  }

  /**
   * Generate idempotency marker key (persists after save)
   * Key format: preview:idempotency:{previewId}
   */
  private generateIdempotencyKey(previewId: string): string {
    return `preview:idempotency:${previewId}`;
  }

  /**
   * Encrypt preview data for storage
   */
  private encrypt(data: PreviewData): { encrypted: string; iv: string; authTag: string; keyVersion: string } {
    const iv = randomBytes(this.ivLength);
    const cipher = createCipheriv(this.algorithm, this.encryptionKey, iv);
    
    const jsonData = JSON.stringify(data);
    const encrypted = Buffer.concat([
      cipher.update(jsonData, 'utf8'),
      cipher.final()
    ]);
    
    const authTag = cipher.getAuthTag();
    
    return {
      encrypted: encrypted.toString('base64'),
      iv: iv.toString('base64'),
      authTag: authTag.toString('base64'),
      keyVersion: config.PREVIEW_KEY_VERSION,
    };
  }

  /**
   * Decrypt preview data from storage
   */
  private decrypt(encrypted: string, iv: string, authTag: string): PreviewData {
    const decipher = createDecipheriv(
      this.algorithm,
      this.encryptionKey,
      Buffer.from(iv, 'base64')
    );
    decipher.setAuthTag(Buffer.from(authTag, 'base64'));
    
    const decrypted = Buffer.concat([
      decipher.update(Buffer.from(encrypted, 'base64')),
      decipher.final()
    ]);
    
    return JSON.parse(decrypted.toString('utf8'));
  }

  /**
   * Store preview result with encryption
   * Returns previewId for client to use in save
   */
  async storePreview(data: PreviewData): Promise<string> {
    const previewId = randomUUID();
    const dataKey = this.generateDataKey(previewId);
    const hmacKey = this.generateHmacCacheKey(data.userId, data.originalText, data.style, data.styleVersion);
    const ttlSeconds = config.PREVIEW_CACHE_TTL_SECONDS;

    const encryptedData = this.encrypt(data);

    // Store encrypted data
    await this.redis.setex(
      dataKey,
      ttlSeconds,
      JSON.stringify(encryptedData)
    );

    // Store HMAC cache key pointing to previewId (for deduplication)
    // This allows checking if identical request already has a preview
    await this.redis.setex(hmacKey, ttlSeconds, previewId);

    return previewId;
  }

  /**
   * Get preview by previewId, verifying ownership and TTL
   * Returns null if not found, expired, or ownership mismatch
   */
  async getPreview(previewId: string, userId: number): Promise<PreviewData | null> {
    const dataKey = this.generateDataKey(previewId);
    
    const stored = await this.redis.get(dataKey);
    if (!stored) {
      return null;
    }

    try {
      const { encrypted, iv, authTag, keyVersion } = JSON.parse(stored);
      // Existing records from an older deployment are intentionally treated as
      // expired. They have a short TTL and cannot be safely decrypted by a new key.
      if (keyVersion !== config.PREVIEW_KEY_VERSION) {
        await this.redis.del(dataKey);
        return null;
      }
      const data = this.decrypt(encrypted, iv, authTag);

      // Verify ownership
      if (data.userId !== userId) {
        return null;
      }

      // Verify not expired (double-check, Redis TTL should handle this)
      if (Date.now() > data.expiresAt) {
        await this.redis.del(dataKey);
        return null;
      }

      return data;
    } catch {
      // Decryption failed - data corrupted or tampered
      await this.redis.del(dataKey);
      return null;
    }
  }

  /**
   * Check if identical preview already exists (cache hit)
   * Returns existing previewId if found, null otherwise
   */
  async checkCacheHit(userId: number, text: string, style: string, styleVersion: string): Promise<string | null> {
    const hmacKey = this.generateHmacCacheKey(userId, text, style, styleVersion);
    const previewId = await this.redis.get(hmacKey);
    return previewId || null;
  }

  /**
   * Delete preview after successful save
   * Keeps idempotency marker for a short period
   */
  async deletePreview(previewId: string, data: PreviewData): Promise<void> {
    const dataKey = this.generateDataKey(previewId);
    const idempotencyKey = this.generateIdempotencyKey(previewId);
    const hmacKey = this.generateHmacCacheKey(data.userId, data.originalText, data.style, data.styleVersion);

    // Delete the HMAC pointer only if it still points at this preview. A newer
    // identical preview may have replaced it while the save was in progress.
    await this.redis.eval(
      "redis.call('DEL', KEYS[1]); if redis.call('GET', KEYS[2]) == ARGV[1] then return redis.call('DEL', KEYS[2]) end; return 0",
      2,
      dataKey,
      hmacKey,
      previewId,
    );

    // Set idempotency marker (short TTL, e.g., 1 hour) to prevent duplicate saves
    await this.redis.setex(idempotencyKey, 3600, 'saved');
  }

  /**
   * Check if save was already processed (idempotency check)
   */
  async checkIdempotency(previewId: string): Promise<boolean> {
    const idempotencyKey = this.generateIdempotencyKey(previewId);
    const exists = await this.redis.exists(idempotencyKey);
    return exists === 1;
  }

  /**
   * Get TTL remaining for a preview (for debugging/monitoring)
   */
  async getPreviewTtl(previewId: string): Promise<number> {
    const dataKey = this.generateDataKey(previewId);
    return await this.redis.ttl(dataKey);
  }
}

// Export singleton instance
export const previewCacheService = new PreviewCacheService();
