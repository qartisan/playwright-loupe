import { defineConfig } from '@playwright/test';
import type { LoupeReporterOptions } from '../src/config/index.js';

// A browserless suite for the sources of `run.git` (see test/git.integration.test.ts).
// LOUPE_FIXTURE_CAPTURE_GIT=commit turns Playwright's own commit capture on; it is
// off otherwise, even on CI. LOUPE_FIXTURE_GIT_COMMIT puts a commit hash in the
// metadata, as `metadata.gitCommit`, the way Playwright's capture does.

const loupeOptions: LoupeReporterOptions = {
  title: 'Loupe git fixture',
  outputFolder: process.env['LOUPE_FIXTURE_OUTPUT'] ?? '../loupe-report-git',
};

const commit = process.env['LOUPE_FIXTURE_GIT_COMMIT'];

export default defineConfig({
  testDir: './git',
  captureGitInfo: { commit: process.env['LOUPE_FIXTURE_CAPTURE_GIT'] === 'commit', diff: false },
  ...(commit ? { metadata: { gitCommit: { hash: commit } } } : {}),
  reporter: [['../dist/index.js', loupeOptions]],
});
