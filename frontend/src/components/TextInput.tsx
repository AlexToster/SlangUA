import { useRef, useEffect } from 'react';
import { Clipboard, Dices, X, AlertCircle } from 'lucide-react';
import clsx from 'clsx';
import './TextInput.css';

interface TextInputProps {
  value: string;
  onChange: (text: string) => void;
  onPaste: () => void;
  onRandomPhrase: () => void;
  isRandomPhraseDisabled: boolean;
  graphemeCount: number;
  maxGraphemes: number;
  isWarningZone: boolean;
  isOverLimit: boolean;
  placeholder: string;
}

export function TextInput({ value, onChange, onPaste, onRandomPhrase, isRandomPhraseDisabled, graphemeCount, maxGraphemes, isWarningZone, isOverLimit, placeholder }: TextInputProps) {
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
        <button
          type="button"
          className="text-input-paste-btn"
          onClick={onPaste}
          aria-label="Вставити з буфера обміну"
          disabled={graphemeCount >= maxGraphemes}
        >
          <Clipboard size={18} />
          <span>Вставити</span>
        </button>
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
