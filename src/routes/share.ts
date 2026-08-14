import { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import type { FastifyInstance } from 'fastify/types/instance';
import { authService } from '../services/auth.service.js';
import { previewCacheService } from '../services/preview-cache.service.js';
import { prisma } from '../lib/prisma.js';
import { getStyleMetadata } from '../style-engine/loader.js';
import { sharePayloadService } from '../services/share-payload.service.js';
import { telegramInlineService } from '../services/telegram-inline.service.js';
import { createRateLimiter } from '../plugins/rate-limit.js';
import { config } from '../config/index.js';

const sourceSchema = z.union([z.object({ previewId: z.string().uuid() }).strict(), z.object({ translationId: z.number().int().positive() }).strict()]);

function graphemes(text: string) { return Array.from(new Intl.Segmenter('uk', { granularity: 'grapheme' }).segment(text)).length; }

export const shareRoutes: FastifyPluginAsyncZod = async (app: FastifyInstance) => {
  const rateLimit = createRateLimiter({ windowMs: config.SHARE_RATE_LIMIT_WINDOW_MS, maxRequests: config.SHARE_RATE_LIMIT_MAX_REQUESTS, keyPrefix: config.SHARE_RATE_LIMIT_KEY_PREFIX });
  const webhookRateLimit = createRateLimiter({ windowMs: config.WEBHOOK_RATE_LIMIT_WINDOW_MS, maxRequests: config.WEBHOOK_RATE_LIMIT_MAX_REQUESTS, keyPrefix: config.WEBHOOK_RATE_LIMIT_KEY_PREFIX });
  const authenticate = async (request: any, reply: any) => {
    const token = request.headers.authorization?.startsWith('Bearer ') ? request.headers.authorization.slice(7) : null;
    const payload = token && await authService.verifyAccessToken(token);
    if (!payload) return reply.status(401).send({ error: 'Unauthorized', code: token ? 'INVALID_TOKEN' : 'MISSING_TOKEN', message: 'Authorization header with Bearer token required' });
    request.user = { id: payload.userId, telegramId: String(payload.telegramId) };
  };

  app.post('/share/inline', { schema: { body: sourceSchema }, preHandler: [authenticate, rateLimit] }, async (request: any, reply) => {
    if (!config.TELEGRAM_INLINE_ENABLED) return reply.status(503).send({ error: 'Service Unavailable', code: 'TELEGRAM_INLINE_UNAVAILABLE', message: 'Telegram inline sharing is not configured' });
    const source = request.body as z.infer<typeof sourceSchema>;
    const userId = request.user.id as number;
    let translatedText: string; let style: string;
    if ('previewId' in source) {
      const preview = await previewCacheService.getPreview(source.previewId, userId);
      if (!preview) return reply.status(404).send({ error: 'Not Found', code: 'SHARE_SOURCE_NOT_FOUND', message: 'Preview not found or expired' });
      translatedText = preview.translatedText; style = preview.style;
    } else {
      const translation = await prisma.translation.findFirst({ where: { id: source.translationId, userId } });
      if (!translation) return reply.status(404).send({ error: 'Not Found', code: 'SHARE_SOURCE_NOT_FOUND', message: 'Translation not found' });
      translatedText = translation.translatedText; style = translation.slangStyle;
    }
    const metadata = await getStyleMetadata(style);
    if (metadata.ageRestricted) return reply.status(403).send({ error: 'Forbidden', code: 'AGE_RESTRICTED_SHARE', message: 'Age-restricted styles cannot be shared' });
    const rendered = `SlangUA · ${metadata.title}\n\n${translatedText}`;
    if (graphemes(rendered) > 3800) return reply.status(422).send({ error: 'Unprocessable Entity', code: 'SHARE_TEXT_TOO_LONG', message: 'Translation is too long to send inline' });
    const { token, expiresAt } = await sharePayloadService.create({ userId, telegramId: request.user.telegramId, translatedText, style: metadata.title });
    return { inlineQuery: `s_${token}`, expiresAt: expiresAt.toISOString() };
  });

  app.post('/telegram/webhook', { preHandler: [webhookRateLimit] }, async (request: any, reply) => {
    if (!config.TELEGRAM_INLINE_ENABLED) return reply.status(404).send();
    if (request.headers['x-telegram-bot-api-secret-token'] !== config.TELEGRAM_WEBHOOK_SECRET) return reply.status(401).send();
    const inlineQuery = request.body?.inline_query;
    if (inlineQuery) {
      try { await telegramInlineService.handleInlineQuery(inlineQuery); } catch (err) { request.log.error({ err }, 'Telegram inline response failed'); }
    }
    return reply.status(200).send({ ok: true });
  });
};
