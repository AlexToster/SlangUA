import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ChevronDown } from 'lucide-react';
import clsx from 'clsx';
import './SelectField.css';

export interface SelectFieldOption<T extends string> {
  value: T;
  label: string;
}

interface SelectFieldProps<T extends string> {
  value: T;
  options: SelectFieldOption<T>[];
  onChange: (value: T) => void;
  /** Accessible name for the trigger. */
  label: string;
  disabled?: boolean;
  className?: string;
}

interface PanelRect {
  left: number;
  width: number;
  top?: number;
  bottom?: number;
}

const PANEL_GAP = 4;

/**
 * Themed replacement for a native <select>.
 *
 * A native option list is drawn by the OS: on a dark Telegram theme it opens as
 * a white system popup (reported bug). This renders its own listbox from the
 * same --tg-* variables as the rest of the app.
 *
 * The panel goes through a portal with position: fixed, because its parents
 * (.settings-main, .history-list) use overflow-y: auto and would clip an
 * absolutely positioned panel.
 */
export function SelectField<T extends string>({
  value,
  options,
  onChange,
  label,
  disabled = false,
  className,
}: SelectFieldProps<T>) {
  const [isOpen, setIsOpen] = useState(false);
  const [highlightedIndex, setHighlightedIndex] = useState(-1);
  const [rect, setRect] = useState<PanelRect | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const listId = useId();
  const optionId = (optionValue: string) => `${listId}-${optionValue}`;

  const selectedIndex = options.findIndex((option) => option.value === value);
  const selected = selectedIndex >= 0 ? options[selectedIndex] : undefined;

  const close = useCallback((returnFocus: boolean) => {
    setIsOpen(false);
    setHighlightedIndex(-1);
    if (returnFocus) triggerRef.current?.focus();
  }, []);

  const measure = useCallback(() => {
    const trigger = triggerRef.current;
    if (!trigger) return;
    const box = trigger.getBoundingClientRect();
    const spaceBelow = window.innerHeight - box.bottom;
    // Flip upwards when the option list would not fit below the trigger.
    if (spaceBelow < 200 && box.top > spaceBelow) {
      setRect({ left: box.left, width: box.width, bottom: window.innerHeight - box.top + PANEL_GAP });
    } else {
      setRect({ left: box.left, width: box.width, top: box.bottom + PANEL_GAP });
    }
  }, []);

  const open = useCallback(() => {
    if (disabled || options.length === 0) return;
    measure();
    setHighlightedIndex(selectedIndex >= 0 ? selectedIndex : 0);
    setIsOpen(true);
  }, [disabled, measure, options.length, selectedIndex]);

  useLayoutEffect(() => {
    if (isOpen) measure();
  }, [isOpen, measure]);

  // The list takes focus so Escape and the arrow keys reach it
  // (aria-activedescendant pattern, same as StyleDropdown).
  useEffect(() => {
    if (isOpen) listRef.current?.focus();
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    const onPointerDown = (event: MouseEvent) => {
      const target = event.target as Node;
      if (listRef.current?.contains(target) || triggerRef.current?.contains(target)) return;
      close(false);
    };
    const reposition = () => close(false);
    document.addEventListener('mousedown', onPointerDown);
    window.addEventListener('resize', reposition);
    // Scrolling would detach a fixed panel from its trigger; close instead.
    window.addEventListener('scroll', reposition, true);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      window.removeEventListener('resize', reposition);
      window.removeEventListener('scroll', reposition, true);
    };
  }, [isOpen, close]);

  const select = (next: T) => {
    onChange(next);
    close(true);
  };

  const handleTriggerKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>) => {
    if (isOpen) return;
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      open();
    }
  };

  const handleListKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    switch (event.key) {
      case 'Escape':
        event.preventDefault();
        close(true);
        break;
      case 'Tab':
        close(false);
        break;
      case 'ArrowDown':
        event.preventDefault();
        setHighlightedIndex((index) => (index + 1) % options.length);
        break;
      case 'ArrowUp':
        event.preventDefault();
        setHighlightedIndex((index) => (index <= 0 ? options.length - 1 : index - 1));
        break;
      case 'Home':
        event.preventDefault();
        setHighlightedIndex(0);
        break;
      case 'End':
        event.preventDefault();
        setHighlightedIndex(options.length - 1);
        break;
      case 'Enter':
      case ' ': {
        event.preventDefault();
        const option = options[highlightedIndex];
        if (option) select(option.value);
        break;
      }
      default:
        break;
    }
  };

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className={clsx('select-field', isOpen && 'open', className)}
        onClick={() => (isOpen ? close(true) : open())}
        onKeyDown={handleTriggerKeyDown}
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={isOpen}
        aria-controls={listId}
        aria-label={`${label}: ${selected?.label ?? 'не вибрано'}`}
      >
        <span className="select-field-value">{selected?.label ?? '—'}</span>
        <ChevronDown className={clsx('select-field-chevron', isOpen && 'open')} size={18} aria-hidden="true" />
      </button>

      {isOpen && rect && createPortal(
        <div
          ref={listRef}
          id={listId}
          className="select-field-panel"
          role="listbox"
          tabIndex={-1}
          aria-label={label}
          aria-activedescendant={highlightedIndex >= 0 ? optionId(options[highlightedIndex].value) : undefined}
          onKeyDown={handleListKeyDown}
          style={{
            left: rect.left,
            width: rect.width,
            ...(rect.top !== undefined ? { top: rect.top } : { bottom: rect.bottom }),
          }}
        >
          {options.map((option, index) => (
            <button
              key={option.value}
              id={optionId(option.value)}
              type="button"
              tabIndex={-1}
              role="option"
              aria-selected={option.value === value}
              className={clsx(
                'select-field-option',
                option.value === value && 'selected',
                index === highlightedIndex && 'highlighted',
              )}
              onClick={() => select(option.value)}
              onMouseEnter={() => setHighlightedIndex(index)}
            >
              <span className="select-field-option-label">{option.label}</span>
              {option.value === value && <span className="select-field-check" aria-hidden="true">✓</span>}
            </button>
          ))}
        </div>,
        document.body,
      )}
    </>
  );
}

export default SelectField;
