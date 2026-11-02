import { writeFileSync } from 'node:fs';
import { test } from '@playwright/test';
import { SECRETS } from './homes.js';

// Secrets in tags: as a prefix, as a value, and holding the `:` a dimension splits at.
// Secrets in attachments: in the name, written or copied, and in the source file name.

const { LOUPE_LEAK_SECRET: secret, LOUPE_LEAK_OTHER: other, LOUPE_LEAK_COLON: colon } = SECRETS;

test('holds secrets in its tags', { tag: [`@${secret}:x`, `@${other}:y`, `@${colon}`, `@${colon}:z`, `@kept:${secret}`] }, () => {});

test('holds secrets in its attachments', async ({}, testInfo) => {
  await testInfo.attach(`log ${secret}`, { body: 'a'.repeat(5000), contentType: 'text/plain' });
  await testInfo.attach(`log ${colon}`, { body: 'b'.repeat(5000), contentType: 'text/plain' });
  for (const file of [`${other}.txt`, `plain.${secret}`]) {
    const source = testInfo.outputPath(file);
    writeFileSync(source, file.startsWith('plain') ? 'd' : 'c');
    testInfo.attachments.push({ name: 'clean name', contentType: 'text/plain', path: source });
  }
});
