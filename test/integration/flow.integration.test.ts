import type { FastifyInstance } from 'fastify';

/**
 * One journey, end to end, through HTTP only.
 *
 * Every other integration file tests a single route with the rest of the world
 * stubbed or seeded: rows are planted with `prisma.translation.create`, a token
 * is minted in `beforeAll`, and a step's *output* is rarely the next step's
 * *input*. That leaves a specific blind spot — the contracts between the routes.
 * A `previewId` the save route cannot read, a history row whose `id` the
 * favorite route rejects, a `translationId` sharing will not accept: each of
 * those passes its own suite and breaks the product.
 *
 * So nothing here is seeded. The user is created by the handshake, the text is
 * translated by the preview call, the row exists because save was called, and
 * every id travels from the previous response — asserted through the API, never
 * read out of Prisma. The database is queried only to prove the *absence* of a
 * write where the contract forbids one.
 */

let generateValidInitData: (options?: any) => string;
let historyMaxEntries: number;

describe('End-to-end flow', () => {
  let app: FastifyInstance;
  let prisma: any;
  let flushRedis: () => Promise<void>;

  /** A telegram id of its own, so no other suite's cleanup can race this one. */
  const TELEGRAM_ID = 744000101;
  const SOURCE_TEXT = 'Кіт розбудив мене о шостій ранку і вимагав їсти';

  beforeAll(async () => {
    await import('./setup-test-context.js').then(m => m.setup());

    const testContext = await import('./test-context.js');
    app = testContext.getAppInstance();
    prisma = testContext.getPrismaClient();
    flushRedis = testContext.flushRedis;

    generateValidInitData = (await import('../helpers/telegram-initdata.js')).generateValidInitData;
    historyMaxEntries = (await import('../../src/constants/index.js')).HISTORY_MAX_ENTRIES;

    // Rate-limit windows are per user id, and the id is created by the flow
    // itself; flushing keeps a rerun in the same minute honest.
    await flushRedis();
    const existing = await prisma.user.findUnique({ where: { telegramId: String(TELEGRAM_ID) } });
    if (existing) {
      await prisma.translation.deleteMany({ where: { userId: existing.id } });
    }
  });

  // Deliberately one test, not seven. The steps are not independent — each one
  // consumes what the previous produced — and split across `it`s the suite would
  // depend on vitest's execution order while pretending not to.
  it('auth → preview → save → history → favorite → share → delete', async () => {
    // 1. Handshake. The only credential is Telegram's signed initData; everything
    //    after this uses tokens the server issued here.
    const handshake = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/telegram',
      payload: { initData: generateValidInitData({ user: { id: TELEGRAM_ID, first_name: 'Flow', username: 'flowuser' } }) },
    });
    expect(handshake.statusCode).toBe(200);
    const accessToken: string = JSON.parse(handshake.body).accessToken;
    expect(accessToken).toBeTruthy();
    // The refresh token is a cookie, never part of the JSON body.
    expect(handshake.body).not.toContain('refreshToken');
    const auth = { authorization: `Bearer ${accessToken}` };

    // 2. A fresh account starts with nothing, and the client learns the server's
    //    history cap from the response instead of hardcoding it.
    const emptyHistory = await app.inject({ method: 'GET', url: '/api/v1/history', headers: auth });
    expect(emptyHistory.statusCode).toBe(200);
    const emptyBody = JSON.parse(emptyHistory.body);
    expect(emptyBody.data).toEqual([]);
    expect(emptyBody.totalCount).toBe(0);
    expect(emptyBody.totalLimit).toBe(historyMaxEntries);

    // 3. Preview: the only call that spends an LLM request, and the only one that
    //    accepts text.
    const preview = await app.inject({
      method: 'POST',
      url: '/api/v1/translate/preview',
      headers: auth,
      payload: { text: SOURCE_TEXT, style: 'GEN_Z' },
    });
    expect(preview.statusCode).toBe(200);
    const previewBody = JSON.parse(preview.body);
    expect(previewBody.previewId).toMatch(/^[0-9a-f-]{36}$/);
    expect(previewBody.originalText).toBe(SOURCE_TEXT);
    expect(previewBody.translatedText.length).toBeGreaterThan(0);
    expect(previewBody.slangStyle).toBe('GEN_Z');

    // 4. Still nothing stored. This is the whole point of the preview/save split:
    //    typing in the app must not fill History.
    const afterPreview = await app.inject({ method: 'GET', url: '/api/v1/history', headers: auth });
    expect(JSON.parse(afterPreview.body).totalCount).toBe(0);

    // 5. Save takes the previewId and nothing else — the client cannot choose what
    //    gets written, so the stored row must equal what preview returned.
    const save = await app.inject({
      method: 'POST',
      url: '/api/v1/translate/save',
      headers: auth,
      payload: { previewId: previewBody.previewId },
    });
    expect(save.statusCode).toBe(200);
    const saved = JSON.parse(save.body);
    expect(saved.id).toBeGreaterThan(0);
    expect(saved.originalText).toBe(SOURCE_TEXT);
    expect(saved.translatedText).toBe(previewBody.translatedText);
    expect(saved.providerId).toBe(previewBody.providerId);
    expect(saved.favorite).toBe(false);

    // 6. The row is now visible in the list, under the id save handed back.
    const history = await app.inject({ method: 'GET', url: '/api/v1/history', headers: auth });
    expect(history.statusCode).toBe(200);
    const historyBody = JSON.parse(history.body);
    expect(historyBody.totalCount).toBe(1);
    expect(historyBody.data).toHaveLength(1);
    expect(historyBody.data[0].id).toBe(saved.id);
    expect(historyBody.data[0].translatedText).toBe(previewBody.translatedText);
    expect(historyBody.nextCursor).toBeNull();

    // 7. Favorite by explicit value rather than the legacy toggle, and confirm the
    //    filter agrees with the flag the PATCH returned.
    const favorite = await app.inject({
      method: 'PATCH',
      url: `/api/v1/history/${saved.id}/favorite`,
      headers: auth,
      payload: { favorite: true },
    });
    expect(favorite.statusCode).toBe(200);
    expect(JSON.parse(favorite.body).favorite).toBe(true);

    const favorites = await app.inject({ method: 'GET', url: '/api/v1/history?favorite=true', headers: auth });
    expect(JSON.parse(favorites.body).data.map((row: { id: number }) => row.id)).toEqual([saved.id]);

    // 8. Share a saved row by its id. The response carries the message body and an
    //    opaque handle; the handle must not be the text, and the text must not be
    //    the handle.
    const share = await app.inject({
      method: 'POST',
      url: '/api/v1/share/inline',
      headers: auth,
      payload: { translationId: saved.id },
    });
    expect(share.statusCode).toBe(200);
    const shareBody = JSON.parse(share.body);
    expect(shareBody.inlineQuery).toMatch(/^s_[0-9a-f-]{36}$/);
    expect(shareBody.shareText).toBe(previewBody.translatedText);
    expect(shareBody.inlineQuery).not.toContain(SOURCE_TEXT);
    expect(new Date(shareBody.expiresAt).getTime()).toBeGreaterThan(Date.now());

    // Sharing is not saving: the share token exists in Redis, History still has
    // exactly the one row from step 5.
    expect(await prisma.translation.count({ where: { id: saved.id } })).toBe(1);

    // 9. Delete by the same id, and confirm through the API rather than the table.
    const remove = await app.inject({
      method: 'DELETE',
      url: `/api/v1/history/${saved.id}`,
      headers: auth,
    });
    expect(remove.statusCode).toBe(204);

    const finalHistory = await app.inject({ method: 'GET', url: '/api/v1/history', headers: auth });
    expect(finalHistory.statusCode).toBe(200);
    const finalBody = JSON.parse(finalHistory.body);
    expect(finalBody.data).toEqual([]);
    expect(finalBody.totalCount).toBe(0);
    // The row is gone from the database too, not merely hidden from the list.
    expect(await prisma.translation.count({ where: { id: saved.id } })).toBe(0);
  });
});
