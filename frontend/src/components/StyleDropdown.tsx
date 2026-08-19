import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import type { Style, SlangStyle } from '../types/api';
import { getStyleLabel } from '../utils/styleLabels';
import { STYLE_ART, STYLE_ICONS } from '../utils/styleArt';
import clsx from 'clsx';
import './StyleDropdown.css';

interface StyleDropdownProps {
  styles: Style[];
  selectedStyle: SlangStyle | null;
  onSelect: (style: SlangStyle) => void;
  lockedStyleIds?: SlangStyle[];
  onLockedSelect?: (style: SlangStyle) => void;
}

export function StyleDropdown({
  styles,
  selectedStyle,
  onSelect,
  lockedStyleIds = [],
  onLockedSelect,
}: StyleDropdownProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [highlightedIndex, setHighlightedIndex] = useState(-1);
  // Якщо ілюстрація стилю не завантажилась, відкочуємось на lucide-іконку.
  // Зберігаємо set невдалих src; скидаємо його при зміні вибраного стилю.
  const [failedArt, setFailedArt] = useState<Set<string>>(() => new Set());
  const wrapperRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const listId = useId();
  const optionId = (style: SlangStyle) => `${listId}-${style}`;

  const close = useCallback((returnFocus: boolean) => {
    setIsOpen(false);
    setHighlightedIndex(-1);
    if (returnFocus) triggerRef.current?.focus();
  }, []);

  const open = useCallback((index: number) => {
    setHighlightedIndex(index);
    setIsOpen(true);
  }, []);

  // Новий стиль — нова спроба завантажити його ілюстрацію.
  useEffect(() => {
    setFailedArt(new Set());
  }, [selectedStyle]);

  // Close on outside click
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (wrapperRef.current && !wrapperRef.current.contains(event.target as Node)) {
        close(false);
      }
    }

    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isOpen, close]);

  // The list itself takes focus so Escape and the arrow keys reach it (aria-activedescendant pattern).
  useEffect(() => {
    if (isOpen) listRef.current?.focus();
  }, [isOpen]);

  // Keep the highlighted option inside the scrollable panel.
  useEffect(() => {
    if (!isOpen || highlightedIndex < 0) return;
    const option = listRef.current?.children[highlightedIndex] as HTMLElement | undefined;
    option?.scrollIntoView({ block: 'nearest' });
  }, [isOpen, highlightedIndex]);

  const handleSelect = (style: SlangStyle) => {
    if (lockedStyleIds.includes(style)) {
      onLockedSelect?.(style);
    } else {
      onSelect(style);
    }
    close(true);
  };

  const selectedIndex = styles.findIndex((s) => s.id === selectedStyle);

  const handleTriggerClick = () => {
    if (isOpen) close(true);
    else open(selectedIndex >= 0 ? selectedIndex : 0);
  };

  const handleTriggerKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>) => {
    if (event.key === 'Escape' && isOpen) {
      event.preventDefault();
      close(true);
      return;
    }
    if (isOpen || styles.length === 0) return;
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      open(selectedIndex >= 0 ? selectedIndex : 0);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      open(selectedIndex >= 0 ? selectedIndex : styles.length - 1);
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
        if (styles.length > 0) setHighlightedIndex((index) => (index + 1) % styles.length);
        break;
      case 'ArrowUp':
        event.preventDefault();
        if (styles.length > 0) setHighlightedIndex((index) => (index <= 0 ? styles.length - 1 : index - 1));
        break;
      case 'Home':
        event.preventDefault();
        if (styles.length > 0) setHighlightedIndex(0);
        break;
      case 'End':
        event.preventDefault();
        if (styles.length > 0) setHighlightedIndex(styles.length - 1);
        break;
      case 'Enter':
      case ' ': {
        event.preventDefault();
        const style = styles[highlightedIndex];
        if (style) handleSelect(style.id);
        break;
      }
      default:
        break;
    }
  };

  const selectedStyleObj = styles.find((s) => s.id === selectedStyle);
  const SelectedIcon = selectedStyleObj ? STYLE_ICONS[selectedStyleObj.id] : null;
  const selectedArtSrc = selectedStyleObj ? STYLE_ART[selectedStyleObj.id] : null;
  const showThumb = selectedArtSrc !== null && !failedArt.has(selectedArtSrc);
  const highlightedStyle = highlightedIndex >= 0 ? styles[highlightedIndex] : undefined;

  return (
    <div className="style-dropdown" ref={wrapperRef}>
      <button
        ref={triggerRef}
        type="button"
        className={clsx('style-dropdown-trigger', isOpen && 'open')}
        onClick={handleTriggerClick}
        onKeyDown={handleTriggerKeyDown}
        aria-expanded={isOpen}
        aria-haspopup="listbox"
        aria-controls={listId}
        aria-label={`Вибраний стиль: ${selectedStyleObj ? getStyleLabel(selectedStyleObj.id) : 'не вибрано'}`}
      >
        {selectedStyleObj &&
          (showThumb ? (
            <img
              className="style-dropdown-trigger-thumb"
              src={selectedArtSrc ?? undefined}
              alt=""
              aria-hidden="true"
              onError={() => setFailedArt((prev) => new Set(prev).add(selectedArtSrc as string))}
            />
          ) : (
            SelectedIcon && <SelectedIcon className="style-dropdown-trigger-icon" size={20} aria-hidden="true" />
          ))}
        {/* data-style lets the stylesheet size individual labels: the longest one
            ("Бюрократична радянщина") gets one step smaller so it is not clipped. */}
        <span className="style-dropdown-label" data-style={selectedStyleObj?.id}>
          {selectedStyleObj ? getStyleLabel(selectedStyleObj.id) : 'Оберіть стиль'}
        </span>
        <ChevronDown className={clsx('style-dropdown-chevron', isOpen && 'open')} size={20} aria-hidden="true" />
      </button>

      {isOpen && (
        <div
          ref={listRef}
          id={listId}
          className="style-dropdown-panel"
          role="listbox"
          tabIndex={-1}
          aria-label="Оберіть стиль перекладу"
          aria-activedescendant={highlightedStyle ? optionId(highlightedStyle.id) : undefined}
          onKeyDown={handleListKeyDown}
        >
          {styles.map((style, index) => {
            const ItemIcon = STYLE_ICONS[style.id];
            const isLocked = lockedStyleIds.includes(style.id);
            const isSelected = style.id === selectedStyle;
            return (
              <button
                key={style.id}
                id={optionId(style.id)}
                type="button"
                tabIndex={-1}
                className={clsx(
                  'style-dropdown-item',
                  isSelected && 'selected',
                  isLocked && 'locked',
                  index === highlightedIndex && 'highlighted'
                )}
                role="option"
                aria-selected={isSelected}
                onClick={() => handleSelect(style.id)}
                onMouseEnter={() => setHighlightedIndex(index)}
              >
                <ItemIcon className="style-dropdown-item-icon" size={22} aria-hidden="true" />
                <span className="style-dropdown-item-title" data-style={style.id}>{getStyleLabel(style.id)}</span>
                {isLocked && <span className="style-dropdown-lock">18+</span>}
                {isSelected && (
                  <span className="style-dropdown-check" aria-hidden="true">✓</span>
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

export default StyleDropdown;
