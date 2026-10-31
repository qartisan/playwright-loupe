import { test } from '@playwright/test';

// Titles of about 1,000 characters, for commands of known lengths. Only in the
// Windows check, which copies it next to fixtures/rerun/. The dense ones have the
// spaces of real titles, which npx escapes with carets on Windows.
for (let index = 0; index < 40; index += 1) test(`long ${String(index).padStart(2, '0')} ${'x'.repeat(990)}`, async () => {});
for (let index = 0; index < 10; index += 1) test(`dense ${index} ${'word '.repeat(198)}end`, async () => {});
