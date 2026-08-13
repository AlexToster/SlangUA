import { consumePreviewAttempt } from './previewAttempts';

describe('consumePreviewAttempt', () => {
  it('allows no more than three automatic attempts for one preview', () => {
    let state = { key: '', retryNonce: 0, count: 0 };

    state = consumePreviewAttempt(state, 'Привіт|KANCLER', 0)!;
    state = consumePreviewAttempt(state, 'Привіт|KANCLER', 0)!;
    state = consumePreviewAttempt(state, 'Привіт|KANCLER', 0)!;

    expect(state.count).toBe(3);
    expect(consumePreviewAttempt(state, 'Привіт|KANCLER', 0)).toBeNull();
  });

  it('starts a fresh attempt cycle after an explicit retry', () => {
    const exhausted = { key: 'Привіт|KANCLER', retryNonce: 0, count: 3 };

    expect(consumePreviewAttempt(exhausted, 'Привіт|KANCLER', 1)).toEqual({
      key: 'Привіт|KANCLER',
      retryNonce: 1,
      count: 1,
    });
  });
});
