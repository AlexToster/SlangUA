import { useEffect, useRef } from 'react';
import { X, ChevronDown, ChevronUp } from 'lucide-react';
import type { Style, SlangStyle } from '../types/api';
import { getStyleLabel } from '../utils/styleLabels';
import clsx from 'clsx';
import './StyleSelector.css';

interface StyleSelectorProps {
  styles: Style[];
  selectedStyle: SlangStyle | null;
  onSelect: (style: SlangStyle) => void;
  isOpen: boolean;
  onToggle: (open: boolean) => void;
  isLoading?: boolean;
  isError?: boolean;
  isAuthenticated?: boolean;
  onRetry?: () => void;
  lockedStyleIds?: SlangStyle[];
  onLockedSelect?: (style: SlangStyle) => void;
}

export function StyleSelector({
  styles,
  selectedStyle,
  onSelect,
  isOpen,
  onToggle,
  isLoading = false,
  isError = false,
  isAuthenticated = false,
  onRetry,
  lockedStyleIds = [],
  onLockedSelect,
}: StyleSelectorProps) {
  const buttonRef = useRef<HTMLButtonElement>(null);
  const sheetRef = useRef<HTMLDivElement>(null);

  // Close on outside click
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (buttonRef.current && !buttonRef.current.contains(event.target as Node) &&
          sheetRef.current && !sheetRef.current.contains(event.target as Node)) {
        onToggle(false);
      }
    }

    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isOpen, onToggle]);

  // Focus management
  useEffect(() => {
    if (isOpen) {
      // Focus first item or selected item
      const selectedItem = sheetRef.current?.querySelector('[aria-selected="true"]') as HTMLElement;
      const firstItem = sheetRef.current?.querySelector('[data-style-id]') as HTMLElement;
      (selectedItem || firstItem)?.focus();
    } else {
      buttonRef.current?.focus();
    }
  }, [isOpen]);

  const handleKeyDown = (event: React.KeyboardEvent, styleId: SlangStyle) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      if (lockedStyleIds.includes(styleId)) onLockedSelect?.(styleId);
      else onSelect(styleId);
      onToggle(false);
    } else if (event.key === 'Escape') {
      onToggle(false);
    }
  };

  const selectedStyleObj = styles.find(s => s.id === selectedStyle);

  return (
    <div className="style-selector">
      <button
        ref={buttonRef}
        className={clsx('style-selector-button', isOpen && 'open')}
        onClick={() => onToggle(!isOpen)}
        aria-expanded={isOpen}
        aria-haspopup="listbox"
        aria-label={`Вибраний стиль: ${selectedStyleObj ? getStyleLabel(selectedStyleObj.id) : 'не вибрано'}`}
      >
        <span className="style-selector-label">
          {selectedStyleObj ? getStyleLabel(selectedStyleObj.id) : 'Стиль'}
        </span>
        {isOpen ? <ChevronUp className="style-selector-icon" /> : <ChevronDown className="style-selector-icon" />}
      </button>

      {isOpen && (
        <div className="style-selector-overlay" onMouseDown={() => onToggle(false)}>
          <div
            ref={sheetRef}
            className="style-selector-sheet"
            role="listbox"
            aria-label="Оберіть стиль перекладу"
            onMouseDown={(event) => event.stopPropagation()}
            onKeyDown={(event) => {
              if (event.key === 'Escape') {
                event.preventDefault();
                onToggle(false);
              }
            }}
          >
          <div className="style-selector-sheet-header">
            <h3>Оберіть стиль</h3>
            <button
              className="style-selector-close"
              onClick={() => onToggle(false)}
              aria-label="Закрити"
            >
              <X size={20} />
            </button>
            </div>
            <div className="style-selector-list">
              {isLoading && (
                <p className="style-selector-state" role="status">Завантажуємо стилі…</p>
              )}
              {!isLoading && styles.length === 0 && (
                <div className="style-selector-state" role={isError ? 'alert' : undefined}>
                  <p>
                    {isAuthenticated
                      ? 'Не вдалося завантажити стилі.'
                      : 'Відкрий застосунок у Telegram, щоб завантажити стилі.'}
                  </p>
                  {isAuthenticated && onRetry && (
                    <button className="style-selector-retry" type="button" onClick={onRetry}>
                      Спробувати ще раз
                    </button>
                  )}
                </div>
              )}
              {!isLoading && styles.map((style) => (
              <button
                key={style.id}
                className={clsx('style-selector-item', style.id === selectedStyle && 'selected', lockedStyleIds.includes(style.id) && 'locked')}
                role="option"
                aria-selected={style.id === selectedStyle}
                data-style-id={style.id}
                onClick={() => {
                  if (lockedStyleIds.includes(style.id)) onLockedSelect?.(style.id);
                  else onSelect(style.id);
                  onToggle(false);
                }}
                onKeyDown={(e) => handleKeyDown(e, style.id)}
              >
                <span className="style-selector-item-title">{getStyleLabel(style.id)}</span>
                {lockedStyleIds.includes(style.id) && <span className="style-selector-lock">18+</span>}
                {style.id === selectedStyle && (
                  <span className="style-selector-check" aria-hidden="true">✓</span>
                )}
              </button>
            ))}
          </div>
          </div>
        </div>
      )}
    </div>
  );
}
