#!/usr/bin/env node
/**
 * Keeps README.md and README.en.md from drifting apart.
 *
 * The pair is a mirror, not a translation that was done once: README.md is the
 * landing page and README.en.md is the same document in English. Drift here is
 * silent - nothing breaks, the English page merely starts lying - so the checks
 * below are the ones that catch a real edit going into only one of the two:
 *
 *   1. the same `##` sections, in the same order;
 *   2. every style sample byte-identical between the files (the output is the
 *      product; translating it would defeat the demonstration);
 *   3. each file linking to the other;
 *   4. every relative link and `#anchor` resolving, in both;
 *   5. every image present, with alt text;
 *   6. the ASCII architecture diagram still aligned;
 *   7. LF endings.
 *
 * Uses nothing but Node built-ins on purpose: it runs in CI without `npm ci`.
 */
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const UK = 'README.md';
const EN = 'README.en.md';

const problems = [];
const fail = (message) => problems.push(message);
const read = (rel) => readFile(resolve(rootDir, rel), 'utf8');

/**
 * GitHub's heading-to-fragment rule: strip code ticks, lowercase, drop
 * punctuation, then turn each space into a hyphen. Runs of spaces are NOT
 * collapsed - `Stage 9 — Deployment` really does slug to `stage-9--deployment`.
 * Cyrillic survives, which is why translating a heading breaks inbound links.
 */
function slug(heading) {
  return heading
    .replace(/`/g, '')
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\p{M} _-]+/gu, '')
    .replace(/ /g, '-');
}

/** Fragments a document offers: its headings plus any explicit anchor tags. */
function anchorsOf(text) {
  const found = new Set();
  for (const line of text.split('\n')) {
    const heading = line.match(/^#{1,6}\s+(.*)$/);
    if (heading) found.add(slug(heading[1]));
    for (const tag of line.matchAll(/<a\s+(?:id|name)="([^"]+)"/g)) found.add(tag[1]);
  }
  return found;
}

const sections = (text) => [...text.matchAll(/^## (.+)$/gm)].map((m) => m[1]);

/**
 * The style samples, and only those: «...» inside a table row or after the
 * `**Original:**` / `**Оригінал:**` label. Ukrainian in prose is deliberately
 * left out - there it is a word being discussed, and the English page glosses
 * it rather than quoting it.
 */
const samples = (text) =>
  text
    .split('\n')
    .filter((line) => line.startsWith('|') || /^> \*\*(Original|Оригінал)/.test(line))
    .flatMap((line) => [...line.matchAll(/«([^»]+)»/g)].map((m) => m[1]));

const uk = await read(UK);
const en = await read(EN);

// 1. Sections, in order.
const ukSections = sections(uk);
const enSections = sections(en);
if (ukSections.length !== enSections.length) {
  fail(
    `section count differs: ${UK} has ${ukSections.length}, ${EN} has ${enSections.length}\n` +
      `     ${UK}: ${ukSections.join(' | ')}\n` +
      `     ${EN}: ${enSections.join(' | ')}`
  );
}

// 2. Samples, byte for byte. Direction matters: a sample may exist in the
// mirror's gloss column and not in the original, but never the other way round.
const enSamples = samples(en);
for (const sample of samples(uk)) {
  if (!enSamples.includes(sample)) {
    fail(`sample not verbatim in ${EN}: «${sample.slice(0, 70)}…»`);
  }
}

// 3. Each file has to offer the way back to the other one.
if (!uk.includes(`(${EN})`)) fail(`${UK} does not link to ${EN} - the language switcher is gone`);
if (!en.includes(`(${UK})`)) fail(`${EN} does not link to ${UK} - the language switcher is gone`);

// 4-7 per file.
const anchorCache = new Map();
async function anchorsOfFile(absolute) {
  if (!anchorCache.has(absolute)) anchorCache.set(absolute, anchorsOf(await readFile(absolute, 'utf8')));
  return anchorCache.get(absolute);
}

for (const [rel, text] of [[UK, uk], [EN, en]]) {
  const absolute = resolve(rootDir, rel);

  // 4. Links: local files exist, fragments exist in whatever they point at.
  for (const [, link] of text.matchAll(/\]\(([^)\s]+)\)/g)) {
    if (/^(https?:|mailto:)/.test(link)) continue;
    const [path, fragment] = link.split('#');
    const target = path ? resolve(dirname(absolute), decodeURIComponent(path)) : absolute;
    if (!existsSync(target)) {
      fail(`${rel} -> ${link} (no such file: ${relative(rootDir, target)})`);
      continue;
    }
    if (fragment && !(await anchorsOfFile(target)).has(decodeURIComponent(fragment))) {
      fail(`${rel} -> ${link} (no such anchor in ${relative(rootDir, target)})`);
    }
  }

  // 5. Images: the two files share the same assets, and alt text is not optional.
  for (const [tag, source] of text.matchAll(/<img\s+src="([^"]+)"[^>]*>/g)) {
    if (!existsSync(resolve(dirname(absolute), source))) fail(`${rel}: no such image: ${source}`);
    if (!/alt="[^"]+"/.test(tag)) fail(`${rel}: image without alt text: ${source}`);
  }

  // 7. LF only, and a trailing newline.
  if (text.includes('\r')) fail(`${rel}: contains CR - the repository is LF-only (.gitattributes)`);
  if (!text.endsWith('\n')) fail(`${rel}: no trailing newline`);
}

/**
 * 6. The ASCII architecture diagram.
 *
 * Its boxes sit in fixed columns, so the invariant is per column rather than
 * per file: every framed span that starts at the same column must be the same
 * width. That catches the edit that actually goes wrong - a translated label
 * that is a character or two longer than the one it replaced, leaving one wall
 * of the box out of line - without hard-coding any width, so the diagram can
 * still be redrawn freely as long as it is redrawn consistently.
 */
const BORDERS = '│├└┌┤┘┐';

function checkDiagram(rel, text) {
  for (const [, block] of text.matchAll(/```text\n([\s\S]*?)```/g)) {
    const byColumn = new Map();
    for (const [lineNo, line] of block.split('\n').entries()) {
      const walls = [...line].flatMap((char, index) => (BORDERS.includes(char) ? [index] : []));
      for (let i = 0; i + 1 < walls.length; i += 1) {
        const span = line.slice(walls[i] + 1, walls[i + 1]);
        // Whitespace between two columns is a gap, and `─►` is an arrow; neither
        // is the inside of a box.
        if (!span.trim() || /^[─►]{1,3}$/.test(span)) continue;
        const column = walls[i];
        if (!byColumn.has(column)) byColumn.set(column, []);
        byColumn.get(column).push({ width: span.length, lineNo: lineNo + 1, span });
      }
    }
    for (const [column, spans] of byColumn) {
      const widths = [...new Set(spans.map((s) => s.width))];
      if (widths.length > 1) {
        const shown = spans
          .map((s) => `line ${s.lineNo} width ${s.width}: "${s.span}"`)
          .join('\n       ');
        fail(`${rel}: diagram boxes starting at column ${column} disagree on width\n       ${shown}`);
      }
    }
  }
}

checkDiagram(UK, uk);
checkDiagram(EN, en);

if (problems.length > 0) {
  console.error(`README parity: ${problems.length} problem(s)\n`);
  for (const problem of problems) console.error(`  - ${problem}`);
  console.error(`\nBoth READMEs are one document in two languages. Fix the pair, not one half.`);
  process.exit(1);
}

console.log(
  `README parity OK: ${ukSections.length} sections, ${samples(uk).length} verbatim samples, links and diagram aligned`
);
