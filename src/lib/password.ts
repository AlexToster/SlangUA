/**
 * Password hashing for the admin step-up check.
 *
 * scrypt from `node:crypto` rather than bcrypt or argon2 on purpose: both of
 * those are native modules, and this repository already pays for the
 * Windows/Linux `node_modules` split (vitest, oxlint and the Prisma engines all
 * refuse to run in the Linux sandbox because the bindings were installed on
 * Windows). A memory-hard KDF that ships with Node has no bindings to get wrong.
 *
 * The stored format is self-describing, so the cost parameters can be raised
 * later without invalidating an existing hash:
 *
 *   scrypt$N=16384,r=8,p=1$<salt base64>$<derived key base64>
 *
 * Only `verifyPassword` runs in the server. Hashes are produced out of band by
 * `scripts/hash-admin-password.mjs`, which keeps the generator (and the plaintext
 * it reads) out of the request path entirely.
 */

import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';

export interface ScryptParams {
  N: number;
  r: number;
  p: number;
}

/**
 * ~16 MiB and roughly 50-100 ms per verification on current hardware. Only the
 * admin login endpoint calls this, at most a handful of times per day, so cost
 * is the point.
 */
export const DEFAULT_SCRYPT_PARAMS: ScryptParams = { N: 16384, r: 8, p: 1 };

const KEY_LENGTH_BYTES = 32;
const SALT_LENGTH_BYTES = 16;

/**
 * Shape of a stored hash. Exported so the environment schema can reject a
 * malformed `ADMIN_PASSWORD_HASH` at boot instead of at the first login attempt.
 */
export const SCRYPT_HASH_PATTERN =
  /^scrypt\$N=(\d+),r=(\d+),p=(\d+)\$([A-Za-z0-9+/]+={0,2})\$([A-Za-z0-9+/]+={0,2})$/;

interface ParsedHash {
  params: ScryptParams;
  salt: Buffer;
  key: Buffer;
}

/**
 * scrypt needs 128 * N * r bytes and Node caps allocation at 32 MiB by default,
 * which N=32768 would already exceed. Deriving the limit from the parameters
 * means raising them later cannot turn into a runtime ERR_CRYPTO_INVALID_SCRYPT_PARAMS.
 */
function maxmemFor(params: ScryptParams): number {
  return 256 * params.N * params.r;
}

function parseHash(stored: string): ParsedHash | null {
  const match = SCRYPT_HASH_PATTERN.exec(stored.trim());
  if (!match) {
    return null;
  }

  const params: ScryptParams = {
    N: Number(match[1]),
    r: Number(match[2]),
    p: Number(match[3]),
  };

  // N must be a power of two greater than 1; r and p must be positive. scrypt
  // itself would throw on violation, and a throw here would be indistinguishable
  // from a wrong password.
  const powerOfTwo = params.N > 1 && (params.N & (params.N - 1)) === 0;
  if (!powerOfTwo || params.r < 1 || params.p < 1) {
    return null;
  }

  const salt = Buffer.from(match[4], 'base64');
  const key = Buffer.from(match[5], 'base64');
  if (salt.length < 8 || key.length < 16) {
    return null;
  }

  return { params, salt, key };
}

/** True when the string is a structurally valid stored hash. */
export function isScryptHash(value: string): boolean {
  return parseHash(value) !== null;
}

function derive(password: string, salt: Buffer, keyLength: number, params: ScryptParams): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(
      password,
      salt,
      keyLength,
      { N: params.N, r: params.r, p: params.p, maxmem: maxmemFor(params) },
      (err, derivedKey) => (err ? reject(err) : resolve(derivedKey)),
    );
  });
}

/** Produce a stored hash for a plaintext password. Used by the CLI generator. */
export async function hashPassword(
  password: string,
  params: ScryptParams = DEFAULT_SCRYPT_PARAMS,
): Promise<string> {
  const salt = randomBytes(SALT_LENGTH_BYTES);
  const key = await derive(password, salt, KEY_LENGTH_BYTES, params);
  return `scrypt$N=${params.N},r=${params.r},p=${params.p}$${salt.toString('base64')}$${key.toString('base64')}`;
}

/**
 * Constant-time verification. Returns false for a malformed stored hash instead
 * of throwing: a login endpoint must answer the same way whatever went wrong,
 * and the boot-time schema check is what surfaces a broken configuration.
 */
export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parsed = parseHash(stored);
  if (!parsed) {
    return false;
  }

  try {
    const candidate = await derive(password, parsed.salt, parsed.key.length, parsed.params);
    return candidate.length === parsed.key.length && timingSafeEqual(candidate, parsed.key);
  } catch {
    return false;
  }
}
