import { act, renderHook } from '@testing-library/react';
import {
  MAX_RECORDING_MS,
  useAudioRecorder,
  type UseAudioRecorderOptions,
} from './useAudioRecorder';
import {
  FakeMediaRecorder,
  installMediaRecorderMock,
  type MediaRecorderMock,
} from '../test/mediaRecorderMock';

function setup(overrides: Partial<UseAudioRecorderOptions> = {}) {
  const onClip = vi.fn();
  const onError = vi.fn();
  const view = renderHook(() => useAudioRecorder({ onClip, onError, ...overrides }));
  return { onClip, onError, ...view };
}

/** `start()` opens the microphone asynchronously, so every test awaits the flush. */
async function begin(view: { result: { current: { start: () => void } } }) {
  await act(async () => {
    view.result.current.start();
  });
}

describe('useAudioRecorder', () => {
  let media: MediaRecorderMock;

  beforeEach(() => {
    vi.useFakeTimers();
    media = installMediaRecorderMock();
  });

  afterEach(() => {
    media.restore();
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it('hands back one clip carrying the recorder’s own container and the duration', async () => {
    const view = setup();
    await begin(view);

    expect(view.result.current.status).toBe('recording');
    expect(view.result.current.isRecording).toBe(true);

    act(() => {
      vi.advanceTimersByTime(2_000);
    });
    act(() => {
      view.result.current.stop();
    });

    expect(view.onError).not.toHaveBeenCalled();
    expect(view.onClip).toHaveBeenCalledTimes(1);
    const clip = view.onClip.mock.calls[0][0];
    expect(clip.mimeType).toBe('audio/webm;codecs=opus');
    expect(clip.blob.type).toBe('audio/webm;codecs=opus');
    expect(clip.durationMs).toBe(2_000);
    expect(view.result.current.status).toBe('idle');
  });

  it('assembles every chunk the recorder produced', async () => {
    const view = setup();
    await begin(view);

    act(() => {
      media.last().emit(new Blob([new Uint8Array(10)], { type: 'audio/webm' }));
      vi.advanceTimersByTime(1_000);
    });
    act(() => {
      view.result.current.stop();
    });

    expect(view.onClip.mock.calls[0][0].blob.size).toBe(14);
  });

  it('asks for the first container the platform admits to supporting', async () => {
    FakeMediaRecorder.supportedTypes = ['audio/mp4'];
    const view = setup();

    await begin(view);

    expect(media.last().mimeType).toBe('audio/mp4');
  });

  it('lets the platform choose when it claims to support none of the containers', async () => {
    // An iOS build that answers `false` to everything still records; guessing a
    // container here would be worse than passing no preference at all.
    FakeMediaRecorder.supportedTypes = [];
    const view = setup();

    await begin(view);

    expect(media.last().mimeType).toBe('audio/webm');
  });

  it('reports the whole feature missing rather than a failure', () => {
    media.restore();
    const view = setup();

    expect(view.result.current.isSupported).toBe(false);
    act(() => {
      view.result.current.start();
    });

    expect(view.onError).toHaveBeenCalledWith('unsupported');
    expect(view.result.current.status).toBe('idle');
  });

  it('tells a refusal apart from a machine with no microphone', async () => {
    const view = setup();

    media.rejectWith('NotAllowedError');
    await begin(view);
    expect(view.onError).toHaveBeenLastCalledWith('permission');

    media.rejectWith('NotFoundError');
    await begin(view);
    expect(view.onError).toHaveBeenLastCalledWith('unsupported');

    media.rejectWith('AbortError');
    await begin(view);
    expect(view.onError).toHaveBeenLastCalledWith('failed');

    expect(view.result.current.status).toBe('idle');
    expect(view.onClip).not.toHaveBeenCalled();
  });

  it('treats a mis-tap as too short instead of spending a transcription call', async () => {
    const view = setup();
    await begin(view);

    act(() => {
      vi.advanceTimersByTime(120);
    });
    act(() => {
      view.result.current.stop();
    });

    expect(view.onError).toHaveBeenCalledWith('too-short');
    expect(view.onClip).not.toHaveBeenCalled();
  });

  it('refuses a clip with no bytes in it', async () => {
    const view = setup();
    await begin(view);

    media.last().pendingChunk = null;
    act(() => {
      vi.advanceTimersByTime(1_500);
    });
    act(() => {
      view.result.current.stop();
    });

    expect(view.onError).toHaveBeenCalledWith('failed');
    expect(view.onClip).not.toHaveBeenCalled();
  });

  it('surfaces a recorder failure and releases the microphone', async () => {
    const view = setup();
    await begin(view);

    act(() => {
      media.last().dispatchError();
    });

    expect(view.onError).toHaveBeenCalledWith('failed');
    expect(view.onClip).not.toHaveBeenCalled();
    expect(media.streams[0].tracks[0].stopped).toBe(true);
    expect(view.result.current.status).toBe('idle');
  });

  it('stops itself at the ceiling without the user tapping again', async () => {
    const view = setup();
    await begin(view);

    act(() => {
      vi.advanceTimersByTime(MAX_RECORDING_MS);
    });

    expect(view.onClip).toHaveBeenCalledTimes(1);
    expect(view.onClip.mock.calls[0][0].durationMs).toBe(MAX_RECORDING_MS);
    expect(view.result.current.status).toBe('idle');
    expect(media.streams[0].tracks[0].stopped).toBe(true);
  });

  it('releases the microphone as soon as a normal capture ends', async () => {
    const view = setup();
    await begin(view);

    expect(media.streams[0].tracks[0].stopped).toBe(false);
    act(() => {
      vi.advanceTimersByTime(1_000);
    });
    act(() => {
      view.result.current.stop();
    });

    expect(media.streams[0].tracks[0].stopped).toBe(true);
  });

  it('throws the clip away on cancel, reporting neither a clip nor an error', async () => {
    const view = setup();
    await begin(view);

    act(() => {
      vi.advanceTimersByTime(3_000);
    });
    act(() => {
      view.result.current.cancel();
    });

    expect(view.onClip).not.toHaveBeenCalled();
    expect(view.onError).not.toHaveBeenCalled();
    expect(media.streams[0].tracks[0].stopped).toBe(true);
    expect(view.result.current.status).toBe('idle');
  });

  it('cancels while the permission prompt is still open', async () => {
    media.hangGetUserMedia();
    const view = setup();
    await begin(view);

    expect(view.result.current.status).toBe('requesting');
    act(() => {
      view.result.current.cancel();
    });

    expect(view.result.current.status).toBe('idle');
    expect(view.onError).not.toHaveBeenCalled();
  });

  it('ignores a second start while a capture is running', async () => {
    const view = setup();
    await begin(view);
    await begin(view);

    expect(media.recorders).toHaveLength(1);
    expect(media.streams).toHaveLength(1);
  });

  it('hands the microphone back when the component unmounts mid-recording', async () => {
    const view = setup();
    await begin(view);

    act(() => {
      vi.advanceTimersByTime(4_000);
    });
    act(() => {
      view.unmount();
    });

    expect(media.streams[0].tracks[0].stopped).toBe(true);
    expect(view.onClip).not.toHaveBeenCalled();
    expect(view.onError).not.toHaveBeenCalled();
  });

  it('ticks the elapsed time while recording and clears it afterwards', async () => {
    const view = setup();
    await begin(view);

    act(() => {
      vi.advanceTimersByTime(1_200);
    });
    expect(view.result.current.elapsedMs).toBe(1_200);

    act(() => {
      view.result.current.stop();
    });
    expect(view.result.current.elapsedMs).toBe(0);
  });
});
