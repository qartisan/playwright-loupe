import { defineConfig } from '@playwright/test';
import base from './playwright.config.js';

// Config behind `npm run sample:update`, which writes the renderer's dev sample.
// Same suite as playwright.config.ts, plus an intentional global teardown
// failure so the sample has a run error. The script also passes
// `--grep-invert` so the run is partial. See fixtures/README.md.

export default defineConfig(base, {
  testDir: './tests',
  globalTeardown: './sample/global-teardown.ts',
});
