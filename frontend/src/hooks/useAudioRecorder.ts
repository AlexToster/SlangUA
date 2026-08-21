import { useCallback, useEffect, useRef, useState } from 'react';

/** Hard cap on one capture. Also the server's ceiling, expressed in seconds. */
export const MAX_RECORDING_MS = 30_000;

/**
 * Below this a capture is treated as a mis-tap rather than speech. Sending it
 * would spend a transcription call from a quota shared by every user of the
 * deployment, and get back either nothing or a hallucinated word.
 */
export const MIN_RECORDING_MS = 500;

/** Ticks the visible timer. Coarse on purpose - nothing here needs 60 fps. */
const TICK_MS = 200;

/**
 * Containers to ask the recorder for, best first, intersected with the
 * allowlist the server enforces. Android Chromium answers with the WebM/Opus
 * entries, iOS WKWebView only with `audio/mp4`; an empty preference (every
 * `isTypeSupported` false) means we let the platform choose its own default.
 */
const PREFERRED_MIME_TYPES = [
  'audio/webm;codecs=opus',
  'audio/webm',
  'audio/ogg;codecs=opus',
  'audio/mp4',
] as const;

export type AudioRecorderStatus = 'idle' | 'requesting' | 'recording' | 'stopping';

export type AudioRecorderErrorKind =
  /** This WebView has no `MediaRecorder`/`getUserMedia`, or no microphone exists. */
  | 'unsupported'
  /** The user, the OS, or Telegram's WebView refused the microphone. */
  | 'permission'
  /** Released too fast to be speech - see `MIN_RECORDING_MS`. */
  | 'too-short'
  /** The recorder itself failed, or produced a clip we cannot name. */
  | 'failed';

export interface AudioClip {
  blob: Blob;
  /** The recorder's own type, codec parameters included - the server needs it verbatim. */
  mimeType: string;
  durationMs: number;
}

export interface UseAudioRecorderOptions {
  onClip: (clip: AudioClip) => void;
  onError: (kind: AudioRecorderErrorKind) => void;
  maxDurationMs?: number;
  minDurationMs?: number;
}

export interface UseAudioRecorderResult {
  status: AudioRecorderStatus;
  isRecording: boolean;
  /**
   * Whether capture is possible at all in this shell. Checked once per render
   * rather than cached, because it is a property of the environment: jsdom and
   * any WebView without the two APIs answer `false`, and the button is then
   * never rendered.
   */
  isSupported: boolean;
  elapsedMs: number;
  start: () => void;
  /** Stop and hand the clip over. */
  stop: () => void;
  /** Stop and throw the clip away - no transcription, no error. */
  cancel: () => void;
}

function isRecordingSupported(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.MediaRecorder !== 'undefined' &&
    typeof navigator !== 'undefined' &&
    typeof navigator.mediaDevices?.getUserMedia === 'function'
  );
}

function pickMimeType(): string | undefined {
  const supported = window.MediaRecorder.isTypeSupported;
  if (typeof supported !== 'function') return undefined;

  return PREFERRED_MIME_TYPES.find((type) => {
    try {
      return supported.call(window.MediaRecorder, type);
    } catch {
      return false;
    }
  });
}

/**
 * `getUserMedia` rejects with a handful of names that mean quite different
 * things to the user: a refusal is worth explaining and retrying, a missing
 * microphone is not.
 */
function classifyMediaError(error: unknown): AudioRecorderErrorKind {
  const name = error instanceof Error ? error.name : '';

  if (name === 'NotAllowedError' || name === 'SecurityError' || name === 'PermissionDeniedError') {
    return 'permission';
  }
  if (name === 'NotFoundError' || name === 'DevicesNotFoundError' || name === 'NotSupportedError') {
    return 'unsupported';
  }
  return 'failed';
}

/**
 * Tap-to-start, tap-to-stop microphone capture for the text field.
 *
 * Deliberately not press-and-hold: holding a 44 px control steady is awkward on
 * a phone, impossible with a screen reader driving the button, and a lifted
 * finger during a scroll would silently discard a finished sentence.
 *
 * The hook owns the microphone and nothing else - it hands back one finished
 * clip and never touches the network, so the button, the copy and the retry
 * policy stay in the component.
 */
