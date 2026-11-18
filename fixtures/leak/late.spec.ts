import { test } from '@playwright/test';
import { LATE_ACROSS_CUT } from './homes.js';

// Fail on purpose: their messages hold the value of LOUPE_FIXTURE_LATE_VALUE
// (see LATE in homes.ts), set by leak.config.ts.

test('fails with a value redacted only later', () => {
  throw new Error(`late value ${process.env['LOUPE_FIXTURE_LATE_VALUE'] ?? ''} in the message`);
});

// The same value, across the cut of the extract the history keeps: LATE_ACROSS_CUT is built from LATE.value.
test('fails with a value redacted only later, across the cut of its extract', () => {
  throw new Error(LATE_ACROSS_CUT);
});
