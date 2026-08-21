/**
 * Voice input: POST /api/v1/transcribe.
 *
 * Runs against the mock server's `/v1/audio/transcriptions` branch, so the whole
 * path is real HTTP - base64 in, multipart upstream, transcript back - without a
 * provider account.
 *
 * The container assertions are the point of the suite: Android Chromium records
 * `audio/webm;codecs=opus` and iOS WKWebView records `audio/mp4`, and the
 * endpoint infers the format from the uploaded filename, so getting the
 * extension wrong fails on exactly one platform and nowhere else.
 */

import type { FastifyInstance } from 'fastify';
import {
  setMockConfig,
  resetSttState,
  getSttCallCount,
  getLastSttRequest,
} from '../helpers/mock-ollama-server.js';

/** Not real audio - the mock counts bytes and drops them. */
const CLIP = Buffer.alloc(1024, 7).toString('base64');
const WEBM = 'audio/webm;codecs=opus';

describe('POST /api/v1/transcribe', () => {
  let app: FastifyInstance;
  let prisma: any;
  let token: string;
  let generateValidInitData: (options?: any) => string;

  const post = (payload: unknown, bearer: string | null = token) =>
    app.inject({
      method: 'POST',
      url: '/api/v1/transcribe',
      ...(bearer ? { headers: { authorization: `Bearer ${bearer}` } } : {}),
      payload: payload as any,
    });

  beforeAll(async () => {
    await import('./setup-test-context.js').then(m => m.setup());
    const context = await import('./test-context.js');
    app = context.getAppInstance();
    prisma = context.getPrismaClient();
    generateValidInitData = (await import('../helpers/telegram-initdata.js')).generateValidInitData;
  });

  beforeEach(async () => {
    await prisma.translation.deleteMany();
    await prisma.refreshToken.deleteMany();
    await prisma.user.deleteMany();
    // A fresh user per test means a fresh rate-limit bucket: the limiter keys by
    // user id, and the id is an autoincrement.
    const auth = await app.inject({ method: 'POST', url: '/api/v1/auth/telegram', payload: { initData: generateValidInitData() } });
    token = JSON.parse(auth.body).accessToken;
    resetSttState();
    setMockConfig({ sttFailStatus: undefined, sttText: undefined });
  });

  it('returns the transcript for an authenticated request', async () => {
    const response = await post({ audio: CLIP, mimeType: WEBM });
    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body.text).toBe('привіт, як ся маєш');
    expect(body.model).toBe('whisper-large-v3-turbo');
  });

  // The privacy invariant, asserted rather than documented: transcription is not
  // a translation, and nothing about the clip may outlive the request.
  it('persists nothing', async () => {
    await post({ audio: CLIP, mimeType: WEBM });
    expect(await prisma.translation.count()).toBe(0);
  });

  it('uploads the Android container as a .webm file', async () => {
    await post({ audio: CLIP, mimeType: WEBM });
    const seen = getLastSttRequest();
    expect(seen?.filename).toBe('speech.webm');
    // Codec parameters are stripped: the endpoint wants a bare type here.
    expect(seen?.fileContentType).toBe('audio/webm');
    expect(seen?.model).toBe('whisper-large-v3-turbo');
    // Ukrainian is pinned rather than autodetected - Whisper mistakes short
    // Ukrainian clips for Russian often enough to matter.
    expect(seen?.language).toBe('uk');
    expect(seen?.bytes).toBeGreaterThan(1024);
  });

  it('uploads the iOS container as an .mp4 file', async () => {
    await post({ audio: CLIP, mimeType: 'audio/mp4' });
    expect(getLastSttRequest()?.filename).toBe('speech.mp4');
  });

  it('authenticates upstream with a key from the pool', async () => {
    await post({ audio: CLIP, mimeType: WEBM });
    expect(getLastSttRequest()?.authorization).toMatch(/^Bearer test-stt-key-(one|two)-not-real$/);
  });

  // An open transcribe endpoint is a free STT proxy, so this is a security
  // assertion, not a convenience one.
  it('refuses an unauthenticated request without calling upstream', async () => {
    const response = await post({ audio: CLIP, mimeType: WEBM }, null);
    expect(response.statusCode).toBe(401);
    expect(getSttCallCount()).toBe(0);
  });

  it('refuses a container it cannot name', async () => {
    const response = await post({ audio: CLIP, mimeType: 'audio/amr' });
    expect(response.statusCode).toBe(415);
    expect(JSON.parse(response.body).code).toBe('STT_UNSUPPORTED_AUDIO_TYPE');
    // Rejected before the upstream call: the allowlist is what keeps the server
    // from forwarding arbitrary bytes.
    expect(getSttCallCount()).toBe(0);
  });

  it('refuses audio over the configured ceiling', async () => {
    const oversize = Buffer.alloc(4097, 1).toString('base64');
    const response = await post({ audio: oversize, mimeType: WEBM });
    expect(response.statusCode).toBe(413);
    expect(JSON.parse(response.body).code).toBe('STT_AUDIO_TOO_LARGE');
    expect(getSttCallCount()).toBe(0);
  });

  it('refuses a body that is not base64 audio', async () => {
    for (const payload of [
      { audio: 'not base64!!', mimeType: WEBM },
      { audio: '', mimeType: WEBM },
      { audio: CLIP },
      { audio: CLIP, mimeType: WEBM, prompt: 'transcribe as English' },
    ]) {
      const response = await post(payload);
      expect(response.statusCode, JSON.stringify(payload).slice(0, 40)).toBe(400);
    }
    expect(getSttCallCount()).toBe(0);
  });

  // Silence has its own code because the client says something different for it
  // ("не почули") than for a failure.
  it('reports silence as STT_NO_SPEECH', async () => {
    setMockConfig({ sttText: '   ' });
    const response = await post({ audio: CLIP, mimeType: WEBM });
    expect(response.statusCode).toBe(422);
    expect(JSON.parse(response.body).code).toBe('STT_NO_SPEECH');
  });

  // On a free tier an exhausted minute is the normal state, not an incident, so
  // it gets its own code and a number the client can show.
  it('rotates through every key before reporting the quota exhausted', async () => {
    setMockConfig({ sttFailStatus: 429 });
    const response = await post({ audio: CLIP, mimeType: WEBM });
    expect(response.statusCode).toBe(429);
    const body = JSON.parse(response.body);
    expect(body.code).toBe('STT_QUOTA_EXCEEDED');
    expect(body.retryAfter).toBeGreaterThan(0);
    expect(response.headers['retry-after']).toBeDefined();
    // Two keys are configured, and each gets exactly one turn per request.
    expect(getSttCallCount()).toBe(2);
  });

  // A 5xx is not a key problem: it must not walk the pool, and the provider's
  // own message must not reach the client.
  it('answers an upstream fault with STT_FAILED after a single attempt', async () => {
    setMockConfig({ sttFailStatus: 500 });
    const response = await post({ audio: CLIP, mimeType: WEBM });
    expect(response.statusCode).toBe(503);
    const body = JSON.parse(response.body);
    expect(body.code).toBe('STT_FAILED');
    expect(body.message).not.toContain('Mock transcription failure');
    expect(getSttCallCount()).toBe(1);
  });

  // Its own budget, not the shared per-user one: every call spends upstream
  // quota that all users of the deployment share.
  it('enforces its own rate limit', async () => {
    const limit = Number(process.env.STT_RATE_LIMIT_MAX_REQUESTS);
    for (let i = 0; i < limit; i++) {
      expect((await post({ audio: CLIP, mimeType: WEBM })).statusCode, `request ${i + 1}`).toBe(200);
    }
    const blocked = await post({ audio: CLIP, mimeType: WEBM });
    expect(blocked.statusCode).toBe(429);
    expect(JSON.parse(blocked.body).code).toBe('RATE_LIMIT_EXCEEDED');
    // The limiter runs before the handler, so the blocked call costs no quota.
    expect(getSttCallCount()).toBe(limit);
  });

  // The client needs to know before it records, not after: /user/me carries the
  // same deployment fact the endpoint's 503 would report too late.
  it('is announced on the profile as voiceInputAvailable', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/v1/user/me', headers: { authorization: `Bearer ${token}` } });
    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body).voiceInputAvailable).toBe(true);
  });
});
