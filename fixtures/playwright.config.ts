import { defineConfig, devices } from '@playwright/test';
import type { LoupeConfig } from '../src/config/index.js';

// Fixture suite for Loupe. Its failures are intentional — see fixtures/README.md.

const loupeOptions: LoupeConfig = {
  title: 'Loupe fixture suite',
  // Relative to this file. Overridable so the integration test can write to a temp folder.
  outputFolder: process.env['LOUPE_FIXTURE_OUTPUT'] ?? '../loupe-report',
};

export default defineConfig({
  testDir: './tests',
  outputDir: './test-results',
  // One baseline for every project and platform: the screenshot comparison
  // failure is intentional and uses colors far apart enough to fail anywhere.
  snapshotPathTemplate: '{testDir}/__screenshots__/{testFilePath}/{arg}{ext}',
  fullyParallel: true,
  retries: 1,
  reporter: [['list'], ['../dist/index.js', loupeOptions]],
  use: {
    ...devices['Desktop Chrome'],
    video: 'retain-on-failure',
    trace: 'retain-on-failure',
  },
  projects: [
    { name: 'chromium-a', use: { browserName: 'chromium' } },
    { name: 'chromium-b', use: { browserName: 'chromium' } },
  ],
});
