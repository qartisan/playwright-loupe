import { defineConfig } from '@playwright/test';
import type { LoupeReporterOptions } from '../src/config/index.js';
import { LATE, PROJECT, SECRETS } from './leak/homes.js';

// The leak canary, a browserless suite (see test/leak.integration.test.ts).

Object.assign(process.env, SECRETS, { [LATE.name]: LATE.value });
// LOUPE_FIXTURE_LATE_REDACT: the late value is added to redact.env, as after a run recorded without it.
const late = process.env['LOUPE_FIXTURE_LATE_REDACT'] ? [LATE.name] : [];

const loupeOptions: LoupeReporterOptions = {
  title: 'Loupe leak canary',
  redact: { env: [...Object.keys(SECRETS), ...late] },
  outputFolder: process.env['LOUPE_FIXTURE_OUTPUT'] ?? '../loupe-report-leak',
};

export default defineConfig({
  testDir: './leak',
  reporter: [['../dist/index.js', loupeOptions]],
  projects: [{ name: PROJECT }],
});
