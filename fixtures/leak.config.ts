import { defineConfig } from '@playwright/test';
import type { LoupeReporterOptions } from '../src/config/index.js';
import { PROJECT } from './leak/homes.js';

// The leak canary, a browserless suite (see test/leak.integration.test.ts).

const loupeOptions: LoupeReporterOptions = {
  title: 'Loupe leak canary',
  outputFolder: process.env['LOUPE_FIXTURE_OUTPUT'] ?? '../loupe-report-leak',
};

export default defineConfig({
  testDir: './leak',
  reporter: [['../dist/index.js', loupeOptions]],
  projects: [{ name: PROJECT }],
});
