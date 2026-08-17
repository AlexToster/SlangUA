import type { SlangStyle, Style } from '../types/api';

export const STYLE_LABELS: Record<SlangStyle, string> = {
  GEN_Z: 'Молодіжний тікток-сленг',
  STREET: 'Вуличний базар',
  IT_SLANG: 'АйТішний спіч',
  POFENI: 'Зеківський жаргон',
  KANCLER: 'Бюрократична радянщина',
  GALICIAN: 'Галицька ґвара',
};

export function getStyleLabel(style: SlangStyle): string {
  return STYLE_LABELS[style];
}

export function localizeStyles(styles: Style[]): Style[] {
  return styles.map((style) => ({ ...style, title: getStyleLabel(style.id) }));
}
