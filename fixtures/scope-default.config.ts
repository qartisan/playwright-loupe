import { defineConfig } from '@playwright/test';
import type { LoupeReporterOptions } from '../src/config/index.js';

// Run scope with a `default: false` project (Playwright 1.64+), see
// test/scope.integration.test.ts. Same tests as scope.config.ts, without the
// `test.only`: `nightly` only runs when selected with --project.

const loupeOptions: LoupeReporterOptions = {
  title: 'Loupe scope fixture (default projects)',
  outputFolder: process.env['LOUPE_FIXTURE_OUTPUT'] ?? '../loupe-report-scope',
};

// A variable, not an inline literal: `default` is only in the types from 1.64,
// and CI also typechecks against Playwright 1.52.
const nightly = { name: 'nightly', testMatch: /plain\.spec\.ts$/, default: false };

export default defineConfig({
  testDir: './scope',
  reporter: [['../dist/index.js', loupeOptions]],
  projects: [
    { name: 'setup', testMatch: /\.setup\.ts$/ },
    { name: 'main', testMatch: /plain\.spec\.ts$/, dependencies: ['setup'] },
    nightly,
  ],
});
