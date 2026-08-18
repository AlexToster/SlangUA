import { hkdfSync } from 'node:crypto';
import { config } from '../config/index.js';

// 'admin-session' is not a preview concern, but it needs exactly what this
// helper provides: an independent 256-bit key derived from the deployment root
// key, with no second secret to configure and rotate. It keys the HMAC that
// turns an admin session token into its Redis key, so a Redis dump yields no
// usable tokens.
type PreviewKeyPurpose =
  | 'preview-encryption'
  | 'preview-deduplication'
  | 'share-encryption'
  | 'admin-session';

/**
 * Derive independent 256-bit keys from the deployment root key. Purpose labels
 * are part of the HKDF info parameter, so a key cannot be reused across roles.
 */
export function derivePreviewKey(purpose: PreviewKeyPurpose): Buffer {
  return Buffer.from(hkdfSync(
    'sha256',
    Buffer.from(config.PREVIEW_ROOT_KEY, 'base64'),
    Buffer.alloc(0),
    Buffer.from(`slangua:${purpose}:${config.PREVIEW_KEY_VERSION}`, 'utf8'),
    32,
  ));
}
