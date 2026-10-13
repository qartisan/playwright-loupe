import { defineConfig } from '@playwright/test';
import type { LoupeReporterOptions } from '../src/config/index.js';

// A suite with a spec file that fails to import a module, to check that Loupe
// reports run-level errors. Kept apart from playwright.config.ts so the main
// fixture suite still runs. Also used as the merge-reports config for its blobs.
// LOUPE_FIXTURE_TAG sets the config `tag`, which merge-reports adds as a
// `(<tag>) ` prefix to the run errors of the blob.

const loupeOptions: LoupeReporterOptions = {
  title: 'Loupe load-error fixture',
  outputFolder: process.env['LOUPE_FIXTURE_OUTPUT'] ?? '../loupe-report-load-error',
};

export default defineConfig({
  testDir: './load-error',
  reporter: [['../dist/index.js', loupeOptions]],
  projects: [{ name: 'chromium-a' }, { name: 'chromium-b' }],
  ...(process.env['LOUPE_FIXTURE_TAG'] ? { tag: process.env['LOUPE_FIXTURE_TAG'] } : {}),
});
