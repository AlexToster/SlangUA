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
 * Window for one loudness reading. 512 samples is ~11 ms at 48 kHz: long enough
 * that a single glottal pulse does not dominate the average, short enough that
 * the meter reacts inside one frame.
 */
const ANALYSER_FFT_SIZE = 512;

/**
 * Speech held at arm's length lands around 0.05-0.2 RMS, so a plain voice would
 * only ever nudge the bottom of the scale. This puts it mid-scale and clips the
 * top, which is what a meter is for: showing that something is being heard, not
 * measuring it.
 */
const LEVEL_GAIN = 4;

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
  /**
   * How loud the microphone is right now, 0...1, read straight from the analyser
   * on the caller's own frame. A function rather than state on purpose: a level
   * in state would re-render the whole editor fifteen times a second.
   *
   * Answers 0 - never throws - where Web Audio is missing (jsdom, older
   * WebViews) or the context was refused, so the meter simply sits at rest.
   */
  sampleLevel: () => number;
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

  // The loudness meter. Separate from the recorder on purpose: it taps the same
  // stream but nothing here reaches the clip, so a shell without Web Audio still
  // records - it just has no bars to draw.
  const audioContextRef = useRef<AudioContext | null>(null);
  const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  // Pinned to a plain ArrayBuffer: `getByteTimeDomainData` refuses a view that
  // might sit on a SharedArrayBuffer, and a bare `Uint8Array` is exactly that
  // union to the DOM types.
  const levelDataRef = useRef<Uint8Array<ArrayBuffer> | null>(null);

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
   * Tears the meter down. Must run with (or before) the track stop: an open
   * `AudioContext` holding a source node keeps the platform's own recording
   * indicator lit in some shells even after every track is stopped.
   */
  const closeMeter = useCallback(() => {
    const context = audioContextRef.current;
    try {
      sourceRef.current?.disconnect();
      analyserRef.current?.disconnect();
    } catch {
      // Already disconnected - nothing to do.
    }
    sourceRef.current = null;
    analyserRef.current = null;
    levelDataRef.current = null;
    audioContextRef.current = null;
    if (context) {
      try {
        void context.close();
      } catch {
        // Best effort: a context that refuses to close costs nothing here.
      }
    }
  }, []);

  /**
   * Best-effort, exactly like the click sound in `services/telegram`: the meter
   * is decoration over a working recorder, so every failure here is swallowed
   * and capture continues without bars.
   */
  const openMeter = useCallback((stream: MediaStream) => {
    const AudioContextConstructor =
      window.AudioContext ||
      (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioContextConstructor) return;

    try {
      const context = new AudioContextConstructor();
      const analyser = context.createAnalyser();
      analyser.fftSize = ANALYSER_FFT_SIZE;
      const source = context.createMediaStreamSource(stream);
      source.connect(analyser);
      // iOS hands back a suspended context; the tap that started the capture is
      // the gesture that lets it resume.
      void context.resume?.().catch(() => {});

      audioContextRef.current = context;
      sourceRef.current = source;
      analyserRef.current = analyser;
      levelDataRef.current = new Uint8Array(new ArrayBuffer(analyser.fftSize));
    } catch {
      closeMeter();
    }
  }, [closeMeter]);

  const sampleLevel = useCallback(() => {
    const analyser = analyserRef.current;
    const data = levelDataRef.current;
    if (!analyser || !data) return 0;

    try {
      analyser.getByteTimeDomainData(data);
    } catch {
      return 0;
    }

    // RMS of the waveform, which sits around 128 at silence. Peak would jump on
    // every plosive; the average is what reads as "a voice is coming through".
    let sum = 0;
    for (let i = 0; i < data.length; i += 1) {
      const deviation = (data[i] - 128) / 128;
      sum += deviation * deviation;
    }
    const rms = Math.sqrt(sum / data.length);
    return Math.min(1, rms * LEVEL_GAIN);
  }, []);

  /**
   * Released as early as possible: while a track is live, the platform keeps its
   * own recording indicator up, which reads as "this app is still listening".
   */
  const releaseStream = useCallback(() => {
    closeMeter();
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
  }, [closeMeter]);

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
      openMeter(stream);

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
  }, [applyStatus, maxDurationMs, minDurationMs, openMeter, stop, teardown]);

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
    sampleLevel,
    start,
    stop,
    cancel,
  };
}
