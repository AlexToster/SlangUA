import { act, renderHook } from '@testing-library/react';
import { useVoiceInput, type UseVoiceInputOptions } from './useVoiceInput';
import { installMediaRecorderMock, type MediaRecorderMock } from '../test/mediaRecorderMock';
import { apiService } from '../services/api';

// Only the one method is needed, and the real module builds an axios client at
// import time - which would then need a base URL and an auth token to exist.
vi.mock('../services/api', () => ({
  apiService: { transcribe: vi.fn() },
}));

// Haptics reach for AudioContext and localStorage; neither is part of what these
// tests are about.
vi.mock('../services/telegram', () => ({
  triggerHapticFeedback: vi.fn(),
}));

const transcribe = vi.mocked(apiService.transcribe);

function setup(overrides: Partial<UseVoiceInputOptions> = {}) {
  const onTranscript = vi.fn();
  const onNotice = vi.fn();
  const view = renderHook(() => useVoiceInput({
    enabled: true,
    onTranscript,
    onNotice,
    ...overrides,
  }));
  return { onTranscript, onNotice, ...view };
}

/** The whole capture: open the microphone, hold it, release it, let the request run. */
async function capture(view: { result: { current: { onToggle: () => void } | undefined } }, holdMs = 2_000) {
  await act(async () => {
    view.result.current?.onToggle();
  });
  act(() => {
    vi.advanceTimersByTime(holdMs);
  });
  await act(async () => {
    view.result.current?.onToggle();
  });
}

