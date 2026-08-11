export function countGraphemes(text: string): number {
  if (!text) return 0;
  const segmenter = new Intl.Segmenter('uk', { granularity: 'grapheme' });
  return Array.from(segmenter.segment(text)).length;
}

export function truncateToGraphemes(text: string, maxGraphemes: number): string {
  if (!text) return '';
  const segmenter = new Intl.Segmenter('uk', { granularity: 'grapheme' });
  const segments = Array.from(segmenter.segment(text));
  if (segments.length <= maxGraphemes) return text;
  return segments.slice(0, maxGraphemes).map(s => s.segment).join('');
}