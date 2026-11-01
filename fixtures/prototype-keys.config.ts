import { defineConfig } from '@playwright/test';
import type { LoupeReporterOptions } from '../src/config/index.js';
import { KEYS } from './prototype-keys/keys.js';

// A browserless suite (see test/prototype-keys.integration.test.ts), with each name
// as a project too. A failing run also has each name as a category and as a declared
// dimension, from an annotation; a declared name takes the automatic one's place.

const failing = Boolean(process.env['LOUPE_FIXTURE_FAIL']);

const loupeOptions: LoupeReporterOptions = {
  title: 'Loupe prototype keys',
  outputFolder: process.env['LOUPE_FIXTURE_OUTPUT'] ?? '../loupe-report-prototype-keys',
  ...(failing && {
    categories: { rules: KEYS.map((key) => ({ name: key, match: [new RegExp(`failure ${key}`)] })) },
    dimensions: { definitions: KEYS.map((key) => ({ name: key, from: 'annotation' as const, type: key })) },
  }),
};

export default defineConfig({
  testDir: './prototype-keys',
  reporter: [['../dist/index.js', loupeOptions]],
  projects: KEYS.map((name) => ({ name })),
});
