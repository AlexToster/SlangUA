/**
 * Admin step-up authentication.
 *
 * The Telegram JWT proves *who* the caller is; it does not prove they meant to
 * open the admin panel. A stolen access token (or a Mini App left open on an
 * unlocked phone) would otherwise be enough. So the panel needs two independent
 * facts: the authenticated Telegram id is on the ADMIN_TELEGRAM_IDS allowlist,
 * and a password known only to the operator has been entered in this session.
 *
 * The session lives in Redis rather than in the process: the API is a single
 * container today, but a restart during a maintenance window must not be what
 * decides whether the operator stays logged in, and a second replica must not
 * see a different truth.
 *
 * What is deliberately *not* here:
 * - no admin flag in Postgres. Admin-ness is deployment configuration, not user
 *   data; a database row could be edited by anything that can write to the
 *   database, and a restore from backup could resurrect an old admin.
 * - no password in any log, response or error message.
 */

import { createHmac, randomBytes } from 'node:crypto';
import { getRedisClient } from '../../lib/redis.js';
import { config } from '../../config/index.js';
import { verifyPassword } from '../../lib/password.js';
import { derivePreviewKey } from '../../lib/preview-keys.js';
import { logger } from '../../lib/logger.js';

/** Redis key namespaces. Tokens never appear in a key: only their keyed hash. */
const SESSION_PREFIX = 'admin:session:';
const FAILURES_PREFIX = 'admin:failures:';
const LOCKOUT_PREFIX = 'admin:lockout:';

export interface AdminSession {
  /** Opaque bearer for `X-Admin-Token`. Returned once, never stored in clear. */
  token: string;
  /** Idle deadline, epoch ms. Slides forward on every admin request. */
  expiresAt: number;
  /** Hard deadline, epoch ms. Never slides. */
  absoluteExpiresAt: number;
}

export type AdminLoginResult =
  | { ok: true; session: AdminSession }
  | { ok: false; reason: 'invalid_password' }
  | { ok: false; reason: 'locked_out'; retryAfterMs: number };

interface StoredSession {
  uid: string;
  tid: string;
  iat: string;
}

export class AdminAuthService {
  private allowlist: Set<string> | null = null;

  /**
   * Parsed once and cached: `config` is immutable after boot, and this is on the
   * path of every admin request.
   */
  private get adminTelegramIds(): Set<string> {
    if (!this.allowlist) {
      this.allowlist = new Set(
        config.ADMIN_TELEGRAM_IDS.split(',')
          .map((entry) => entry.trim())
          .filter((entry) => entry.length > 0),
      );
    }
    return this.allowlist;
  }

  /**
   * True when the deployment has an admin panel at all. Both halves are
   * required: the schema already refuses to boot with an allowlist and no
   * password, and this keeps the check honest if that ever changes.
   */
  isConfigured(): boolean {
    return this.adminTelegramIds.size > 0 && config.ADMIN_PASSWORD_HASH.trim() !== '';
  }

  /** Allowlist membership. Telegram ids are compared as the strings the JWT carries. */
  isAdminTelegramId(telegramId: string | undefined): boolean {
    if (!telegramId) return false;
    return this.adminTelegramIds.has(telegramId);
  }

  /**
   * Whether this Telegram id should see the admin entry point at all. `/user/me`
   * reports it so the client knows whether to render the button; it is not an
   * authorization decision - every admin route re-checks both factors itself,
   * and a client that lies to itself gains nothing but a 404.
   */
  hasAdminAccess(telegramId: string | undefined): boolean {
    return this.isConfigured() && this.isAdminTelegramId(telegramId);
  }

  private sessionKey(token: string): string {
    const digest = createHmac('sha256', derivePreviewKey('admin-session')).update(token).digest('hex');
    return `${SESSION_PREFIX}${digest}`;
  }

