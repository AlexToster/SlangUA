import { useRef, useEffect, type CSSProperties } from 'react';
import { Mic, Dices, X, AlertCircle, Loader2 } from 'lucide-react';
import clsx from 'clsx';
import { VoiceMeter } from './VoiceMeter';
import './TextInput.css';

/** What the microphone shows; `undefined` for the whole prop means no microphone. */
export type VoiceInputState = 'idle' | 'requesting' | 'recording' | 'processing';

export interface VoiceInputControl {
  state: VoiceInputState;
  /** Скільки секунд уже триває запис; `null` у будь-якому іншому стані. */
  elapsedSeconds: number | null;
  /** Частка витраченого ліміту, 0…1 — лінійка вздовж низу пігулки. */
  progress: number;
  onToggle: () => void;
  /** Кинути запис і нічого не розпізнавати. */
  onCancel: () => void;
  /** Поточна гучність, 0…1. Читається на кадрі шкали, а не в рендері. */
  sampleLevel: () => number;
}

interface TextInputProps {
  value: string;
  onRandomPhrase: () => void;
  isRandomPhraseDisabled: boolean;
  onChange: (text: string) => void;
  /**
   * Omitted when the deployment holds no STT key or the WebView cannot record.
   * A microphone that is present but never able to work is worse than none, so
   * the caller decides existence and this component only renders a state.
   */
  voice?: VoiceInputControl;
  graphemeCount: number;
  maxGraphemes: number;
  isWarningZone: boolean;
  isOverLimit: boolean;
  placeholder: string;
}

const VOICE_LABELS: Record<VoiceInputState, string> = {
  idle: 'Записати голосом',
  requesting: 'Дозвольте доступ до мікрофона',
  recording: 'Зупинити запис',
  processing: 'Розпізнаю мову',
};

/** Тільки секунди, з ведучим нулем: стеля — півхвилини, тому хвилин тут не буває. */
function formatElapsed(seconds: number | null): string {
  return String(Math.max(0, seconds ?? 0)).padStart(2, '0');
}

