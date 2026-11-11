import { test } from '@playwright/test';

// Fails on purpose: its message holds the value of LOUPE_FIXTURE_LATE_VALUE
// (see LATE in homes.ts), set by leak.config.ts.

test('fails with a value redacted only later', () => {
  throw new Error(`late value ${process.env['LOUPE_FIXTURE_LATE_VALUE'] ?? ''} in the message`);
});
