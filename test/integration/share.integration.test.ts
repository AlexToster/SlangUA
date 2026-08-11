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

  it('rejects a preview owned by another user', async () => {
    const preview = await app.inject({ method: 'POST', url: '/api/v1/translate/preview', headers: { authorization: `Bearer ${token}` }, payload: { text: 'Private share', style: 'GEN_Z' } });
    const response = await app.inject({ method: 'POST', url: '/api/v1/share/inline', headers: { authorization: `Bearer ${secondToken}` }, payload: { previewId: JSON.parse(preview.body).previewId } });
    expect(response.statusCode).toBe(404);
  });
});
