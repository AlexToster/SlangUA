/**
 * Password hashing unit tests.
 *
 * The point of interest is a duplication that cannot be avoided: the stored
 * format and the scrypt cost parameters exist twice, in `src/lib/password.ts`
 * and in `scripts/hash-admin-password.mjs` (a plain .mjs script cannot import
 * TypeScript without a loader). If the two ever drift apart, the operator gets a
 * hash the server rejects as a wrong password forever, with no error anywhere.
 * So these tests hash with the script and verify with the library.
 */

import { describe, it, expect } from 'vitest';
import { spawn } from 'node:child_process';
import path from 'node:path';
import {
  DEFAULT_SCRYPT_PARAMS,
  SCRYPT_HASH_PATTERN,
  hashPassword,
  isScryptHash,
  verifyPassword,
} from '../../src/lib/password';

// Resolved from the working directory rather than from `import.meta.url`: the
// test project compiles to CommonJS, where import.meta is a syntax error. Vitest
// always runs with the repository root as cwd.
const scriptPath = path.resolve(process.cwd(), 'scripts/hash-admin-password.mjs');

interface ScriptResult {
  code: number | null;
  stdout: string;
  stderr: string;
}

/**
 * Runs the generator with the password on stdin, the way the documentation tells
 * an operator to pipe it. Never on argv: that would put the plaintext in the
 * shell history and in the process list.
 */
function runScript(password: string, args: string[] = ['--raw']): Promise<ScriptResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [scriptPath, ...args], { stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('error', reject);
    child.on('close', (code) => resolve({ code, stdout, stderr }));
    child.stdin.end(password, 'utf8');
  });
}

const PASSWORD = 'correct-horse-battery-staple';

describe('verifyPassword', () => {
  it('accepts the password it was given and nothing else', async () => {
    const stored = await hashPassword(PASSWORD);

    await expect(verifyPassword(PASSWORD, stored)).resolves.toBe(true);
    await expect(verifyPassword(`${PASSWORD} `, stored)).resolves.toBe(false);
    await expect(verifyPassword(PASSWORD.toUpperCase(), stored)).resolves.toBe(false);
    await expect(verifyPassword('', stored)).resolves.toBe(false);
  });

  it('salts every hash, so the same password never stores the same bytes', async () => {
    const [first, second] = await Promise.all([hashPassword(PASSWORD), hashPassword(PASSWORD)]);

    expect(first).not.toBe(second);
    await expect(verifyPassword(PASSWORD, first)).resolves.toBe(true);
    await expect(verifyPassword(PASSWORD, second)).resolves.toBe(true);
  });

  // A login endpoint must answer the same way whatever went wrong: a throw here
  // would be an error the caller has to distinguish from a wrong password.
  it('returns false for a malformed stored hash instead of throwing', async () => {
    for (const stored of [
      '',
      'not-a-hash',
      'scrypt$N=16384,r=8,p=1$dG9vc2hvcnQ=$dG9vc2hvcnQ=',
      // N is not a power of two: scrypt itself would throw on this one.
      'scrypt$N=16000,r=8,p=1$ehN6SvtS/mSclfA2LB+tAg==$Y4inoYaGkMWg25H+XHlzZfJQZqwdAh+TByZjqlzJKD4=',
      'scrypt$N=16384,r=0,p=1$ehN6SvtS/mSclfA2LB+tAg==$Y4inoYaGkMWg25H+XHlzZfJQZqwdAh+TByZjqlzJKD4=',
    ]) {
      await expect(verifyPassword(PASSWORD, stored), stored).resolves.toBe(false);
      expect(isScryptHash(stored), stored).toBe(false);
    }
  });

  it('keeps verifying a hash made with weaker parameters', async () => {
    // The stored format carries its own cost parameters, so raising the defaults
    // later must not invalidate hashes already in a deployment's .env.
    const stored = await hashPassword(PASSWORD, { N: 1024, r: 8, p: 1 });

    expect(stored).toContain('N=1024');
    await expect(verifyPassword(PASSWORD, stored)).resolves.toBe(true);
    await expect(verifyPassword('wrong', stored)).resolves.toBe(false);
  });
});

describe('scripts/hash-admin-password.mjs', () => {
  it('produces a hash the library accepts', async () => {
    const result = await runScript(PASSWORD);

    expect(result.code).toBe(0);
    const hash = result.stdout.trim();
    expect(isScryptHash(hash)).toBe(true);
    await expect(verifyPassword(PASSWORD, hash)).resolves.toBe(true);
    await expect(verifyPassword('some-other-password', hash)).resolves.toBe(false);
  });

  it('uses the same cost parameters as the library default', async () => {
    // Drift here would not fail anything visibly - it would silently make every
    // freshly generated hash cheaper or more expensive than intended.
    const match = SCRYPT_HASH_PATTERN.exec((await runScript(PASSWORD)).stdout.trim());

    expect(match).not.toBeNull();
    expect(Number(match![1])).toBe(DEFAULT_SCRYPT_PARAMS.N);
    expect(Number(match![2])).toBe(DEFAULT_SCRYPT_PARAMS.r);
    expect(Number(match![3])).toBe(DEFAULT_SCRYPT_PARAMS.p);
    // 16-byte salt, 32-byte key, same as the library produces.
    expect(Buffer.from(match![4], 'base64')).toHaveLength(16);
    expect(Buffer.from(match![5], 'base64')).toHaveLength(32);
  });

  it('prints a ready .env line by default and a bare hash with --raw', async () => {
    const envLine = (await runScript(PASSWORD, [])).stdout.trim();
    expect(envLine.startsWith('ADMIN_PASSWORD_HASH=')).toBe(true);
    expect(isScryptHash(envLine.slice('ADMIN_PASSWORD_HASH='.length))).toBe(true);
  });

  it('never writes the plaintext anywhere in its output', async () => {
    const result = await runScript(PASSWORD);

    expect(result.stdout).not.toContain(PASSWORD);
    expect(result.stderr).not.toContain(PASSWORD);
  });

  it('refuses a password shorter than the minimum', async () => {
    // The password is the only barrier in front of the panel, so the generator
    // is where the length policy is enforced - the server only sees a hash.
    const result = await runScript('short');

    expect(result.code).toBe(1);
    expect(result.stdout).toBe('');
    expect(result.stderr).toContain('at least 12 characters');
  });

  it('refuses a whitespace-only password', async () => {
    const result = await runScript('               ');

    expect(result.code).toBe(1);
    expect(result.stdout).toBe('');
  });
});
