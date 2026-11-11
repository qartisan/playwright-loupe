import { defineConfig, type ReporterDescription } from '@playwright/test';
import type { LoupeReporterOptions } from '../src/config/index.js';

// A browserless suite for run history (see test/history.integration.test.ts).
// Its failures are intentional. LOUPE_FIXTURE_BLOB adds the blob reporter, as
// a shard of a sharded run has it next to Loupe.

const loupeOptions: LoupeReporterOptions = {
  title: 'Loupe history fixture',
  outputFolder: process.env['LOUPE_FIXTURE_OUTPUT'] ?? '../loupe-report-history',
};

const blob: ReporterDescription[] = process.env['LOUPE_FIXTURE_BLOB'] ? [['blob', { outputDir: process.env['LOUPE_FIXTURE_BLOB'] }]] : [];

export default defineConfig({
  testDir: './history',
  retries: 1,
  workers: 1,
  reporter: [...blob, ['../dist/index.js', loupeOptions]],
  projects: [{ name: 'history' }],
});
