#!/usr/bin/env node
/**
 * Generates the value for ADMIN_PASSWORD_HASH.
 *
 * Usage:
 *   node scripts/hash-admin-password.mjs            # prompts, echo suppressed
 *   node scripts/hash-admin-password.mjs >> .env    # appends the ready env line
 *   node scripts/hash-admin-password.mjs --raw      # prints the bare hash only
 *
 * The password is read from stdin only - never from argv, which would leave it
 * in the shell history and in the process list. Nothing is written to disk and
 * nothing is logged: the plaintext exists in this short-lived process and
 * nowhere else. Prompts go to stderr so stdout stays a single clean line.
 *
 * The scrypt parameters and the output format are duplicated from
 * `src/lib/password.ts` because a plain .mjs script cannot import TypeScript
 * without a loader. `test/unit/password.test.ts` hashes with this script and
 * verifies with the library, so the two cannot drift apart silently.
 */

import { randomBytes, scrypt } from 'node:crypto';

const PARAMS = { N: 16384, r: 8, p: 1 };
const KEY_LENGTH_BYTES = 32;
const SALT_LENGTH_BYTES = 16;
const MIN_PASSWORD_LENGTH = 12;

const rawOnly = process.argv.includes('--raw');

function derive(password, salt) {
  return new Promise((resolve, reject) => {
    scrypt(
      password,
      salt,
      KEY_LENGTH_BYTES,
      { N: PARAMS.N, r: PARAMS.r, p: PARAMS.p, maxmem: 256 * PARAMS.N * PARAMS.r },
      (err, key) => (err ? reject(err) : resolve(key)),
    );
  });
}

/** Reads one line from a terminal without echoing it. */
function readSecretFromTty(prompt) {
  return new Promise((resolve, reject) => {
    process.stderr.write(prompt);
    const stdin = process.stdin;
    const wasRaw = Boolean(stdin.isRaw);
    let value = '';

    const cleanup = () => {
      stdin.removeListener('data', onData);
      stdin.setRawMode(wasRaw);
      stdin.pause();
    };

    const onData = (chunk) => {
      for (const ch of chunk) {
        // Enter or Ctrl+D ends the entry.
        if (ch === '\r' || ch === '\n' || ch === '\u0004') {
          cleanup();
          process.stderr.write('\n');
          resolve(value);
          return;
        }
        if (ch === '\u0003') {
          cleanup();
          process.stderr.write('\n');
          reject(new Error('Aborted.'));
          return;
        }
        if (ch === '\u007f' || ch === '\b') {
          value = value.slice(0, -1);
          continue;
        }
        // Drop the remaining control characters instead of embedding them.
        if (ch < ' ') {
          continue;
        }
        value += ch;
      }
    };

    stdin.setEncoding('utf8');
    stdin.setRawMode(true);
    stdin.resume();
    stdin.on('data', onData);
  });
}

/** Reads a piped password: `printf %s "..." | node scripts/hash-admin-password.mjs`. */
async function readSecretFromPipe() {
  const chunks = [];
  for await (const chunk of process.stdin) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString('utf8').replace(/\r?\n$/, '');
}

function fail(message) {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}

async function main() {
  const interactive = Boolean(process.stdin.isTTY);
  let password;

  if (interactive) {
    password = await readSecretFromTty('Admin password: ');
    const confirmation = await readSecretFromTty('Repeat: ');
    if (password !== confirmation) {
      fail('The two entries do not match. Nothing was generated.');
    }
  } else {
    password = await readSecretFromPipe();
  }

  if (password.length < MIN_PASSWORD_LENGTH) {
    fail(
      `The password must be at least ${MIN_PASSWORD_LENGTH} characters long. ` +
        'This is the only barrier in front of the admin panel.',
    );
  }
  if (password.trim().length === 0) {
    fail('The password cannot consist of whitespace only.');
  }

  const salt = randomBytes(SALT_LENGTH_BYTES);
  const key = await derive(password, salt);
  const hash = `scrypt$N=${PARAMS.N},r=${PARAMS.r},p=${PARAMS.p}$${salt.toString('base64')}$${key.toString('base64')}`;

  process.stdout.write(rawOnly ? `${hash}\n` : `ADMIN_PASSWORD_HASH=${hash}\n`);

  if (interactive) {
    process.stderr.write(
      '\nCopy the line above into .env (it replaces the existing ADMIN_PASSWORD_HASH, if any).\n' +
        'The hash is not a secret in the same sense as the password, but it still belongs in .env only.\n',
    );
  }
}

main().catch((error) => {
  fail(error instanceof Error ? error.message : 'Failed to generate the hash.');
});