export function TextInput({ value, onChange, voice, onRandomPhrase, isRandomPhraseDisabled, graphemeCount, maxGraphemes, isWarningZone, isOverLimit, placeholder }: TextInputProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Auto-resize textarea
  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 200)}px`;
    }
  }, [value]);

  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const newValue = e.target.value;
    const segmenter = new Intl.Segmenter('uk', { granularity: 'grapheme' });
    const segments = Array.from(segmenter.segment(newValue));
    
    if (segments.length <= maxGraphemes) {
      onChange(newValue);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // Prevent newline on Enter (optional - could allow Shift+Enter)
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
    }
  };

  // Два стани, у яких мікрофон займає весь рядок: запис і розпізнавання. Саме
  // вони згортають «Випадкову фразу» до піктограми.
  const isVoiceExpanded = voice?.state === 'recording' || voice?.state === 'processing';

  return (
    <div className={clsx('text-input-wrapper', isOverLimit && 'over-limit', isWarningZone && 'warning-zone')}>
      <label htmlFor="translate-input" className="visually-hidden">
        Текст для перекладу
      </label>
      <div className="text-input-container">
        <textarea
          ref={textareaRef}
          id="translate-input"
          value={value}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          className="text-input"
          aria-describedby={isOverLimit ? 'char-limit-error' : isWarningZone ? 'char-limit-warning' : 'char-counter'}
          aria-invalid={isOverLimit}
          maxLength={maxGraphemes * 2} // Rough fallback
        />
        {/* Sits inside the editor as a background element in its bottom-right
            corner, so it no longer competes with the action row for width. It is
            not interactive, hence pointer-events: none in CSS — clicks in that
            corner must still land in the textarea. */}
        <div className={clsx('char-counter', isOverLimit && 'error', isWarningZone && 'warning')}
             id={isOverLimit ? 'char-limit-error' : isWarningZone ? 'char-limit-warning' : 'char-counter'}
             data-testid="char-counter"
             aria-live="polite"
             aria-atomic="true">
          {isOverLimit && <AlertCircle size={14} />}
          {/* Locale is pinned to uk-UA: bare toLocaleString() follows the host
              locale, so the same build showed "1 000" on a Ukrainian machine and
              "1,000" under en-US (which is also what broke this in CI). */}
          <span>{graphemeCount} / {maxGraphemes.toLocaleString('uk-UA')}</span>
        </div>
      </div>
      <div className="text-input-footer">
        {/* Стоїть на місці колишньої «Вставити»: та кнопка прибрана з інтерфейсу,
            поки вирішується, чи повертати її (readTextFromClipboard і опис у
            документації лишилися).

            У спокої це коло 44×44 з піктограмою — четвертий підпис у цьому рядку
            не вміщався навіть на 360px. Під час запису та сама кнопка
            розтягується в рядок запису (точка, відлік, шкала гучності), а
            «Випадкова фраза» згортається до кубиків, звільняючи їй місце.
            Червоне тут — контур, точка й лінійка ліміту, а не заливка: залитої
            кнопки в цьому оформленні немає ніде. */}
        {voice && (
          <button
            type="button"
            className={clsx('text-input-mic-btn', `is-${voice.state}`)}
            /* Лінійка ліміту читає цю змінну в ::after — вона є лише під час запису. */
            style={voice.state === 'recording' ? ({ '--rec-progress': voice.progress } as CSSProperties) : undefined}
            onClick={voice.onToggle}
            aria-label={VOICE_LABELS[voice.state]}
            /* Кнопка-перемикач: скрінрідер має чути «увімкнено», а не лише новий підпис. */
            aria-pressed={voice.state === 'recording'}
            disabled={voice.state === 'processing' || (voice.state === 'idle' && graphemeCount >= maxGraphemes)}
            data-testid="mic-button"
          >
            {voice.state === 'recording' ? (
              /* aria-hidden на всьому вмісті: підпис кнопки вже сказав, що йде
                 запис, а секунда за секундою в aria-live була б спамом. */
              <>
                <span className="text-input-rec-dot" aria-hidden="true" />
                <span className="text-input-rec-time" aria-hidden="true">{formatElapsed(voice.elapsedSeconds)}</span>
                <VoiceMeter sampleLevel={voice.sampleLevel} />
              </>
            ) : voice.state === 'processing' ? (
              /* Пігулка лишається розгорнутою до транскрипту: інакше рядок
                 стрибнув би туди й назад двічі за одну дію. */
              <>
                <Loader2 className="spinning" size={18} aria-hidden="true" />
                <span className="text-input-rec-label" aria-hidden="true">Розпізнаю…</span>
              </>
            ) : voice.state === 'requesting' ? (
              <Loader2 className="spinning" size={18} />
            ) : (
              <Mic size={18} />
            )}
          </button>
        )}
        <button
          type="button"
          className={clsx('text-input-random-btn', isVoiceExpanded && 'is-collapsed')}
          onClick={onRandomPhrase}
          aria-label="Вставити випадкову фразу"
          disabled={isRandomPhraseDisabled}
        >
          <Dices size={18} />
          {/* Підпис згортається до нульової ширини, а не зникає з розмітки:
              так кнопка не перестрибує, а звужується до кубиків. */}
          <span className="text-input-random-btn-label">Випадкова фраза</span>
        </button>
        {/* Правий чип — один на всі стани: під час запису це «скасувати запис»,
            решту часу — «очистити», якщо є що очищати. Двох хрестиків поруч
            ніколи не буває. */}
        {voice?.state === 'recording' ? (
          <button
            type="button"
            className="text-input-cancel-btn"
            onClick={voice.onCancel}
            aria-label="Скасувати запис"
            data-testid="cancel-recording-button"
          >
            <X size={18} />
          </button>
        ) : value ? (
          <button
            type="button"
            className="text-input-clear-btn"
            onClick={() => onChange('')}
            aria-label="Очистити"
          >
            <X size={18} />
          </button>
        ) : null}
      </div>
    </div>
  );
}
