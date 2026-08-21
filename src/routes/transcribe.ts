/**
 * Voice input: audio in, text out.
 *
 * The audio arrives base64-encoded inside JSON rather than as multipart, because
 * `@fastify/multipart` is not a dependency and a 30-second Opus capture fits
 * comfortably inside a JSON body. The route sets its own `bodyLimit` derived
 * from STT_MAX_AUDIO_BYTES so an over-long capture is a deliberate 413 instead
 * of the app-wide default deciding it.
 *
 * Two things this endpoint must never become:
 * - an open STT proxy: `authenticate` is mandatory, and it has its own rate
 *   limiter because every call spends upstream quota shared by all users;
 * - a place audio lingers: the buffer lives inside this handler and is never
 *   written to Postgres, Redis, a temp file or a log line. The transcript is
 *   returned and not stored either - it becomes a translation only if the user
 *   then submits it.
 *
 * The age gate deliberately does not apply: transcription is not a style, and
 * the gate belongs to the styles that produce restricted output.
 */

import { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import type { FastifyInstance } from 'fastify/types/instance';
import { createRateLimiter } from '../plugins/rate-limit.js';
import { config } from '../config/index.js';
import { authenticate } from '../plugins/authenticate.js';
import { captureErrorSnapshot } from '../plugins/observability.js';
import { sttService, normalizeAudioMimeType } from '../services/stt/stt.service.js';
import { isAllKeysExhaustedError } from '../services/ai/errors.js';

/**
 * Room for the base64 expansion (4 bytes out per 3 in) plus the JSON envelope
 * and the mimeType field. Anything above this is refused by Fastify before the
 * body is buffered, which is the point: the byte check further down only ever
 * sees payloads that were worth decoding.
 */
const BODY_LIMIT_BYTES = Math.ceil(config.STT_MAX_AUDIO_BYTES / 3) * 4 + 1024;

const errorBody = z.object({
  error: z.string(),
  code: z.string(),
  message: z.string(),
});

export const transcribeRoutes: FastifyPluginAsyncZod = async (app: FastifyInstance) => {
  const transcribeRateLimiter = createRateLimiter({
    windowMs: config.STT_RATE_LIMIT_WINDOW_MS,
    maxRequests: config.STT_RATE_LIMIT_MAX_REQUESTS,
    keyPrefix: config.STT_RATE_LIMIT_KEY_PREFIX,
  });

  app.post('/transcribe', {
    bodyLimit: BODY_LIMIT_BYTES,
    schema: {
      body: z.object({
        /** Base64 of the recorded container, without a data: URL prefix. */
        audio: z.string().min(1).base64(),
        /**
         * The recorder's own `mimeType`, codec parameters included. It is the
         * only reliable format signal: Android Chromium reports
         * `audio/webm;codecs=opus`, iOS WKWebView `audio/mp4`.
         */
        mimeType: z.string().min(1).max(120),
      }).strict(),
      response: {
        200: z.object({
          text: z.string(),
          model: z.string(),
        }),
        400: errorBody,
        401: errorBody,
        413: errorBody,
        415: errorBody,
        422: errorBody,
        // `retryAfter` is in seconds. On a free tier an exhausted minute is a
        // normal state, so the client needs a number to show rather than a
        // generic failure.
        429: errorBody.extend({ retryAfter: z.number().optional() }),
        503: errorBody,
      },
    },
    preHandler: [authenticate, transcribeRateLimiter],
  }, async (request, reply) => {
    // A deployment without STT_API_KEY has the feature switched off. Named
    // rather than left as a bare 5xx, and reported to the error feed only if a
    // client reaches it - the client is told at login that voice input is
    // unavailable, so arriving here means something is out of step.
    if (!sttService.isAvailable()) {
      return reply.status(503).send({
        error: 'Service Unavailable',
        code: 'STT_UNAVAILABLE',
        message: 'Voice input is not configured',
      });
    }

    const { audio, mimeType } = request.body as { audio: string; mimeType: string };

    const audioType = normalizeAudioMimeType(mimeType);
    if (!audioType) {
      return reply.status(415).send({
        error: 'Unsupported Media Type',
        code: 'STT_UNSUPPORTED_AUDIO_TYPE',
        message: 'Unsupported audio container',
      });
    }

    const buffer = Buffer.from(audio, 'base64');
    if (buffer.length === 0) {
      return reply.status(400).send({
        error: 'Bad Request',
        code: 'STT_EMPTY_AUDIO',
        message: 'Audio payload is empty',
      });
    }
    // The bodyLimit above bounds the encoded string; this bounds what is
    // actually sent upstream, which is the number the provider bills and caps.
    if (buffer.length > config.STT_MAX_AUDIO_BYTES) {
      return reply.status(413).send({
        error: 'Payload Too Large',
        code: 'STT_AUDIO_TOO_LARGE',
        message: 'Recording is too long',
      });
    }

    try {
      const result = await sttService.transcribe({ audio: buffer, audioType });

      // Silence, or a clip too short to contain a word. A distinct code because
      // the client says something different for it than for a failure.
      if (result.text.length === 0) {
        return reply.status(422).send({
          error: 'Unprocessable Entity',
          code: 'STT_NO_SPEECH',
          message: 'No speech recognized in the recording',
        });
      }

      return reply.send({ text: result.text, model: result.model });
    } catch (error) {
      if (isAllKeysExhaustedError(error)) {
        const retryAfter = Math.max(1, Math.ceil(error.retryAfterMs / 1000));
        reply.header('Retry-After', retryAfter.toString());
        return reply.status(429).send({
          error: 'Too Many Requests',
          code: 'STT_QUOTA_EXCEEDED',
          message: 'Transcription quota is exhausted. Please try again later.',
          retryAfter,
        });
      }

      // Anything else is an upstream or transport fault. Answered here rather
      // than by the global handler so the error feed records a cause instead of
      // an unexplained 5xx, and so no part of the provider's message - which can
      // quote the request - reaches the client.
      const message = error instanceof Error ? error.message : 'Transcription failed';
      captureErrorSnapshot(request, 'STT_FAILED', message);
      return reply.status(503).send({
        error: 'Service Unavailable',
        code: 'STT_FAILED',
        message: 'Transcription failed. Please try again.',
      });
    }
  });
};