describe('useVoiceInput', () => {
  let media: MediaRecorderMock;

  beforeEach(() => {
    vi.useFakeTimers();
    media = installMediaRecorderMock();
    transcribe.mockResolvedValue({ text: 'привіт світ', model: 'whisper-large-v3-turbo' });
  });

  afterEach(() => {
    media.restore();
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  // No control at all rather than a disabled button - see the hook's own note.
  it('hands back no control when the deployment has no voice input', () => {
    const view = setup({ enabled: false });
    expect(view.result.current).toBeUndefined();
  });

  it('hands back no control when the client cannot record', () => {
    media.restore();
    const view = setup();
    expect(view.result.current).toBeUndefined();
  });

  it('reports the recording state and counts the elapsed seconds up', async () => {
    const view = setup();

    await act(async () => {
      view.result.current?.onToggle();
    });
    expect(view.result.current?.state).toBe('recording');
    expect(view.result.current?.elapsedSeconds).toBe(0);
    expect(view.result.current?.progress).toBe(0);

    act(() => {
      vi.advanceTimersByTime(2_000);
    });
    expect(view.result.current?.elapsedSeconds).toBe(2);
    expect(view.result.current?.progress).toBeCloseTo(2 / 30);
  });

  // Скасування — не «зупинити тихіше»: запис не їде на сервер узагалі, і
  // користувач не отримує ні тексту, ні повідомлення про помилку.
  it('drops the capture on cancel without sending it anywhere', async () => {
    const view = setup();

    await act(async () => {
      view.result.current?.onToggle();
    });
    act(() => {
      vi.advanceTimersByTime(3_000);
    });
    await act(async () => {
      view.result.current?.onCancel();
    });

    expect(transcribe).not.toHaveBeenCalled();
    expect(view.onTranscript).not.toHaveBeenCalled();
    expect(view.onNotice).not.toHaveBeenCalled();
    expect(view.result.current?.state).toBe('idle');
    expect(media.streams[0].tracks[0].stopped).toBe(true);
  });

  it('sends the captured clip and hands back the trimmed transcript', async () => {
    transcribe.mockResolvedValue({ text: '  привіт світ  ', model: 'whisper-large-v3-turbo' });
    const view = setup();

    await capture(view);

    expect(transcribe).toHaveBeenCalledTimes(1);
    const [audio, mimeType] = transcribe.mock.calls[0];
    // Base64 of the mock's 4-byte chunk; the container is the recorder's own.
    expect(audio).toBe('AQIDBA==');
    expect(mimeType).toBe('audio/webm;codecs=opus');
    expect(view.onTranscript).toHaveBeenCalledWith('привіт світ');
    expect(view.onNotice).not.toHaveBeenCalled();
    expect(view.result.current?.state).toBe('idle');
  });

  // 'processing' has to appear before the server answers, otherwise the button
  // flashes back to 'idle' and invites a second tap over the request in flight.
  it('stays in processing until the request settles', async () => {
    let settle: ((value: { text: string; model: string }) => void) | undefined;
    transcribe.mockReturnValue(new Promise((resolve) => {
      settle = resolve;
    }));
    const view = setup();

    await capture(view);
    expect(view.result.current?.state).toBe('processing');
    expect(view.result.current?.elapsedSeconds).toBeNull();

    // A second tap here must not open the microphone again.
    await act(async () => {
      view.result.current?.onToggle();
    });
    expect(media.recorders).toHaveLength(1);

    await act(async () => {
      settle?.({ text: 'готово', model: 'whisper-large-v3-turbo' });
    });
    expect(view.result.current?.state).toBe('idle');
    expect(view.onTranscript).toHaveBeenCalledWith('готово');
  });

  // A provider can answer 200 with whitespace where the server's own emptiness
  // check saw a non-empty string.
  it('treats a blank transcript as silence rather than as text', async () => {
    transcribe.mockResolvedValue({ text: '   ', model: 'whisper-large-v3-turbo' });
    const view = setup();

    await capture(view);

    expect(view.onTranscript).not.toHaveBeenCalled();
    expect(view.onNotice).toHaveBeenCalledWith({
      message: 'Не почув мови в записі. Спробуйте ще раз.',
      type: 'info',
    });
  });

  it('names the wait when the provider quota is exhausted', async () => {
    transcribe.mockRejectedValue({
      response: { status: 429, data: { code: 'STT_QUOTA_EXCEEDED', retryAfter: 120 } },
    });
    const view = setup();

    await capture(view);

    expect(view.onNotice).toHaveBeenCalledWith({
      message: 'Ліміт розпізнавання вичерпано. Спробуйте через 2 хв.',
      type: 'error',
    });
    expect(view.result.current?.state).toBe('idle');
  });

  it('separates this deployment’s own limiter from the provider quota', async () => {
    transcribe.mockRejectedValue({
      response: { status: 429, data: { code: 'RATE_LIMIT_EXCEEDED' } },
    });
    const view = setup();

    await capture(view);

    expect(view.onNotice).toHaveBeenCalledWith({
      message: 'Забагато записів підряд. Зачекайте хвилину.',
      type: 'info',
    });
  });

  it('reports a request that never reached the server', async () => {
    transcribe.mockRejectedValue(new Error('Network Error'));
    const view = setup();

    await capture(view);

    expect(view.onNotice).toHaveBeenCalledWith({
      message: "Немає зв'язку з сервером. Перевірте інтернет і спробуйте ще раз.",
      type: 'error',
    });
  });

  it('explains a refused microphone and sends nothing', async () => {
    media.rejectWith('NotAllowedError');
    const view = setup();

    await act(async () => {
      view.result.current?.onToggle();
    });

    expect(transcribe).not.toHaveBeenCalled();
    expect(view.onNotice).toHaveBeenCalledWith({
      message: 'Доступ до мікрофона закритий. Дозвольте його для Telegram у налаштуваннях системи.',
      type: 'info',
    });
    expect(view.result.current?.state).toBe('idle');
  });

  it('tells the user a tap was too short instead of sending a fragment', async () => {
    const view = setup();

    await capture(view, 120);

    expect(transcribe).not.toHaveBeenCalled();
    expect(view.onNotice).toHaveBeenCalledWith({
      message: 'Надто коротко. Натисніть мікрофон, скажіть фразу і натисніть ще раз.',
      type: 'info',
    });
  });
});
