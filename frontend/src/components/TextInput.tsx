import { useRef, useEffect } from 'react';
import { Mic, Square, Dices, X, AlertCircle, Loader2 } from 'lucide-react';
import clsx from 'clsx';
import './TextInput.css';

/** What the microphone shows; `undefined` for the whole prop means no microphone. */
export type VoiceInputState = 'idle' | 'requesting' | 'recording' | 'processing';

export interface VoiceInputControl {
  state: VoiceInputState;
  /** Countdown shown on the button while recording; `null` at every other time. */
  remainingSeconds: number | null;
  onToggle: () => void;
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
            документації лишилися). Тільки піктограма — четвертий підпис у цьому
            рядку не вміщався навіть на 360px. */}
        {voice && (
          <button
            type="button"
            className={clsx('text-input-mic-btn', `is-${voice.state}`)}
            onClick={voice.onToggle}
            aria-label={VOICE_LABELS[voice.state]}
            /* Кнопка-перемикач: скрінрідер має чути «увімкнено», а не лише новий підпис. */
            aria-pressed={voice.state === 'recording'}
            disabled={voice.state === 'processing' || (voice.state === 'idle' && graphemeCount >= maxGraphemes)}
            data-testid="mic-button"
          >
            {voice.state === 'processing' ? (
              <Loader2 className="spinning" size={18} />
            ) : voice.state === 'recording' ? (
              <Square size={18} />
            ) : (
              <Mic size={18} />
            )}
            {/* Лічильник у куті кнопки, а не окремим елементом рядка: власної
                ширини він не займає. aria-hidden — підпис кнопки вже сказав, що
                йде запис, а секунда за секундою в aria-live була б спамом. */}
            {voice.state === 'recording' && voice.remainingSeconds !== null && (
              <span className="text-input-mic-timer" aria-hidden="true">{voice.remainingSeconds}</span>
            )}
          </button>
        )}
        <button
          type="button"
          className="text-input-random-btn"
          onClick={onRandomPhrase}
          aria-label="Вставити випадкову фразу"
          disabled={isRandomPhraseDisabled}
        >
          <Dices size={18} />
          <span>Випадкова фраза</span>
        </button>
        {value && (
          <button
            type="button"
            className="text-input-clear-btn"
            onClick={() => onChange('')}
            aria-label="Очистити"
          >
            <X size={18} />
          </button>
        )}
      </div>
    </div>
  );
}
