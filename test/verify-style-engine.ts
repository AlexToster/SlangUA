import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { loadStyle } from '../src/style-engine/loader';

async function main() {
  let failures = 0;

  // 1. Case-insensitivity: loadStyle('GEN_Z') vs loadStyle('gen_z')
  const upper = await loadStyle('GEN_Z');
  const lower = await loadStyle('gen_z');
  if (upper.systemPrompt === lower.systemPrompt) {
    console.log('[PASS] loadStyle("GEN_Z") === loadStyle("gen_z")');
  } else {
    console.error('[FAIL] loadStyle("GEN_Z") !== loadStyle("gen_z")');
    failures++;
  }

  // 2. Unknown style throws a meaningful error containing the style name
  try {
    await loadStyle('unknown_style');
    console.error('[FAIL] loadStyle("unknown_style") did not throw');
    failures++;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (message.includes('unknown_style')) {
      console.log('[PASS] loadStyle("unknown_style") threw error containing style name');
    } else {
      console.error(`[FAIL] Error message does not contain style name: "${message}"`);
      failures++;
    }
  }

  // 3. base-rules content is the first block in systemPrompt
  const baseRulesPath = fileURLToPath(new URL('../src/style-engine/base-rules.md', import.meta.url));
  const baseRulesContent = await readFile(baseRulesPath, 'utf-8');

  const prompt = upper.systemPrompt;
  if (prompt.startsWith(baseRulesContent)) {
    console.log('[PASS] base-rules content is the first block in systemPrompt');
  } else {
    console.error('[FAIL] base-rules content is NOT the first block in systemPrompt');
    failures++;
  }

  // Also verify base-rules is non-empty
  if (baseRulesContent.trim().length > 0) {
    console.log('[PASS] base-rules.md is non-empty');
  } else {
    console.error('[FAIL] base-rules.md is empty');
    failures++;
  }

  // 4. Verify systemPrompt is non-empty
  if (prompt.length > 0) {
    console.log('[PASS] systemPrompt is non-empty');
  } else {
    console.error('[FAIL] systemPrompt is empty');
    failures++;
  }

  console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`}`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error('Script error:', err);
  process.exit(1);
});