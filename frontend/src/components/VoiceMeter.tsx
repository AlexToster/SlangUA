import { useEffect, useRef } from 'react';
import './VoiceMeter.css';

/** Скільком смужкам вистачає місця в пігулці запису на 360px. */
const BAR_COUNT = 14;

/** ~15 кадрів на секунду. Голос на око не рухається швидше, а зайві кадри — це
    зайва робота на телефоні, який одночасно пише звук. */
const FRAME_MS = 66;

/** Скільки дискретних висот має смужка. */
const STEPS = 5;

/** Висота смужки в тишині — рядок точок, а не порожнє місце. */
const REST_SCALE = 0.12;

/** Висота, на якій смужки застигають, коли анімації вимкнені системою. */
const STILL_SCALE = 0.5;

interface VoiceMeterProps {
  /** Поточний рівень 0…1. Викликається на власному кадрі, а не в рендері. */
  sampleLevel: () => number;
  barCount?: number;
}

/**
 * Шкала гучності в пігулці запису.
 *
 * Єдиний елемент інтерфейсу, який відрізняє «йде запис» від «дозвіл є, але
 * мікрофон нічого не чує» — вимкнений мікрофон гарнітури або той самий дозвіл,
 * відкликаний системою. Для якості розпізнавання рівень не важить: модель
 * нормалізує вхід сама.
 *
 * React у гарячому шляху не бере участі: висоти смужок пишуться в CSS-змінні
 * через рефи, тому рядок редактора не перемальовується п'ятнадцять разів на
 * секунду. Компонент існує лише поки триває запис.
 */
export function VoiceMeter({ sampleLevel, barCount = BAR_COUNT }: VoiceMeterProps) {
  const barsRef = useRef<(HTMLSpanElement | null)[]>([]);

  // Той самий прийом, що в useAudioRecorder: цикл живе довше за рендер, який
  // його запустив, тому колбек читається з рефа.
  const sampleRef = useRef(sampleLevel);
  useEffect(() => {
    sampleRef.current = sampleLevel;
  });

  useEffect(() => {
    const write = (index: number, level: number) => {
      // П'ять дискретних висот, а не плавна шкала: у різографі немає градієнта,
      // і квантована смужка читається як надрукована, а не як скляний
      // еквалайзер.
      const step = Math.round(level * (STEPS - 1)) / (STEPS - 1);
      const scale = REST_SCALE + (1 - REST_SCALE) * step;
      barsRef.current[index]?.style.setProperty('--bar', String(scale));
    };

    const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
    if (reducedMotion) {
      // Нерухома шкала на півдорозі: рухати нічого не можна, але порожній рядок
      // читався б як зламаний мікрофон.
      for (let index = 0; index < barCount; index += 1) {
        barsRef.current[index]?.style.setProperty('--bar', String(STILL_SCALE));
      }
      return;
    }

    const levels = new Array<number>(barCount).fill(0);
    for (let index = 0; index < barCount; index += 1) write(index, 0);

    // jsdom і старі WebView без rAF просто лишаються з рядком у стані тиші.
    if (typeof window.requestAnimationFrame !== 'function') return;

    let frame = 0;
    let paintedAt = 0;
    const paint = (now: number) => {
      frame = window.requestAnimationFrame(paint);
      if (now - paintedAt < FRAME_MS) return;
      paintedAt = now;

      // Нове значення заходить праворуч, старі зсуваються вліво — доріжка
      // біжить у той бік, у який іде час.
      levels.shift();
      levels.push(sampleRef.current());
      for (let index = 0; index < levels.length; index += 1) write(index, levels[index]);
    };

    frame = window.requestAnimationFrame(paint);
    return () => window.cancelAnimationFrame(frame);
  }, [barCount]);

  return (
    <span className="voice-meter" aria-hidden="true" data-testid="voice-meter">
      {Array.from({ length: barCount }, (_, index) => (
        <span
          key={index}
          className="voice-meter-bar"
          ref={(node) => {
            barsRef.current[index] = node;
          }}
        />
      ))}
    </span>
  );
}
