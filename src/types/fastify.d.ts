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
  }
}
