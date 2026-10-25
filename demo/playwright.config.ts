import { defineConfig, devices } from '@playwright/test';

// Demo suite for Loupe, against the invented Demo Store in app/. Its failures
// are intentional: see README.md. Run it with `npm run demo` from the
// repository root.

const PORT = 3917;

export default defineConfig({
  testDir: './tests',
  outputDir: './test-results',
  // One baseline for every platform: the visual comparison fails on purpose anyway.
  snapshotPathTemplate: '{testDir}/__screenshots__/{testFilePath}/{arg}{ext}',
  fullyParallel: true,
  retries: 1,
  // A user writes '@qartisan/playwright-loupe'; inside this repository, the
  // build output. Loupe reads its options from loupe.config.ts, next to this file.
  reporter: [['list'], ['../dist/index.js']],
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    screenshot: 'only-on-failure',
    video: 'off',
    trace: 'off',
  },
  webServer: {
    command: 'node app/server.mjs',
    url: `http://127.0.0.1:${PORT}/health`,
    env: { PORT: String(PORT) },
    // A fresh server per run: the delivery estimate's cold start must happen once per test.
    reuseExistingServer: false,
  },
  projects: [
    { name: 'web', testDir: './tests/web', use: { ...devices['Desktop Chrome'] } },
    // Browserless: the `request` fixture only.
    { name: 'api', testDir: './tests/api' },
  ],
});
