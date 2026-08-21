/**
 * Speech-to-text service
 *
 * Turns a recorded audio buffer into text through an OpenAI-compatible
 * `/v1/audio/transcriptions` endpoint (Groq's whisper-large-v3-turbo by
 * default). Deliberately *not* an `IAIProvider`:
 *
 * - `IAIProvider` is exactly `translate()`, and adding `transcribe()` would
 *   force every chat adapter to implement or throw;
 * - none of the translation machinery applies - no style engine, no circuit
 *   breaker, no provider fallback chain, no persistence;
 * - the keys are separate (`STT_API_KEY`), so a spent transcription quota can
 *   never park a key the translator still needs.
 *
 * What it *does* share with the AI layer is key rotation: `KeyPool` and the
 * key-exhaustion classifier are imported rather than copied, because a free
 * tier is only usable across several users if an exhausted key is parked and
 * the next one serves the request.
 *
 * Privacy invariant: the audio buffer exists only for the duration of a call.
 * It is never written to Postgres, Redis, a temp file or a log line, and no
 * transcript is stored here either - the text goes back to the client and
 * nowhere else.
 */

import OpenAI from 'openai';
import { config } from '../../config/index.js';
import { KeyExhaustionKind, KeyPool, parseKeyList } from '../ai/key-pool.js';
import { classifyOpenAIKeyExhaustion } from '../ai/key-exhaustion.js';
import { AllKeysExhaustedError } from '../ai/errors.js';
import { logger } from '../../lib/logger.js';

/** Pool id. Used for cooldown keys and log lines; never a key value. */
const POOL_ID = 'stt';

/**
 * Container formats the endpoint accepts, mapped to the file extension it
 * infers the format from. This is an allowlist, not a hint: the route rejects
 * anything absent here, so a client cannot make the server forward arbitrary
 * bytes upstream.
 *
 * Both browser containers matter - Android Chromium records
 * `audio/webm;codecs=opus`, iOS WKWebView records `audio/mp4`.
 */
const AUDIO_EXTENSIONS: Readonly<Record<string, string>> = Object.freeze({
  'audio/webm': 'webm',
  'audio/ogg': 'ogg',
  'audio/opus': 'opus',
  'audio/mp4': 'mp4',
  'audio/mpeg': 'mp3',
  'audio/wav': 'wav',
  'audio/x-wav': 'wav',
  'audio/x-m4a': 'm4a',
  'audio/flac': 'flac',
});

export interface NormalizedAudioType {
  /** The bare type, parameters stripped: `audio/webm;codecs=opus` -> `audio/webm`. */
  mimeType: string;
  /** Extension for the uploaded filename, which is how the format is detected. */
  extension: string;
}

/**
 * Validate and normalize a recorder-supplied MIME type.
 *
 * `MediaRecorder.mimeType` carries codec parameters, so the value is split on
 * `;` before the allowlist is consulted. Returns null for anything unsupported,
 * which the route turns into a 415 rather than guessing a format.
 */
export function normalizeAudioMimeType(raw: string): NormalizedAudioType | null {
  const mimeType = raw.split(';')[0]!.trim().toLowerCase();
  const extension = AUDIO_EXTENSIONS[mimeType];
  return extension ? { mimeType, extension } : null;
}

export interface TranscribeInput {
  /** Decoded audio. Size is checked by the caller against STT_MAX_AUDIO_BYTES. */
  audio: Buffer;
  /** Already normalized by `normalizeAudioMimeType`. */
  audioType: NormalizedAudioType;
}

export interface TranscribeResult {
  /** Trimmed transcript. May be empty - silence transcribes to nothing. */
  text: string;
  model: string;
}

export class SttService {
  private keyPoolInstance: KeyPool | null = null;
  /**
   * One SDK client per key. A client holds connection state, and the map is
   * bounded by the number of configured keys.
   */
  private readonly clients = new Map<string, OpenAI>();

