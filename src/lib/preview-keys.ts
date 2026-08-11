import { hkdfSync } from 'node:crypto';
import { config } from '../config/index.js';

type PreviewKeyPurpose = 'preview-encryption' | 'preview-deduplication' | 'share-encryption';

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
