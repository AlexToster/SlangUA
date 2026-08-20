import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import type { Style, SlangStyle } from '../types/api';
import { getStyleLabel } from '../utils/styleLabels';
import { STYLE_ART, STYLE_ICONS } from '../utils/styleArt';
import clsx from 'clsx';
import './StyleDropdown.css';

// Must stay in sync with grid-template-columns in StyleDropdown.css (repeat(2, 1fr)).
const COLUMNS = 2;

// Панель — absolute всередині єдиного скрол-контейнера застосунку, тому все, що
// звисає нижче його краю, розширює прокручувану область і піднімає другу
// смугу прокрутки на головному вікні. Тому висоту панелі обмежуємо тим місцем,
// яке реально є під тригером, а всередині панель прокручується сама.
const PANEL_GAP = 8; // маленький відступ між низом панелі і смугою навігації
const PANEL_MIN_HEIGHT = 240; // якщо тригер майже внизу, панель не має стати нечитабельною

/**
 * Нижня межа вільного місця під елементом: край найближчого прокручуваного
 * предка (або вьюпорта).
 */
function scrollBoundaryBottom(element: HTMLElement): number {
  let bottom = window.innerHeight;
  for (let node = element.parentElement; node; node = node.parentElement) {
    const { overflowY } = getComputedStyle(node);
    if (overflowY === 'auto' || overflowY === 'scroll') {
      bottom = node.getBoundingClientRect().bottom;
      break;
    }
  }
  return bottom;
}

/**
 * Верхній край смуги навігації — друга межа для низу панелі: сітка мусить
 * закінчуватися над смугою, з невеликим відступом, щоб її закруглений нижній
 * край було видно. Міряємо саму смугу, а не читаємо --bottom-nav-height: так
 * значення правильне і коли смуги в DOM немає (тести рендерять компонент
 * окремо) — тоді межі просто немає.
 */
function navBoundaryTop(): number | null {
  const nav = document.querySelector('.bottom-nav');
  return nav ? nav.getBoundingClientRect().top : null;
}

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
  const [panelMaxHeight, setPanelMaxHeight] = useState<number | null>(null);
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

  // Прогріваємо кеш ілюстрацій один раз, коли сторінка вже осіла, щоб перший тап
  // по тригеру показував готові плитки. requestIdleCallback тримає це поза
  // критичним шляхом; Safari/старі WebView його не мають — фолбек на setTimeout.
  useEffect(() => {
    const warm = () => {
      for (const src of Object.values(STYLE_ART)) {
        const img = new Image();
        img.src = src;
      }
    };
    if (typeof window.requestIdleCallback === 'function') {
      const handle = window.requestIdleCallback(warm);
      return () => window.cancelIdleCallback?.(handle);
    }
    const timer = window.setTimeout(warm, 200);
    return () => window.clearTimeout(timer);
  }, []);

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

  // Міряємо доступну висоту під тригером, поки панель відкрита: на відкритті,
  // на resize (поява клавіатури) і на прокрутку контейнера — тригер при цьому
  // рухається, тож ліміт треба перерахувати. Низ панелі мусить лишитися вище
  // смуги навігації, з відступом PANEL_GAP: інакше її закруглений нижній край
  // ховається за смугою і сітка читається як обрізана.
  useEffect(() => {
    if (!isOpen) return;
    const measure = () => {
      const trigger = triggerRef.current;
      if (!trigger) return;
      const triggerBottom = trigger.getBoundingClientRect().bottom;
      const navTop = navBoundaryTop();
      const boundary = navTop === null
        ? scrollBoundaryBottom(trigger)
        : Math.min(scrollBoundaryBottom(trigger), navTop);
      const room = boundary - triggerBottom - PANEL_GAP;
      setPanelMaxHeight(Math.max(Math.round(room), PANEL_MIN_HEIGHT));
    };
    measure();
    window.addEventListener('resize', measure);
    window.addEventListener('scroll', measure, { capture: true, passive: true });
    return () => {
      window.removeEventListener('resize', measure);
      window.removeEventListener('scroll', measure, { capture: true });
    };
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

  // 2D navigation matching the 2-column grid: Left/Right move by one (wrap),
  // Down/Up move by COLUMNS (wrap). With six styles this cycles within a column.
  const handleListKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    switch (event.key) {
      case 'Escape':
        event.preventDefault();
        close(true);
        break;
      case 'Tab':
        close(false);
        break;
      case 'ArrowRight':
        event.preventDefault();
        if (styles.length > 0) setHighlightedIndex((index) => (index + 1) % styles.length);
        break;
      case 'ArrowLeft':
        event.preventDefault();
        if (styles.length > 0) setHighlightedIndex((index) => (index - 1 + styles.length) % styles.length);
        break;
      case 'ArrowDown':
        event.preventDefault();
        if (styles.length > 0) setHighlightedIndex((index) => (index + COLUMNS) % styles.length);
        break;
      case 'ArrowUp':
        event.preventDefault();
        if (styles.length > 0) setHighlightedIndex((index) => (index - COLUMNS + styles.length) % styles.length);
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
            /* Обгортка потрібна лише для кадрування: обличчя персонажа мусить
               стояти в колі й крупніше, ніж дає object-fit (133% з 4:3 у
               квадрат замість потрібних 185%). Зсув задають --fx/--fy у
               StyleDropdown.css, по парі на кожен стиль. */
            <span className="style-thumb-crop" data-style={selectedStyleObj.id}>
              <img
                className="style-dropdown-trigger-thumb"
                src={selectedArtSrc ?? undefined}
                alt=""
                aria-hidden="true"
                width={64}
                height={48}
                onError={() => setFailedArt((prev) => new Set(prev).add(selectedArtSrc as string))}
              />
            </span>
          ) : (
            SelectedIcon && <SelectedIcon className="style-dropdown-trigger-icon" size={20} aria-hidden="true" />
          ))}
        {/* data-style lets the stylesheet size individual labels: the two longest
            ones ("Молодіжний тікток-сленг", "Бюрократична радянщина") get one
            step smaller here so they are not clipped on the single-line trigger. */}
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
          style={
            panelMaxHeight !== null
              ? ({ '--style-dropdown-max-h': `${panelMaxHeight}px` } as React.CSSProperties)
              : undefined
          }
          role="listbox"
          tabIndex={-1}
          aria-label="Оберіть стиль перекладу"
          aria-activedescendant={highlightedStyle ? optionId(highlightedStyle.id) : undefined}
          onKeyDown={handleListKeyDown}
        >
          {styles.map((style, index) => {
            const ItemIcon = STYLE_ICONS[style.id];
            const itemArtSrc = STYLE_ART[style.id];
            const showItemArt = !failedArt.has(itemArtSrc);
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
                {showItemArt ? (
                  <img
                    className="style-dropdown-item-art"
                    src={itemArtSrc}
                    alt=""
                    aria-hidden="true"
                    width={240}
                    height={180}
                    loading="lazy"
                    decoding="async"
                    onError={() => setFailedArt((prev) => new Set(prev).add(itemArtSrc))}
                  />
                ) : (
                  <ItemIcon className="style-dropdown-item-icon" size={22} aria-hidden="true" />
                )}
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
