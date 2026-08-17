import assert from 'node:assert/strict';
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const styleEngineDir = resolve(rootDir, 'dist', 'style-engine');
const loaderPath = join(styleEngineDir, 'loader.js');
const { loadStyle } = await import(pathToFileURL(loaderPath).href);

const styles = ['GEN_Z', 'STREET', 'IT_SLANG', 'POFENI', 'KANCLER', 'GALICIAN'];

for (const style of styles) {
  const loaded = await loadStyle(style);
  assert.ok(loaded.systemPrompt.trim().length > 0, `${style} prompt must not be empty`);
}

const upper = await loadStyle('GEN_Z');
const lower = await loadStyle('gen_z');
assert.equal(upper.systemPrompt, lower.systemPrompt, 'Style IDs must be case-insensitive');
await assert.rejects(() => loadStyle('unknown_style'), /unknown_style/);

/**
 * The disabled-style check needs a registry where a style is off. It used to
 * overwrite dist/style-engine/registry.json and restore it in a `finally`, which
 * left the real build output broken whenever the process was killed mid-run
 * (Ctrl+C, a failing assertion in a watch loop, CI timeout) - and that file is
 * what `npm start` serves.
 *
 * Instead the whole style-engine directory is copied next to the original. The
 * copy sits inside dist/, so the loader's `../constants/index.js` import and
 * node_modules resolution still work, while `__dirname` points at the copy - so
 * registry.json, base-rules.md and styles/ all come from throwaway files. A
 * separate module path also means a separate snapshot cache, so no reset is
 * needed. Worst case, a crash leaves a temp directory in dist/, never a
 * corrupted registry.
 */
const scratchDir = await mkdtemp(join(rootDir, 'dist', 'style-engine-verify-'));
try {
  await cp(styleEngineDir, scratchDir, { recursive: true });
  const scratchRegistryPath = join(scratchDir, 'registry.json');
  const registry = JSON.parse(await readFile(scratchRegistryPath, 'utf8'));
  registry.pofeni.enabled = false;
  await writeFile(scratchRegistryPath, `${JSON.stringify(registry, null, 2)}\n`, 'utf8');

  const scratchLoader = await import(pathToFileURL(join(scratchDir, 'loader.js')).href);
  await assert.rejects(() => scratchLoader.loadStyle('pofeni'), /Unknown or disabled style/);
} finally {
  await rm(scratchDir, { recursive: true, force: true });
}

// The check above must not have touched the real build output.
const registryAfter = JSON.parse(await readFile(join(styleEngineDir, 'registry.json'), 'utf8'));
assert.equal(registryAfter.pofeni.enabled, true, 'Verification must leave dist/style-engine/registry.json intact');

console.log('Style Engine build and runtime checks passed');
