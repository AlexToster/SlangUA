import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const loaderPath = resolve(rootDir, 'dist', 'style-engine', 'loader.js');
const registryPath = resolve(rootDir, 'dist', 'style-engine', 'registry.json');
const { loadStyle, clearStyleEngineCache } = await import(pathToFileURL(loaderPath).href);

const styles = ['GEN_Z', 'STREET', 'IT_SLANG', 'POFENI', 'KANCLER'];

for (const style of styles) {
  const loaded = await loadStyle(style);
  assert.ok(loaded.systemPrompt.trim().length > 0, `${style} prompt must not be empty`);
}

const upper = await loadStyle('GEN_Z');
const lower = await loadStyle('gen_z');
assert.equal(upper.systemPrompt, lower.systemPrompt, 'Style IDs must be case-insensitive');
await assert.rejects(() => loadStyle('unknown_style'), /unknown_style/);

const originalRegistry = await readFile(registryPath, 'utf8');
try {
  const disabledRegistry = JSON.parse(originalRegistry);
  disabledRegistry.pofeni.enabled = false;
  await writeFile(registryPath, `${JSON.stringify(disabledRegistry, null, 2)}\n`, 'utf8');
  clearStyleEngineCache();
  await assert.rejects(() => loadStyle('pofeni'), /Unknown or disabled style/);
} finally {
  await writeFile(registryPath, originalRegistry, 'utf8');
  clearStyleEngineCache();
}

console.log('Style Engine build and runtime checks passed');