export function useAudioRecorder(options: UseAudioRecorderOptions): UseAudioRecorderResult {
  const { maxDurationMs = MAX_RECORDING_MS, minDurationMs = MIN_RECORDING_MS } = options;

  const [status, setStatus] = useState<AudioRecorderStatus>('idle');
  const [elapsedMs, setElapsedMs] = useState(0);

  // The recorder's handlers are wired once, inside an async flow, so they must
  // read the current callbacks rather than the render that started the capture.
  const callbacksRef = useRef(options);
  useEffect(() => {
    callbacksRef.current = options;
  });

  const statusRef = useRef<AudioRecorderStatus>('idle');
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const startedAtRef = useRef(0);
  const stopTimerRef = useRef<number | null>(null);
  const tickTimerRef = useRef<number | null>(null);
  /** Set by `cancel()` and by unmount: the finished clip is thrown away. */
  const discardRef = useRef(false);
  /** Invalidates an in-flight `getUserMedia` when the user cancels or unmounts. */
  const attemptRef = useRef(0);
  const mountedRef = useRef(true);

  const applyStatus = useCallback((next: AudioRecorderStatus) => {
    statusRef.current = next;
    if (mountedRef.current) setStatus(next);
  }, []);

  const clearTimers = useCallback(() => {
    if (stopTimerRef.current !== null) window.clearTimeout(stopTimerRef.current);
    if (tickTimerRef.current !== null) window.clearInterval(tickTimerRef.current);
    stopTimerRef.current = null;
    tickTimerRef.current = null;
  }, []);

  /**
   * Released as early as possible: while a track is live, the platform keeps its
   * own recording indicator up, which reads as "this app is still listening".
   */
  const releaseStream = useCallback(() => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
  }, []);

  /** Everything that has to happen exactly once per capture, on any outcome. */
  const teardown = useCallback(() => {
    clearTimers();
    releaseStream();
    recorderRef.current = null;
    startedAtRef.current = 0;
    applyStatus('idle');
    if (mountedRef.current) setElapsedMs(0);
  }, [applyStatus, clearTimers, releaseStream]);

  const stop = useCallback(() => {
    if (statusRef.current !== 'recording') return;
    applyStatus('stopping');
    // The clip is assembled in the recorder's `onstop`, which fires after the
    // final `ondataavailable` - stopping here would race that last chunk.
    try {
      recorderRef.current?.stop();
    } catch {
      const kind = discardRef.current ? null : 'failed';
      discardRef.current = false;
      chunksRef.current = [];
      teardown();
      if (kind) callbacksRef.current.onError(kind);
    }
  }, [applyStatus, teardown]);

  const cancel = useCallback(() => {
    if (statusRef.current === 'idle') return;
    if (statusRef.current === 'recording') {
      discardRef.current = true;
      stop();
      return;
    }
    // Still waiting on `getUserMedia`. Bumping the attempt token is what makes
    // the in-flight continuation drop the stream instead of opening a recorder,
    // and it survives an immediate second tap, which a shared flag would not.
    attemptRef.current += 1;
    applyStatus('idle');
  }, [applyStatus, stop]);

  const start = useCallback(() => {
    if (statusRef.current !== 'idle') return;
    if (!isRecordingSupported()) {
      callbacksRef.current.onError('unsupported');
      return;
    }

    const attempt = ++attemptRef.current;
    discardRef.current = false;
    chunksRef.current = [];
    applyStatus('requesting');

    void (async () => {
      let stream: MediaStream;
      try {
        // Plain `{ audio: true }` on purpose: tuned constraints (channel count,
        // sample rate) are rejected outright by some WebViews, and the model
        // resamples whatever it is given anyway.
        stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      } catch (error) {
        if (attempt !== attemptRef.current) return;
        teardown();
        callbacksRef.current.onError(classifyMediaError(error));
        return;
      }

      if (attempt !== attemptRef.current) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      streamRef.current = stream;

      let recorder: MediaRecorder;
      try {
        const mimeType = pickMimeType();
        recorder = new window.MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      } catch {
        teardown();
        callbacksRef.current.onError('failed');
        return;
      }
      recorderRef.current = recorder;

      recorder.ondataavailable = (event) => {
        if (event.data && event.data.size > 0) chunksRef.current.push(event.data);
      };

      recorder.onerror = () => {
        const discarded = discardRef.current;
        discardRef.current = false;
        chunksRef.current = [];
        teardown();
        if (!discarded) callbacksRef.current.onError('failed');
      };

      recorder.onstop = () => {
        const chunks = chunksRef.current;
        chunksRef.current = [];
        const discarded = discardRef.current;
        discardRef.current = false;
        const durationMs = startedAtRef.current === 0 ? 0 : Date.now() - startedAtRef.current;
        teardown();
        if (discarded) return;

        if (durationMs < minDurationMs) {
          callbacksRef.current.onError('too-short');
          return;
        }

        // `recorder.mimeType` is the authoritative answer - it carries the codec
        // parameters the platform actually chose. The blob's own type is the
        // fallback for shells that leave the property empty.
        const mimeType = recorder.mimeType || chunks[0]?.type || '';
        const blob = new Blob(chunks, mimeType ? { type: mimeType } : undefined);

        // A clip we cannot name is unusable rather than merely awkward: the
        // server infers the container from this string and refuses the rest.
        if (blob.size === 0 || !mimeType) {
          callbacksRef.current.onError('failed');
          return;
        }

        callbacksRef.current.onClip({ blob, mimeType, durationMs });
      };

      try {
        // No timeslice: one `dataavailable` at the end. Interim chunks would buy
        // nothing, since the clip goes to the server in one piece.
        recorder.start();
      } catch {
        teardown();
        callbacksRef.current.onError('failed');
        return;
      }

      startedAtRef.current = Date.now();
      applyStatus('recording');
      setElapsedMs(0);

      stopTimerRef.current = window.setTimeout(stop, maxDurationMs);
      tickTimerRef.current = window.setInterval(() => {
        setElapsedMs(Math.min(maxDurationMs, Date.now() - startedAtRef.current));
      }, TICK_MS);
    })();
  }, [applyStatus, maxDurationMs, minDurationMs, stop, teardown]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      // Unmount is not a reason to transcribe: the clip is dropped, but the
      // microphone must still be handed back or the platform keeps listening.
      mountedRef.current = false;
      attemptRef.current += 1;
      discardRef.current = true;
      if (statusRef.current === 'recording') {
        try {
          recorderRef.current?.stop();
        } catch {
          // Nothing to report - the release below is the part that matters.
        }
      }
      clearTimers();
      releaseStream();
      recorderRef.current = null;
      statusRef.current = 'idle';
    };
  }, [clearTimers, releaseStream]);

  return {
    status,
    isRecording: status === 'recording',
    isSupported: isRecordingSupported(),
    elapsedMs,
    start,
    stop,
    cancel,
  };
}
