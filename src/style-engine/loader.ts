import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

export interface LoadedStyle {
  systemPrompt: string;
}

/**
 * Вибір способу читання JSON-файлів:
 * Використовуємо fs.readFile + JSON.parse замість прямого імпорту
 * (`import data from './registry.json' with { type: 'json' }`).
 *
 * Причина: прямий імпорт JSON у NodeNext/ESM вимагає атрибута
 * `with { type: 'json' }`, який по-різному підтримується в tsx (dev)
 * і в tsc + node (build), а також залежить від версії Node. Крім того,
 * tsc копіює імпортовані .json у dist лише якщо вони включені в
 * компіляцію, що робить поведінку менш передбачуваною. fs.readFile
 * працює ідентично в dev і в build, і тримає loader.ts єдиною точкою
 * читання файлів style-engine (відповідає Definition of Done §8).
 *
 * .md-файли (base-rules.md, prompt.md) у будь-якому разі читаються
 * через fs.readFile, оскільки tsconfig не резолвить .md.
 */

const STYLE_DIR = join(__dirname, 'styles');
const BASE_RULES_PATH = join(__dirname, 'base-rules.md');
const REGISTRY_PATH = join(__dirname, 'registry.json');

export interface RegistryEntry {
  id: string;
  title: string;
  enabled: boolean;
  version: string;
  ageRestricted: boolean;
}

interface Lexicon {
  preferred: string[];
  forbidden: string[];
}

interface Example {
  before: string;
  after: string;
}

async function readJson<T>(path: string): Promise<T> {
  const raw = await readFile(path, 'utf-8');
  return JSON.parse(raw) as T;
}

export async function loadRegistry(): Promise<Record<string, RegistryEntry>> {
  return readJson<Record<string, RegistryEntry>>(REGISTRY_PATH);
}

function assertStyleEnabled(
  styleId: string,
  normalizedId: string,
  entry: RegistryEntry | undefined,
  registry: Record<string, RegistryEntry>,
): asserts entry is RegistryEntry {
  if (!entry || !entry.enabled) {
    throw new Error(
      `Unknown or disabled style: "${styleId}" (normalized: "${normalizedId}"). Available: ${Object.keys(registry).join(', ')}`,
    );
  }
}

export async function loadStyle(styleId: string): Promise<LoadedStyle> {
  // Крок 0: base-rules.md — перший блок.
  const baseRules = await readFile(BASE_RULES_PATH, 'utf-8');

  // Крок 1: нормалізація styleId до нижнього регістру.
  const normalizedId = styleId.toLowerCase();

  // Крок 2: registry.json — пошук запису за нормалізованим id.
  const registry = await loadRegistry();
  const entry = registry[normalizedId];
  assertStyleEnabled(styleId, normalizedId, entry, registry);

  const styleDir = join(STYLE_DIR, normalizedId);

  // Крок 3: prompt.md — основа systemPrompt.
  const prompt = await readFile(join(styleDir, 'prompt.md'), 'utf-8');

  // Кроки 4–5: lexicon.json — preferred і forbidden.
  const lexicon = await readJson<Lexicon>(join(styleDir, 'lexicon.json'));
  const preferredLine = `Використовуй слова: ${lexicon.preferred.join(', ')}`;
  const forbiddenLine = `Уникай слів: ${lexicon.forbidden.join(', ')}`;

  // Крок 6: examples.json — кожен приклад окремим рядком.
  const examples = await readJson<Example[]>(join(styleDir, 'examples.json'));
  const exampleLines = examples.map(
    (example) => `Приклад: "${example.before}" → "${example.after}"`,
  );

  // Крок 7: з'єднання блоків (1 порожній рядок між блоками).
  const blocks = [
    baseRules,
    prompt,
    preferredLine,
    forbiddenLine,
    ...exampleLines,
  ];
  const systemPrompt = blocks.join('\n\n');

  return { systemPrompt };
}

export async function getStyleMetadata(styleId: string): Promise<RegistryEntry> {
  const normalizedId = styleId.toLowerCase();
  const registry = await loadRegistry();
  const entry = registry[normalizedId];
  assertStyleEnabled(styleId, normalizedId, entry, registry);
  return entry;
}
