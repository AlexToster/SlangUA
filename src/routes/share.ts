import { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { createHash, timingSafeEqual } from 'node:crypto';
import type { FastifyInstance } from 'fastify/types/instance';
import { previewCacheService } from '../services/preview-cache.service.js';
import { prisma } from '../lib/prisma.js';
import { getStyleMetadata } from '../style-engine/loader.js';
import { sharePayloadService } from '../services/share-payload.service.js';
import { userService } from '../services/user.service.js';
import { telegramInlineService, InlineQuery } from '../services/telegram-inline.service.js';
import { createRateLimiter } from '../plugins/rate-limit.js';
import { config } from '../config/index.js';
import { authenticate } from '../plugins/authenticate.js';

const sourceSchema = z.union([z.object({ previewId: z.string().uuid() }).strict(), z.object({ translationId: z.number().int().positive() }).strict()]);

function graphemes(text: string) { return Array.from(new Intl.Segmenter('uk', { granularity: 'grapheme' }).segment(text)).length; }

/**
 * Constant-time secret comparison. Hashing both sides first keeps the compared
 * buffers the same length, so the check leaks neither the secret's length nor a
 * byte-by-byte timing signal. An unset expected secret never matches.
 */
function secretMatches(provided: string, expected?: string): boolean {
  if (!expected) return false;
  const a = createHash('sha256').update(provided).digest();
  const b = createHash('sha256').update(expected).digest();
  return timingSafeEqual(a, b);
}

export const shareRoutes: FastifyPluginAsyncZod = async (app: FastifyInstance) => {
  const rateLimit = createRateLimiter({ windowMs: config.SHARE_RATE_LIMIT_WINDOW_MS, maxRequests: config.SHARE_RATE_LIMIT_MAX_REQUESTS, keyPrefix: config.SHARE_RATE_LIMIT_KEY_PREFIX });
  const webhookRateLimit = createRateLimiter({ windowMs: config.WEBHOOK_RATE_LIMIT_WINDOW_MS, maxRequests: config.WEBHOOK_RATE_LIMIT_MAX_REQUESTS, keyPrefix: config.WEBHOOK_RATE_LIMIT_KEY_PREFIX });
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
    // An age-restricted result may be shared only by a user who has confirmed
    // adulthood. `request.user` carries just { id, telegramId }, so the flag has
    // to be read from the profile - the server, not the UI, is the gate.
    if (metadata.ageRestricted) {
      const profile = await userService.getProfile(userId);
      if (!profile?.ageConfirmedAdult) {
        return reply.status(403).send({ error: 'Forbidden', code: 'AGE_RESTRICTED_SHARE', message: 'Age-restricted styles require age confirmation before sharing' });
      }
    }
    // The message is the translation and nothing else: a "SlangUA · <style>"
    // header used to be prepended here, and Telegram's share sheet turned it
    // into a link to the bot inside the user's own message.
    const rendered = translatedText;
    if (graphemes(rendered) > 3800) return reply.status(422).send({ error: 'Unprocessable Entity', code: 'SHARE_TEXT_TOO_LONG', message: 'Translation is too long to send inline' });
    const { token, expiresAt } = await sharePayloadService.create({ userId, telegramId: request.user.telegramId, translatedText, style: metadata.title });
    // `shareText` is the finished message, rendered here so the client never
    // composes what gets sent. The Mini App hands it to Telegram's own share
    // sheet (t.me/share/url); `inlineQuery` stays for the inline-mode path.
    return { inlineQuery: `s_${token}`, shareText: rendered, expiresAt: expiresAt.toISOString() };
  });

  // Telegram sends far more fields than we use; keep the schema permissive about
  // unknown keys but still reject a body that is not an object at all.
  const webhookBodySchema = z.object({
    update_id: z.number().int().optional(),
    inline_query: z.object({
      id: z.string(),
      query: z.string(),
      from: z.object({ id: z.number().int() }).passthrough(),
    }).passthrough().optional(),
  }).passthrough();

  app.post('/telegram/webhook', {
    schema: { body: webhookBodySchema },
    preHandler: [webhookRateLimit],
  }, async (request, reply) => {
    if (!config.TELEGRAM_INLINE_ENABLED) return reply.status(404).send();

    // Constant-time comparison: `!==` on a secret leaks its length and, in
    // principle, a byte-by-byte timing signal.
    const provided = request.headers['x-telegram-bot-api-secret-token'];
    if (typeof provided !== 'string' || !secretMatches(provided, config.TELEGRAM_WEBHOOK_SECRET)) {
      return reply.status(401).send();
    }

    const body = request.body as { inline_query?: InlineQuery };
    const inlineQuery = body?.inline_query;
    if (inlineQuery) {
      try {
        await telegramInlineService.handleInlineQuery(inlineQuery);
      } catch (err) {
        request.log.error({ err }, 'Telegram inline response failed');
      }
    }
    return reply.status(200).send({ ok: true });
  });
};
