import { test } from '@playwright/test';

// Titles of about 1,000 characters, for commands of known lengths. Only in the
// Windows check, which copies it next to fixtures/rerun/.
for (let index = 0; index < 40; index += 1) test(`long ${String(index).padStart(2, '0')} ${'x'.repeat(990)}`, async () => {});
