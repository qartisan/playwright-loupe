import { defineConfig } from '@playwright/test';
import type { LoupeReporterOptions } from '../src/config/index.js';
import { LATE, PROJECT, SECRETS } from './leak/homes.js';

// The leak canary, a browserless suite (see test/leak.integration.test.ts).

Object.assign(process.env, SECRETS, { [LATE.name]: LATE.value });
// LOUPE_FIXTURE_LATE_REDACT: the late value is added to redact.env, as after a run recorded without it.
const late = process.env['LOUPE_FIXTURE_LATE_REDACT'] ? [LATE.name] : [];
// LOUPE_FIXTURE_NOTES: the notes file, in the test's work folder; without it, none is read (never one in fixtures/).
const notes = process.env['LOUPE_FIXTURE_NOTES'] || false;

const loupeOptions: LoupeReporterOptions = {
  title: 'Loupe leak canary',
  redact: { env: [...Object.keys(SECRETS), ...late] },
  outputFolder: process.env['LOUPE_FIXTURE_OUTPUT'] ?? '../loupe-report-leak',
  // Recording stays off unless LOUPE_HISTORY says otherwise (vitest.config.ts turns it off).
  history: { notes },
};

export default defineConfig({
  testDir: './leak',
  // Loupe's reporter, its own output also captured to LOUPE_FIXTURE_CAPTURE (fixtures/helpers/loupe-capture.ts).
  reporter: [['./helpers/loupe-capture.ts', loupeOptions]],
  projects: [{ name: PROJECT }],
});
