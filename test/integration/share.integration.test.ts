import type { FastifyInstance } from 'fastify';

describe('Telegram inline sharing', () => {
  let app: FastifyInstance;
  let prisma: any;
  let token: string;
  let secondToken: string;
  let generateValidInitData: (options?: any) => string;

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
    const first = await app.inject({ method: 'POST', url: '/api/v1/auth/telegram', payload: { initData: generateValidInitData() } });
    token = JSON.parse(first.body).accessToken;
    const second = await app.inject({ method: 'POST', url: '/api/v1/auth/telegram', payload: { initData: generateValidInitData({ user: { id: 998877, first_name: 'Other' } }) } });
    secondToken = JSON.parse(second.body).accessToken;
  });

  it('creates an opaque share token for an owned preview without saving History', async () => {
    const preview = await app.inject({ method: 'POST', url: '/api/v1/translate/preview', headers: { authorization: `Bearer ${token}` }, payload: { text: 'Share this', style: 'GEN_Z' } });
    const response = await app.inject({ method: 'POST', url: '/api/v1/share/inline', headers: { authorization: `Bearer ${token}` }, payload: { previewId: JSON.parse(preview.body).previewId } });
    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body.inlineQuery).toMatch(/^s_[0-9a-f-]{36}$/);
    expect(body.inlineQuery).not.toContain('Share this');
    expect(await prisma.translation.count()).toBe(0);
  });

  // The message Telegram actually sends is rendered here, not by the client:
  // switchInlineQuery only types `s_<token>` into the composer, which stays
  // unsendable unless the bot answers the inline query.
  it('returns the finished shareText alongside the inline token', async () => {
    const preview = await app.inject({ method: 'POST', url: '/api/v1/translate/preview', headers: { authorization: `Bearer ${token}` }, payload: { text: 'Render me', style: 'GEN_Z' } });
    const previewBody = JSON.parse(preview.body);
    const response = await app.inject({ method: 'POST', url: '/api/v1/share/inline', headers: { authorization: `Bearer ${token}` }, payload: { previewId: previewBody.previewId } });
    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(typeof body.shareText).toBe('string');
    // No "SlangUA · <style>" header: the app name inside the message body was
    // rendered by Telegram as a link to the bot in the user's own message.
    expect(body.shareText).toBe(previewBody.translatedText);
    // The token is an internal handle - it must never travel inside the message.
    expect(body.shareText).not.toContain(body.inlineQuery);
  });

  // Age-restricted results are shareable, but only after self-attestation. The
  // check lives in the route, not in the UI: the Mini App only hides the button.
  describe('age-restricted styles', () => {
    async function pofeniPreviewId() {
      await app.inject({ method: 'PATCH', url: '/api/v1/user/me', headers: { authorization: `Bearer ${token}` }, payload: { ageConfirmedAdult: true } });
      const preview = await app.inject({ method: 'POST', url: '/api/v1/translate/preview', headers: { authorization: `Bearer ${token}` }, payload: { text: 'Share the restricted one', style: 'POFENI' } });
      expect(preview.statusCode).toBe(200);
      return JSON.parse(preview.body).previewId as string;
    }

    it('shares an 18+ result for a user who confirmed adulthood', async () => {
      const previewId = await pofeniPreviewId();
      const response = await app.inject({ method: 'POST', url: '/api/v1/share/inline', headers: { authorization: `Bearer ${token}` }, payload: { previewId } });
      expect(response.statusCode).toBe(200);
      expect(JSON.parse(response.body).inlineQuery).toMatch(/^s_[0-9a-f-]{36}$/);
    });

    it('still rejects an 18+ result once the confirmation is withdrawn', async () => {
      const previewId = await pofeniPreviewId();
      await app.inject({ method: 'PATCH', url: '/api/v1/user/me', headers: { authorization: `Bearer ${token}` }, payload: { ageConfirmedAdult: false } });
      const response = await app.inject({ method: 'POST', url: '/api/v1/share/inline', headers: { authorization: `Bearer ${token}` }, payload: { previewId } });
      expect(response.statusCode).toBe(403);
      expect(JSON.parse(response.body).code).toBe('AGE_RESTRICTED_SHARE');
    });
  });

  it('rejects a preview owned by another user', async () => {
    const preview = await app.inject({ method: 'POST', url: '/api/v1/translate/preview', headers: { authorization: `Bearer ${token}` }, payload: { text: 'Private share', style: 'GEN_Z' } });
    const response = await app.inject({ method: 'POST', url: '/api/v1/share/inline', headers: { authorization: `Bearer ${secondToken}` }, payload: { previewId: JSON.parse(preview.body).previewId } });
    expect(response.statusCode).toBe(404);
  });
});
