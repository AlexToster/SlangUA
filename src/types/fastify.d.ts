import type { FastifyReply } from 'fastify/types/reply';

declare module 'fastify' {
  interface FastifyRequest {
    user?: {
      id: number;
      telegramId: string;
      username?: string | null;
      firstName?: string | null;
      lastName?: string | null;
      languageCode?: string | null;
      defaultSlangStyle?: string | null;
      notificationsEnabled: boolean;
      createdAt: Date;
    };
  }

  interface FastifyInstance {
    rateLimit: (options?: import('./plugins/rate-limit').RateLimitOptions) => (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
    defaultRateLimit: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
  }
}
