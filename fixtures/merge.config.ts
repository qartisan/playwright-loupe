import { defineConfig } from '@playwright/test';
import type { LoupeConfig } from '../src/config/index.js';
// Sets the invented LOUPE_FIXTURE_SECRET listed in redact.env (loupe.config.ts).
import './redaction-values.js';

// Config for `playwright merge-reports` on blob reports of the sharded fixture
// suite. merge-reports rebases test paths on this config's root dir, so it uses
// the same testDir as playwright.config.ts to keep paths and test ids identical.

const loupeOptions: LoupeConfig = {
  title: 'Loupe fixture suite (merged)',
  outputFolder: process.env['LOUPE_FIXTURE_OUTPUT'] ?? '../loupe-report-merged',
};

export default defineConfig({
  testDir: './tests',
  reporter: [['../dist/index.js', loupeOptions]],
});
