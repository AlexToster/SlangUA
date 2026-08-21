import { useCallback, useEffect, useRef, useState } from 'react';
import { apiService } from '../services/api';
import { triggerHapticFeedback } from '../services/telegram';
import { blobToBase64 } from '../utils/audio';
import {
  MAX_RECORDING_MS,
  useAudioRecorder,
  type AudioClip,
  type AudioRecorderErrorKind,
} from './useAudioRecorder';
import type { VoiceInputControl } from '../components/TextInput';

export interface VoiceNotice {
  message: string;
  type: 'error' | 'info';
}

export interface UseVoiceInputOptions {
  /**
   * Whether the deployment has voice input at all (`voiceInputAvailable` from
   * `/user/me`). A microphone that always answers `503` is worse than none.
   */
  enabled: boolean;
  /** Called once per capture with the trimmed transcript, never with interim text. */
  onTranscript: (text: string) => void;
  onNotice: (notice: VoiceNotice) => void;
}

/**
 * Every failure the user can hit, in their own words. Nothing here quotes the
 * provider or the server: an upstream message can contain the request.
 */
const RECORDER_NOTICES: Record<AudioRecorderErrorKind, VoiceNotice> = {
  unsupported: {
    message: 'Цей клієнт Telegram не дає доступу до мікрофона. Спробуйте набрати текст.',
    type: 'info',
  },
  permission: {
    message: 'Доступ до мікрофона закритий. Дозвольте його для Telegram у налаштуваннях системи.',
    type: 'info',
  },
  'too-short': {
    message: 'Надто коротко. Натисніть мікрофон, скажіть фразу і натисніть ще раз.',
    type: 'info',
  },
  failed: { message: 'Не вдалося записати звук. Спробуйте ще раз.', type: 'error' },
};

const NO_SPEECH: VoiceNotice = { message: 'Не почув мови в записі. Спробуйте ще раз.', type: 'info' };

/** Minutes, rounded up, because «через 47 секунд» reads like a stopwatch. */
function formatRetryAfter(seconds: number): string {
  if (seconds <= 60) return 'менш ніж хвилину';
  return `${Math.ceil(seconds / 60)} хв`;
}

/**
 * Maps the transcribe route's own error codes to Ukrainian copy. Codes, not
 * status codes: `429` is either the per-minute limiter of this deployment
 * (`RATE_LIMIT_EXCEEDED`) or the provider's exhausted quota
 * (`STT_QUOTA_EXCEEDED`), and the user can act on the first but not the second.
 */
function describeTranscribeError(error: unknown): VoiceNotice {
  const response = (error as {
    response?: { status?: number; data?: { code?: string; retryAfter?: number } };
  }).response;

  if (!response) {
    return { message: "Немає зв'язку з сервером. Перевірте інтернет і спробуйте ще раз.", type: 'error' };
  }

  const { code, retryAfter } = response.data ?? {};

  switch (code) {
    case 'STT_NO_SPEECH':
      return NO_SPEECH;
    case 'STT_QUOTA_EXCEEDED':
      return {
        message: retryAfter
          ? `Ліміт розпізнавання вичерпано. Спробуйте через ${formatRetryAfter(retryAfter)}.`
          : 'Ліміт розпізнавання вичерпано. Спробуйте трохи пізніше.',
        type: 'error',
      };
    case 'RATE_LIMIT_EXCEEDED':
      return { message: 'Забагато записів підряд. Зачекайте хвилину.', type: 'info' };
    case 'STT_AUDIO_TOO_LARGE':
      return { message: 'Запис завеликий. Скажіть коротшу фразу.', type: 'info' };
    case 'STT_UNSUPPORTED_AUDIO_TYPE':
    case 'STT_EMPTY_AUDIO':
      return { message: 'Не вдалося обробити цей запис. Спробуйте ще раз.', type: 'error' };
    case 'STT_UNAVAILABLE':
      return { message: 'Голосовий ввід зараз недоступний. Наберіть текст, будь ласка.', type: 'info' };
    default:
      if (response.status === 401 || response.status === 403) {
        return { message: 'Сесія завершилась. Перезапустіть застосунок у Telegram.', type: 'error' };
      }
      return { message: 'Не вдалося розпізнати мову. Спробуйте ще раз.', type: 'error' };
  }
}

