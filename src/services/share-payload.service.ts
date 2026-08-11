import { createCipheriv, createDecipheriv, randomBytes, randomUUID } from 'crypto';
import { config } from '../config/index.js';
import { getRedisClient } from '../lib/redis.js';
import { derivePreviewKey } from '../lib/preview-keys.js';

export interface SharePayload {
  userId: number;
  telegramId: string;
  translatedText: string;
  style: string;
  expiresAt: number;
}

export class SharePayloadService {
  private readonly redis = getRedisClient();
  private readonly key = derivePreviewKey('share-encryption');

  private dataKey(token: string) { return `share:data:${token}`; }

  async create(payload: Omit<SharePayload, 'expiresAt'>): Promise<{ token: string; expiresAt: Date }> {
    const token = randomUUID();
    const expiresAt = new Date(Date.now() + config.SHARE_CACHE_TTL_SECONDS * 1000);
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.key, iv);
    const encrypted = Buffer.concat([cipher.update(JSON.stringify({ ...payload, expiresAt: expiresAt.getTime() }), 'utf8'), cipher.final()]);
    await this.redis.setex(this.dataKey(token), config.SHARE_CACHE_TTL_SECONDS, JSON.stringify({ encrypted: encrypted.toString('base64'), iv: iv.toString('base64'), authTag: cipher.getAuthTag().toString('base64'), keyVersion: config.PREVIEW_KEY_VERSION }));
    return { token, expiresAt };
  }

  async get(token: string, telegramId: string): Promise<SharePayload | null> {
    const stored = await this.redis.get(this.dataKey(token));
    if (!stored) return null;
    try {
      const { encrypted, iv, authTag, keyVersion } = JSON.parse(stored);
      if (keyVersion !== config.PREVIEW_KEY_VERSION) {
        await this.redis.del(this.dataKey(token));
        return null;
      }
      const decipher = createDecipheriv('aes-256-gcm', this.key, Buffer.from(iv, 'base64'));
      decipher.setAuthTag(Buffer.from(authTag, 'base64'));
      const payload = JSON.parse(Buffer.concat([decipher.update(Buffer.from(encrypted, 'base64')), decipher.final()]).toString('utf8')) as SharePayload;
      if (payload.telegramId !== telegramId || Date.now() > payload.expiresAt) return null;
      return payload;
    } catch {
      await this.redis.del(this.dataKey(token));
      return null;
    }
  }
}

export const sharePayloadService = new SharePayloadService();
