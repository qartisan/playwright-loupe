import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { test } from '@playwright/test';
import { expectTwo } from '../shared/helper.js';

// Absolute paths in every place a report can hold them. Failures are
// intentional (see fixtures/README.md).

/** The directory of this file: the root dir (`testDir`). */
const root = (): string => path.dirname(test.info().file);

test('fails in a helper outside the root (intentional)', async () => {
  await test.step(`checks ${root()}`, async () => {
    expectTwo(1);
  });
});

test('reads a missing file under the root (intentional)', () => {
  readFileSync(path.join(root(), 'missing.json'));
});

test('reads a missing file in the home directory (intentional)', () => {
  readFileSync(path.join(homedir(), '.cache', 'loupe-missing.json'));
});

test('throws an error without frames (intentional)', () => {
  const error = new Error(`frameless: ${path.join(root(), 'data.json')}`);
  error.stack = `Error: ${error.message}`;
  throw error;
});

test('prints paths', async () => {
  console.log(`root=${root()} home=${homedir()}`);
  test.info().annotations.push({ type: 'root', description: root() });
  await test.info().attach('paths', { body: `${root()}\n${homedir()}`, contentType: 'text/plain' });
});