/**
 * Composes the recorder with the transcribe request and turns both into the one
 * shape the footer button needs. The page keeps no recording state of its own:
 * it hands over two callbacks and renders whatever `control` says.
 *
 * `control` is `undefined` - not a disabled button - when this deployment has no
 * STT key or this WebView cannot record at all.
 */
export function useVoiceInput({ enabled, onTranscript, onNotice }: UseVoiceInputOptions): VoiceInputControl | undefined {
  const [isTranscribing, setIsTranscribing] = useState(false);

  // Same pattern as useAudioRecorder: the recorder holds onto its callbacks for
  // the whole capture, so they are read from a ref instead of being closed over.
  const callbacksRef = useRef({ onTranscript, onNotice });
  useEffect(() => {
    callbacksRef.current = { onTranscript, onNotice };
  });

  const mountedRef = useRef(true);
  useEffect(() => () => {
    mountedRef.current = false;
  }, []);

  const handleClip = useCallback(async (clip: AudioClip) => {
    setIsTranscribing(true);
    try {
      const audio = await blobToBase64(clip.blob);
      const result = await apiService.transcribe(audio, clip.mimeType);
      const text = result.text.trim();
      // A provider can answer 200 with whitespace where the route's own
      // emptiness check saw a non-empty string.
      if (!text) {
        callbacksRef.current.onNotice(NO_SPEECH);
        return;
      }
      callbacksRef.current.onTranscript(text);
      triggerHapticFeedback('notification');
    } catch (error) {
      callbacksRef.current.onNotice(describeTranscribeError(error));
    } finally {
      // The page may have unmounted mid-request; the transcript above is
      // dropped in that case, but a setState after unmount is a warning.
      if (mountedRef.current) setIsTranscribing(false);
    }
  }, []);

  const handleRecorderError = useCallback((kind: AudioRecorderErrorKind) => {
    callbacksRef.current.onNotice(RECORDER_NOTICES[kind]);
  }, []);

  const { status, isRecording, isSupported, elapsedMs, start, stop } = useAudioRecorder({
    onClip: handleClip,
    onError: handleRecorderError,
  });

  const onToggle = useCallback(() => {
    if (isRecording) {
      stop();
      triggerHapticFeedback('impact');
      return;
    }
    // A request is in flight: the recorder is already 'idle', but a second tap
    // would open the microphone over a transcript that has not arrived yet. The
    // button is disabled meanwhile - this is the second line of defence, since
    // `onToggle` is not only reachable by click.
    if (isTranscribing) return;
    // 'requesting' and 'stopping' are mid-flight too: a tap there would either
    // race the permission prompt or start a second capture over the first clip.
    if (status !== 'idle') return;
    start();
    triggerHapticFeedback('selection');
  }, [isRecording, isTranscribing, status, start, stop]);

  if (!enabled || !isSupported) return undefined;

  // 'stopping' is folded into 'processing': the clip is already being assembled,
  // and a flash back to the plain microphone would invite a second tap.
  const state = isTranscribing || status === 'stopping'
    ? 'processing'
    : status === 'recording'
      ? 'recording'
      : status === 'requesting'
        ? 'requesting'
        : 'idle';

  return {
    state,
    // Rounded up so the badge shows the cap itself (30) for the first tick and
    // never sits on 0 while the recorder is still open.
    remainingSeconds: state === 'recording'
      ? Math.max(0, Math.ceil((MAX_RECORDING_MS - elapsedMs) / 1000))
      : null,
    onToggle,
  };
}
