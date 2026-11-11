import { defineConfig, type ReporterDescription } from '@playwright/test';
import type { LoupeReporterOptions } from '../src/config/index.js';

// A browserless suite for run history (see test/history.integration.test.ts).
// Its failures are intentional. LOUPE_FIXTURE_BLOB adds the blob reporter, as
// a shard of a sharded run has it next to Loupe. LOUPE_FIXTURE_MAX_RUNS sets
// history.retention.maxRuns. LOUPE_FIXTURE_LATE_BRANCH puts the branch in the
// stream key and adds a reporter that sets that branch only at the end of the
// run (history-late-branch-reporter.mjs).

const maxRuns = process.env['LOUPE_FIXTURE_MAX_RUNS'];
const lateBranch = process.env['LOUPE_FIXTURE_LATE_BRANCH'];
const loupeOptions: LoupeReporterOptions = {
  title: 'Loupe history fixture',
  outputFolder: process.env['LOUPE_FIXTURE_OUTPUT'] ?? '../loupe-report-history',
  history: {
    ...(maxRuns ? { retention: { maxRuns: Number(maxRuns) } } : {}),
    ...(lateBranch ? { stream: { key: ['environment', 'origin', 'branch'] } } : {}),
  },
};

const blob: ReporterDescription[] = process.env['LOUPE_FIXTURE_BLOB'] ? [['blob', { outputDir: process.env['LOUPE_FIXTURE_BLOB'] }]] : [];
const late: ReporterDescription[] = lateBranch ? [['./history-late-branch-reporter.mjs']] : [];

export default defineConfig({
  testDir: './history',
  retries: 1,
  workers: 1,
  reporter: [...blob, ...late, ['../dist/index.js', loupeOptions]],
  projects: [{ name: 'history' }],
});
