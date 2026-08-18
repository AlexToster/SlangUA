// The bare import is load-bearing: without a top-level import/export this file
// is a global script, and `declare module 'fastify'` would declare a new ambient
// module instead of augmenting the real one - so `request.user` would not exist.
import 'fastify';

declare module 'fastify' {
  interface FastifyRequest {
    /**
     * Set by the `authenticate` preHandler in src/plugins/authenticate.ts.
     * Only `id` and `telegramId` are guaranteed - they are what the access
     * token carries. Everything else is optional profile data that a handler
     * may attach after loading it.
     */
    user?: {
      id: number;
      telegramId: string;
      username?: string | null;
      firstName?: string | null;
      lastName?: string | null;
      languageCode?: string | null;
      defaultSlangStyle?: string | null;
      notificationsEnabled?: boolean;
      createdAt?: Date;
    };

    /**
     * Set by `requireAdminSession` in src/plugins/require-admin.ts after the
     * `X-Admin-Token` step-up check. Present only on admin routes; its absence
     * means the request never passed that gate.
     */
    adminSession?: {
      token: string;
      expiresAt: number;
      absoluteExpiresAt: number;
    };

    /**
     * Set by the global error handler in src/app.ts, read by the `onResponse`
     * hook in src/plugins/observability.ts.
     *
     * The hook runs after the reply is sent and has no access to the error that
     * produced it, so the handler leaves behind the two fields the admin error
     * feed is allowed to store. Deliberately not the error object: keeping a
     * reference would invite a later change to log a stack, a request body or a
     * translation into Redis.
     */
    errorSnapshot?: {
      code: string | null;
      message: string | null;
    };
  }
}
