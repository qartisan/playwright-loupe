import { defineConfig, type ReporterDescription } from '@playwright/test';
import type { LoupeReporterOptions } from '../src/config/index.js';

// A browserless suite for run history (see test/history.integration.test.ts).
// Its failures are intentional. LOUPE_FIXTURE_BLOB adds the blob reporter, as
// a shard of a sharded run has it next to Loupe. LOUPE_FIXTURE_MAX_RUNS sets
// history.retention.maxRuns. LOUPE_FIXTURE_LATE_BRANCH puts the branch in the
// stream key and adds a reporter that sets that branch only at the end of the
// run (history-late-branch-reporter.mjs). LOUPE_FIXTURE_NOTES sets
// history.notes (a path, or `off` for false), so no test reads a notes file in
// fixtures/; LOUPE_FIXTURE_INCLUDE sets history.include.

const maxRuns = process.env['LOUPE_FIXTURE_MAX_RUNS'];
const lateBranch = process.env['LOUPE_FIXTURE_LATE_BRANCH'];
const notes = process.env['LOUPE_FIXTURE_NOTES'];
const include = process.env['LOUPE_FIXTURE_INCLUDE'];
const loupeOptions: LoupeReporterOptions = {
  title: 'Loupe history fixture',
  outputFolder: process.env['LOUPE_FIXTURE_OUTPUT'] ?? '../loupe-report-history',
  history: {
    ...(maxRuns ? { retention: { maxRuns: Number(maxRuns) } } : {}),
    ...(lateBranch ? { stream: { key: ['environment', 'origin', 'branch'] } } : {}),
    ...(notes ? { notes: notes === 'off' ? false : notes } : {}),
    ...(include === 'all' || include === 'full' ? { include } : {}),
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
