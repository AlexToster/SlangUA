import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';
import { SLANG_STYLE_VALUES } from '../constants/index.js';

export interface LoadedStyle {
  systemPrompt: string;
}

const STYLE_DIR = join(__dirname, 'styles');
const BASE_RULES_PATH = join(__dirname, 'base-rules.md');
const REGISTRY_PATH = join(__dirname, 'registry.json');

const registryEntrySchema = z.object({
  id: z.string().regex(/^[a-z0-9_]+$/),
  title: z.string().min(1),
  enabled: z.boolean(),
  version: z.string().min(1),
  ageRestricted: z.boolean(),
}).strict();

const registrySchema = z.record(registryEntrySchema).superRefine((registry, ctx) => {
  const expected = new Set(SLANG_STYLE_VALUES.map((style) => style.toLowerCase()));
  const received = new Set(Object.keys(registry));

  for (const [key, entry] of Object.entries(registry)) {
    if (key !== entry.id) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: [key, 'id'], message: 'Registry key must match entry.id' });
    }
    if (!expected.has(key)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: [key], message: `Unknown Prisma SlangStyle: ${key}` });
    }
  }
  for (const style of expected) {
    if (!received.has(style)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: `Missing Prisma SlangStyle in registry: ${style}` });
    }
  }
});

const lexiconSchema = z.object({
  preferred: z.array(z.string().min(1)),
  forbidden: z.array(z.string().min(1)),
}).strict();

const examplesSchema = z.array(z.object({
  before: z.string().min(1),
  after: z.string().min(1),
}).strict());

export type RegistryEntry = z.infer<typeof registryEntrySchema>;

interface StyleEngineSnapshot {
  registry: Readonly<Record<string, RegistryEntry>>;
  styles: Readonly<Record<string, LoadedStyle>>;
}

let snapshotPromise: Promise<StyleEngineSnapshot> | undefined;

async function readJson(path: string): Promise<unknown> {
  try {
    return JSON.parse(await readFile(path, 'utf-8'));
  } catch (error) {
    throw new Error(`Invalid JSON in Style Engine file ${path}`, { cause: error });
  }
}

async function readNonEmptyFile(path: string): Promise<string> {
  const content = await readFile(path, 'utf-8');
  if (!content.trim()) throw new Error(`Style Engine file is empty: ${path}`);
  return content;
}

async function buildSnapshot(): Promise<StyleEngineSnapshot> {
  const baseRules = await readNonEmptyFile(BASE_RULES_PATH);
  const registry = registrySchema.parse(await readJson(REGISTRY_PATH));
  const styles: Record<string, LoadedStyle> = {};

  for (const [styleId, entry] of Object.entries(registry)) {
    const styleDir = join(STYLE_DIR, styleId);
    const [prompt, rawLexicon, rawExamples] = await Promise.all([
      readNonEmptyFile(join(styleDir, 'prompt.md')),
      readJson(join(styleDir, 'lexicon.json')),
      readJson(join(styleDir, 'examples.json')),
    ]);
    const lexicon = lexiconSchema.parse(rawLexicon);
    const examples = examplesSchema.parse(rawExamples);
    const blocks = [
      baseRules,
      prompt,
      // An empty list must never reach the model: "Avoid these words:" with
      // nothing after it is noise at best, and an invitation to invent the list
      // at worst. Three styles shipped with an empty `forbidden` and carried
      // that dangling line into every prompt.
      ...(lexicon.preferred.length > 0 ? [`Use these words where natural: ${lexicon.preferred.join(', ')}`] : []),
      ...(lexicon.forbidden.length > 0 ? [`Avoid these words: ${lexicon.forbidden.join(', ')}`] : []),
      ...examples.map((example) => `Example: "${example.before}" → "${example.after}"`),
    ];
    styles[styleId] = { systemPrompt: blocks.join('\n\n') };
  }

  return {
    registry: Object.freeze(registry),
    styles: Object.freeze(styles),
  };
}

/** Preload all static Style Engine assets. Call during application startup. */
export async function initializeStyleEngine(): Promise<void> {
  if (!snapshotPromise) snapshotPromise = buildSnapshot();
  try {
    await snapshotPromise;
  } catch (error) {
    snapshotPromise = undefined;
    throw error;
  }
}

/** Test-only / controlled-reload cache reset. Normal request handling never reloads files. */
export function clearStyleEngineCache(): void {
  snapshotPromise = undefined;
}

async function getSnapshot(): Promise<StyleEngineSnapshot> {
  await initializeStyleEngine();
  return snapshotPromise!;
}

function assertStyleEnabled(styleId: string, normalizedId: string, entry: RegistryEntry | undefined, registry: Readonly<Record<string, RegistryEntry>>): asserts entry is RegistryEntry {
  if (!entry || !entry.enabled) {
    throw new Error(`Unknown or disabled style: "${styleId}" (normalized: "${normalizedId}"). Available: ${Object.keys(registry).join(', ')}`);
  }
}

export async function loadRegistry(): Promise<Readonly<Record<string, RegistryEntry>>> {
  return (await getSnapshot()).registry;
}

export async function loadStyle(styleId: string): Promise<LoadedStyle> {
  const normalizedId = styleId.toLowerCase();
  const { registry, styles } = await getSnapshot();
  const entry = registry[normalizedId];
  assertStyleEnabled(styleId, normalizedId, entry, registry);
  return styles[normalizedId]!;
}

export async function getStyleMetadata(styleId: string): Promise<RegistryEntry> {
  const normalizedId = styleId.toLowerCase();
  const { registry } = await getSnapshot();
  const entry = registry[normalizedId];
  assertStyleEnabled(styleId, normalizedId, entry, registry);
  return entry;
}
