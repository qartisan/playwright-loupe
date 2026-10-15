import { defineConfig } from '@playwright/test';
import type { LoupeReporterOptions } from '../src/config/index.js';

// A browserless suite for run scope detection (see test/scope.integration.test.ts):
// `focused.spec.ts` has a `test.only`, and `main` depends on `setup`. Kept apart
// from playwright.config.ts so the main fixture suite runs every test.

const loupeOptions: LoupeReporterOptions = {
  title: 'Loupe scope fixture',
  outputFolder: process.env['LOUPE_FIXTURE_OUTPUT'] ?? '../loupe-report-scope',
};

export default defineConfig({
  testDir: './scope',
  // The `test.only` is the point of this suite.
  forbidOnly: false,
  reporter: [['../dist/index.js', loupeOptions]],
  projects: [
    { name: 'setup', testMatch: /\.setup\.ts$/ },
    { name: 'main', testMatch: /\.spec\.ts$/, dependencies: ['setup'] },
  ],
});