  /**
   * Check the password and open a session.
   *
   * Callers must have established the allowlist first: this method assumes the
   * caller is an admin and only judges the password. Both failure reasons are
   * reported to the route as the same neutral 401 - "wrong password" and
   * "locked out" differ only in the Retry-After the client needs to back off.
   */
  async login(userId: number, telegramId: string, password: string): Promise<AdminLoginResult> {
    const redis = getRedisClient();
    const lockoutKey = `${LOCKOUT_PREFIX}${telegramId}`;
    const failuresKey = `${FAILURES_PREFIX}${telegramId}`;

    // A Redis failure here propagates: the route answers 503 rather than letting
    // an attempt through uncounted.
    const lockoutTtlMs = await redis.pttl(lockoutKey);
    if (lockoutTtlMs > 0) {
      logger.warn({ userId, telegramId, lockoutTtlMs }, 'Admin login refused: locked out');
      return { ok: false, reason: 'locked_out', retryAfterMs: lockoutTtlMs };
    }

    if (!(await verifyPassword(password, config.ADMIN_PASSWORD_HASH))) {
      const failures = await redis.incr(failuresKey);
      // The counting window is the lockout duration, so isolated typos months
      // apart never accumulate into a lockout.
      if (failures === 1) {
        await redis.pexpire(failuresKey, config.ADMIN_LOGIN_LOCKOUT_MS);
      }

      if (failures >= config.ADMIN_LOGIN_MAX_FAILURES) {
        await redis.set(lockoutKey, '1', 'PX', config.ADMIN_LOGIN_LOCKOUT_MS);
        await redis.del(failuresKey);
        logger.error(
          { userId, telegramId, failures, lockoutMs: config.ADMIN_LOGIN_LOCKOUT_MS },
          'Admin login locked out after repeated failures',
        );
        return { ok: false, reason: 'locked_out', retryAfterMs: config.ADMIN_LOGIN_LOCKOUT_MS };
      }

      logger.warn({ userId, telegramId, failures }, 'Admin login failed: wrong password');
      return { ok: false, reason: 'invalid_password' };
    }

    await redis.del(failuresKey);

    const token = randomBytes(32).toString('base64url');
    const now = Date.now();
    const absoluteExpiresAt = now + config.ADMIN_SESSION_ABSOLUTE_TTL_SECONDS * 1000;
    const idleExpiresAt = now + config.ADMIN_SESSION_TTL_SECONDS * 1000;
    const record: StoredSession = { uid: String(userId), tid: telegramId, iat: String(now) };

    await redis
      .multi()
      .hset(this.sessionKey(token), record)
      .pexpire(this.sessionKey(token), config.ADMIN_SESSION_TTL_SECONDS * 1000)
      .exec();

    logger.info({ userId, telegramId }, 'Admin session opened');
    return {
      ok: true,
      session: {
        token,
        expiresAt: Math.min(idleExpiresAt, absoluteExpiresAt),
        absoluteExpiresAt,
      },
    };
  }

  /**
   * Validate `X-Admin-Token` and slide the idle window.
   *
   * The session is bound to the user id it was opened for: an admin token pasted
   * into a request authenticated as somebody else is refused. That makes the two
   * factors genuinely independent - holding one is never enough.
   */
  async verifySession(token: string, userId: number): Promise<AdminSession | null> {
    if (!token || token.length < 16) {
      return null;
    }

    const redis = getRedisClient();
    const key = this.sessionKey(token);
    const stored = (await redis.hgetall(key)) as Partial<StoredSession>;

    if (!stored || !stored.uid || !stored.iat) {
      return null;
    }

    if (stored.uid !== String(userId)) {
      logger.warn(
        { userId, sessionUserId: stored.uid },
        'Admin token presented with a different user; refusing and revoking',
      );
      // Either a token leaked between accounts or a bug; in both cases the
      // session has no business staying open.
      await redis.del(key);
      return null;
    }

    // The allowlist is re-checked on every request, so removing an id from
    // ADMIN_TELEGRAM_IDS and restarting closes the door even mid-session.
    if (!this.isConfigured() || !this.isAdminTelegramId(stored.tid)) {
      await redis.del(key);
      return null;
    }

    const issuedAt = Number(stored.iat);
    const absoluteExpiresAt = issuedAt + config.ADMIN_SESSION_ABSOLUTE_TTL_SECONDS * 1000;
    const now = Date.now();
    const remainingAbsoluteMs = absoluteExpiresAt - now;

    if (!Number.isFinite(issuedAt) || remainingAbsoluteMs <= 0) {
      await redis.del(key);
      return null;
    }

    // Slide the idle window, but never past the absolute deadline - otherwise a
    // token kept warm by activity would live forever.
    const nextTtlMs = Math.min(config.ADMIN_SESSION_TTL_SECONDS * 1000, remainingAbsoluteMs);
    await redis.pexpire(key, nextTtlMs);

    return { token, expiresAt: now + nextTtlMs, absoluteExpiresAt };
  }

  /** Close a session. Idempotent: an unknown or already expired token is a no-op. */
  async revokeSession(token: string): Promise<void> {
    if (!token) return;
    await getRedisClient().del(this.sessionKey(token));
  }
}

export const adminAuthService = new AdminAuthService();
