import { defineConfig } from '@playwright/test';
import type { LoupeReporterOptions } from '../src/config/index.js';

// The bundled trace viewer (see test/trace-viewer.integration.test.ts): one
// passing test with a trace, also the config of its `merge-reports` runs.

const loupeOptions: LoupeReporterOptions = {
  title: 'Loupe trace viewer fixture',
  outputFolder: process.env['LOUPE_FIXTURE_OUTPUT'] ?? '../loupe-report-trace-viewer',
};

export default defineConfig({
  testDir: './trace-viewer',
  use: { trace: 'on' },
  reporter: [['./helpers/playwright-version.ts'], ['./helpers/playwright-core-stand-in.ts'], ['../dist/index.js', loupeOptions]],
});
