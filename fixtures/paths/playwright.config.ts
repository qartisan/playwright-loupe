import { defineConfig } from '@playwright/test';
import type { LoupeReporterOptions } from '../../src/config/index.js';

// Paths in the report (see test/paths.integration.test.ts). The test copies
// this folder under fake absolute roots, so the reporter and the output come
// from the environment. No browser: the tests run with any HOME.

const loupeOptions: LoupeReporterOptions = {
  title: 'Loupe paths fixture',
  outputFolder: process.env['LOUPE_FIXTURE_OUTPUT'] ?? '../../loupe-report-paths',
};

export default defineConfig({
  testDir: './tests',
  reporter: [
    [process.env['LOUPE_FIXTURE_REPORTER'] ?? '../../dist/index.js', loupeOptions],
    ...(process.env['LOUPE_FIXTURE_ROOTS'] ? [['./roots-reporter.ts'] as [string]] : []),
  ],
});
