import { defineConfig } from '@playwright/test';
import type { LoupeReporterOptions } from '../src/config/index.js';
// Sets the invented LOUPE_FIXTURE_SECRET listed in redact.env (loupe.config.ts).
import './redaction-values.js';

// A browserless suite for the rerun commands (see test/rerun.integration.test.ts):
// titles, tags, paths and project names that are hard to select with `-g` and to
// paste in a shell. Kept apart from playwright.config.ts so its snapshot stays as is.

const loupeOptions: LoupeReporterOptions = {
  title: 'Loupe rerun fixture',
  outputFolder: process.env['LOUPE_FIXTURE_OUTPUT'] ?? '../loupe-report-rerun',
};

const plain = /plain\.spec\.ts$/;

// A variable: `default` is not in the types before Playwright 1.64, which ignore it at run time.
const offByDefault = { name: 'off-by-default', testMatch: plain, default: false };

export default defineConfig({
  testDir: './rerun',
  reporter: [['../dist/index.js', loupeOptions]],
  projects: [
    { name: 'setup', testMatch: /\.setup\.ts$/ },
    { name: 'main', testMatch: /\.spec\.ts$/, dependencies: ['setup'] },
    { name: 'other', testMatch: plain },
    { name: 'v1.2', testMatch: plain },
    { name: 'star*name', testMatch: plain },
    { name: 'Mobile (iOS) + x', testMatch: plain },
    { name: 'Sécu "q" $x %y% `z` !', testMatch: plain },
    // Differ by case only: `--project` and `-g` both ignore it.
    { name: 'Case', testMatch: plain },
    { name: 'case', testMatch: plain },
    offByDefault,
    // No name: no `--project` can select it.
    { testMatch: plain },
  ],
});
