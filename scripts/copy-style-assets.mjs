import { cp, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const sourceDir = resolve(rootDir, 'src', 'style-engine');
const targetDir = resolve(rootDir, 'dist', 'style-engine');

await mkdir(targetDir, { recursive: true });
await cp(resolve(sourceDir, 'registry.json'), resolve(targetDir, 'registry.json'));
await cp(resolve(sourceDir, 'base-rules.md'), resolve(targetDir, 'base-rules.md'));
await cp(resolve(sourceDir, 'styles'), resolve(targetDir, 'styles'), { recursive: true });

console.log('Copied Style Engine runtime assets to dist/style-engine');
