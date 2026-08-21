/**
 * Controllable `MediaRecorder` / `getUserMedia` doubles for the voice-input tests.
 *
 * These deliberately do **not** live in `src/test/setup.ts`, unlike the other
 * global stubs there. A recorder is only useful to a test that can decide when
 * data arrives, when the recording stops and whether the permission prompt was
 * refused - and a global stub would also make `isSupported` true for every
 * existing component test, silently rendering a microphone button in unrelated
 * snapshots.
 */

export interface FakeTrack {
  kind: string;
  stopped: boolean;
  stop: () => void;
}

export interface FakeStream {
  tracks: FakeTrack[];
  getTracks: () => FakeTrack[];
}

export function createFakeStream(): FakeStream {
  const track: FakeTrack = {
    kind: 'audio',
    stopped: false,
    stop() {
      track.stopped = true;
    },
  };

  return {
    tracks: [track],
    getTracks: () => [track],
  };
}

/** What Android Chromium answers to `isTypeSupported`, which is the common case. */
const DEFAULT_SUPPORTED_TYPES = ['audio/webm;codecs=opus', 'audio/webm'];

export class FakeMediaRecorder {
  /** Containers `isTypeSupported` accepts. Overwrite to emulate iOS (`audio/mp4`). */
  static supportedTypes: string[] = [...DEFAULT_SUPPORTED_TYPES];

  static isTypeSupported(type: string): boolean {
    return FakeMediaRecorder.supportedTypes.includes(type);
  }

  state: 'inactive' | 'recording' | 'paused' = 'inactive';
  mimeType: string;
  ondataavailable: ((event: { data: Blob }) => void) | null = null;
  onstop: (() => void) | null = null;
  onerror: (() => void) | null = null;

  /** Makes `start()` throw, the way an unsupported container does. */
  failOnStart = false;
  /** Makes `stop()` throw, so the hook's own recovery path is reachable. */
  failOnStop = false;
  /** Emitted by `stop()`; `null` emulates a recorder that produced nothing. */
  pendingChunk: Blob | null = new Blob([new Uint8Array([1, 2, 3, 4])], { type: 'audio/webm' });

  // Written out rather than declared as a constructor parameter property:
  // `erasableSyntaxOnly` in the tsconfigs rules those out.
  stream: FakeStream;

  constructor(stream: FakeStream, options?: { mimeType?: string }) {
    this.stream = stream;
    this.mimeType = options?.mimeType ?? 'audio/webm';
  }

  start(): void {
    if (this.failOnStart) throw new Error('MediaRecorder.start failed');
    this.state = 'recording';
  }

  /**
   * Synchronous, unlike the real thing, and in that order: the browser flushes
   * the last `dataavailable` before `stop`, and a double that fired them the
   * other way round would let a hook that reads its chunks too early pass.
   */
  stop(): void {
    if (this.failOnStop) throw new Error('MediaRecorder.stop failed');
    this.state = 'inactive';
    if (this.pendingChunk) this.ondataavailable?.({ data: this.pendingChunk });
    this.onstop?.();
  }

  /** An extra chunk mid-recording, for the multi-chunk assembly case. */
  emit(chunk: Blob): void {
    this.ondataavailable?.({ data: chunk });
  }

  dispatchError(): void {
    this.state = 'inactive';
    this.onerror?.();
  }
}

export interface MediaRecorderMock {
  /** Recorders constructed so far, oldest first. */
  recorders: FakeMediaRecorder[];
  /** Streams handed out by `getUserMedia`, so a test can assert the mic was released. */
  streams: FakeStream[];
  /** The recorder of the capture in progress. */
  last: () => FakeMediaRecorder;
  /** Refuse the next permission prompt with a `DOMException`-shaped error. */
  rejectWith: (name: string) => void;
  /** Never resolve the prompt, so `cancel()` during `requesting` is testable. */
  hangGetUserMedia: () => void;
  restore: () => void;
}

/**
 * Installs both APIs on the jsdom globals - neither exists there - and returns a
 * handle for driving them. Always `restore()` in `afterEach`: a leaked
 * `window.MediaRecorder` turns `isSupported` true for every later test file.
 */
export function installMediaRecorderMock(): MediaRecorderMock {
  const recorders: FakeMediaRecorder[] = [];
  const streams: FakeStream[] = [];
  const defaultSupportedTypes = [...DEFAULT_SUPPORTED_TYPES];
  let rejection: string | null = null;
  let hang = false;

  class TrackedRecorder extends FakeMediaRecorder {
    constructor(stream: FakeStream, options?: { mimeType?: string }) {
      super(stream, options);
      recorders.push(this);
    }
  }

  const getUserMedia = (): Promise<FakeStream> => {
    if (hang) return new Promise<FakeStream>(() => {});
    if (rejection) {
      const error = new Error(rejection);
      error.name = rejection;
      rejection = null;
      return Promise.reject(error);
    }
    const stream = createFakeStream();
    streams.push(stream);
    return Promise.resolve(stream);
  };

  const hadMediaDevices = 'mediaDevices' in navigator;
  const previousMediaDevices = (navigator as { mediaDevices?: unknown }).mediaDevices;

  Object.defineProperty(navigator, 'mediaDevices', {
    configurable: true,
    writable: true,
    value: { getUserMedia },
  });
  (window as unknown as { MediaRecorder: unknown }).MediaRecorder = TrackedRecorder;

  return {
    recorders,
    streams,
    last: () => {
      const recorder = recorders.at(-1);
      if (!recorder) throw new Error('No MediaRecorder was constructed');
      return recorder;
    },
    rejectWith: (name: string) => {
      rejection = name;
    },
    hangGetUserMedia: () => {
      hang = true;
    },
    restore: () => {
      FakeMediaRecorder.supportedTypes = [...defaultSupportedTypes];
      delete (window as unknown as { MediaRecorder?: unknown }).MediaRecorder;
      if (hadMediaDevices) {
        Object.defineProperty(navigator, 'mediaDevices', {
          configurable: true,
          writable: true,
          value: previousMediaDevices,
        });
      } else {
        delete (navigator as { mediaDevices?: unknown }).mediaDevices;
      }
    },
  };
}
