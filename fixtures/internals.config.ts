import { defineConfig } from '@playwright/test';
import type { LoupeReporterOptions } from '../src/config/index.js';

// Playwright internals missing or reshaped (see test/internals.integration.test.ts):
// the scope suite, with its intentional `test.only`, and LOUPE_FIXTURE_INTERNALS
// set to `missing` or `reshaped`. A test-only reporter listed before Loupe
// changes the internals Loupe reads in onEnd; the reporter options Playwright
// adds (`_mode`, `configDir`) are overridden here, since Playwright spreads the
// options of the config file over its own.

const scenario = process.env['LOUPE_FIXTURE_INTERNALS'];
const playwrightOptions =
  scenario === 'missing' ? { _mode: undefined, configDir: undefined } : scenario === 'reshaped' ? { _mode: 42, configDir: 7 } : {};

const loupeOptions = {
  title: 'Loupe internals fixture',
  outputFolder: process.env['LOUPE_FIXTURE_OUTPUT'] ?? '../loupe-report-internals',
  ...playwrightOptions,
} as LoupeReporterOptions;

export default defineConfig({
  testDir: './scope',
  // The `test.only` exercises the `_only` flag.
  forbidOnly: false,
  reporter: [['./helpers/internals.ts'], ['../dist/index.js', loupeOptions]],
  projects: [
    { name: 'setup', testMatch: /\.setup\.ts$/ },
    { name: 'main', testMatch: /\.spec\.ts$/, dependencies: ['setup'] },
  ],
});
