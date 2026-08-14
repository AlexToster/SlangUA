export type SamplePhraseCategory = 'daily' | 'study' | 'work' | 'tech' | 'social';

export interface SamplePhrase {
  id: string;
  text: string;
  category: SamplePhraseCategory;
}

const phraseStarts = [
  'Сьогодні варто', 'Зараз варто', 'Увечері варто', 'Зранку варто',
  'Перед сном варто', 'Після роботи варто', 'На вихідних варто', 'У вільну хвилину варто',
  'Цього тижня варто', 'Найближчим часом варто', 'Для себе варто', 'Іноді варто',
  'Спершу варто', 'Поки є час, варто', 'Коли зручно, варто', 'За нагоди варто',
  'Без поспіху варто', 'Для гарного настрою варто', 'У перерві варто', 'Перед зустріччю варто',
  'Після дзвінка варто', 'У дорозі варто', 'Вдома варто', 'На роботі варто',
  'Після навчання варто',
];

const phraseEnds = [
  'трохи відпочити.', 'доробити важливу справу.', 'зателефонувати друзям.',
  'спокійно випити кави.', 'записати нову ідею.', 'перевірити повідомлення.',
  'завершити невелике завдання.', 'зробити коротку перерву.', 'підготуватися до завтрашнього дня.',
  'знайти зручний час.', 'обговорити це разом.', 'оновити список справ.',
  'поділитися гарною новиною.', 'поставити слушне запитання.', 'уважно все переглянути.',
  'не поспішати з рішенням.', 'додати це до плану.', 'взяти з собою воду.',
  'вимкнути зайві сповіщення.', 'зробити день трохи кращим.',
];

const categories: SamplePhraseCategory[] = ['daily', 'study', 'work', 'tech', 'social'];

// 25 × 20 = 500 short local phrases. Categories are stored for future Settings filters.
export const samplePhrases: SamplePhrase[] = phraseStarts.flatMap((start, startIndex) =>
  phraseEnds.map((end, endIndex) => ({
    id: `sample-${startIndex + 1}-${endIndex + 1}`,
    text: `${start} ${end}`,
    category: categories[(startIndex + endIndex) % categories.length],
  })),
);

export function getRandomSamplePhrase(previousId: string | null): SamplePhrase {
  const availablePhrases = previousId
    ? samplePhrases.filter((phrase) => phrase.id !== previousId)
    : samplePhrases;

  return availablePhrases[Math.floor(Math.random() * availablePhrases.length)];
}