  /**
   * Built lazily so that a process which never transcribes never parses the key
   * list, and so tests can reload config before the first call.
   */
  private get keyPool(): KeyPool {
    if (!this.keyPoolInstance) {
      this.keyPoolInstance = new KeyPool({
        id: POOL_ID,
        keys: parseKeyList(config.STT_API_KEY),
        cooldownMs: {
          rate: config.STT_KEY_COOLDOWN_RATE_MS,
          quota: config.STT_KEY_COOLDOWN_QUOTA_MS,
          invalid: config.STT_KEY_COOLDOWN_INVALID_MS,
        },
      });
    }
    return this.keyPoolInstance;
  }

  /**
   * No key, no feature. Same availability rule as the AI providers, and the
   * reason the client can hide the microphone instead of failing after a
   * recording.
   */
  isAvailable(): boolean {
    return this.keyPool.size > 0;
  }

  get model(): string {
    return config.STT_MODEL;
  }

  private clientFor(apiKey: string): OpenAI {
    const cached = this.clients.get(apiKey);
    if (cached) {
      return cached;
    }

    const client = new OpenAI({
      apiKey,
      baseURL: config.STT_BASE_URL,
      // Rotation is the retry strategy here: on a free tier the next key is a
      // better bet than the same key after a backoff. The SDK's default of 2
      // would also reuse a key the pool has already parked.
      maxRetries: 0,
      timeout: config.STT_TIMEOUT_MS,
    });

    this.clients.set(apiKey, client);
    return client;
  }

  /**
   * Transcribe one clip, rotating keys on exhaustion.
   *
   * Every key gets at most one turn, so a request can never walk the pool
   * twice. Throws `AllKeysExhaustedError` when nothing is usable - the route
   * turns that into a 429 with a retry hint, because on a free tier an
   * exhausted minute is a normal state rather than an incident. Any other error
   * propagates unchanged: a malformed body or a server fault is not a key
   * problem and must not consume the pool.
   */
  async transcribe(input: TranscribeInput): Promise<TranscribeResult> {
    const attempts = this.keyPool.size;
    let lastError: Error | undefined;
    let lastKind: KeyExhaustionKind | undefined;

    for (let attempt = 0; attempt < attempts; attempt++) {
      const lease = await this.keyPool.next();
      if (!lease) {
        break;
      }

      try {
        // A fresh File per attempt: the body is consumed by the request, so a
        // retried upload cannot reuse the previous one.
        const file = new File(
          [input.audio],
          `speech.${input.audioType.extension}`,
          { type: input.audioType.mimeType },
        );

        const response = await this.clientFor(lease.key).audio.transcriptions.create({
          file,
          model: config.STT_MODEL,
          language: config.STT_LANGUAGE,
          response_format: 'json',
          // Whisper's default already is 0; pinned so a provider changing its
          // default cannot start paraphrasing colloquial speech, which is
          // exactly the signal the style engine needs intact.
          temperature: 0,
        });

        return { text: (response.text ?? '').trim(), model: config.STT_MODEL };
      } catch (error) {
        const kind = classifyOpenAIKeyExhaustion(error);
        if (!kind) {
          throw error;
        }

        lastError = error as Error;
        lastKind = kind;
        await this.keyPool.penalize(lease.index, kind);

        // Only the index is logged - the key itself must never reach a log line,
        // and neither must anything derived from the audio.
        const logPayload = { keyIndex: lease.index, poolSize: this.keyPool.size, kind };
        if (kind === 'invalid') {
          logger.error(logPayload, 'STT API key rejected as invalid; parked and rotating');
        } else {
          logger.warn(logPayload, 'STT API key exhausted; parked and rotating');
        }
      }
    }

    throw new AllKeysExhaustedError(
      POOL_ID,
      await this.keyPool.retryAfterMs(),
      lastKind,
      { cause: lastError },
    );
  }
}

export const sttService = new SttService();
