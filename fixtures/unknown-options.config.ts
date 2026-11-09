import { defineConfig } from '@playwright/test';
import type { LoupeReporterOptions } from '../src/config/index.js';

// Reporter options Loupe does not know (see test/config.integration.test.ts):
// one passing browserless test. `onlyFailures` is the key Playwright 1.65 adds
// under `--list`; `futureKey` stands for a key a later version may add, and
// `categories.rulez` for a typo. Loupe warns and writes its report.

const loupeOptions = {
  title: 'Loupe unknown options fixture',
  outputFolder: process.env['LOUPE_FIXTURE_OUTPUT'] ?? '../loupe-report-unknown-options',
  onlyFailures: false,
  futureKey: 1,
  categories: { rulez: [] },
} as LoupeReporterOptions;

export default defineConfig({
  testDir: './scope',
  testMatch: /plain\.spec\.ts$/,
  reporter: [['../dist/index.js', loupeOptions]],
});
