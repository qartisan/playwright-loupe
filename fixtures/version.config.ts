import { defineConfig } from '@playwright/test';
import type { LoupeReporterOptions } from '../src/config/index.js';

// The run-time Playwright version warning (see test/support.integration.test.ts):
// one passing browserless test, with `config.version` replaced by
// LOUPE_FIXTURE_PLAYWRIGHT_VERSION before Loupe reads it.

const loupeOptions: LoupeReporterOptions = {
  title: 'Loupe version fixture',
  outputFolder: process.env['LOUPE_FIXTURE_OUTPUT'] ?? '../loupe-report-version',
};

export default defineConfig({
  testDir: './scope',
  testMatch: /plain\.spec\.ts$/,
  reporter: [['./helpers/playwright-version.ts'], ['../dist/index.js', loupeOptions]],
});
