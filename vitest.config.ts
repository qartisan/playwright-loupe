import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    // Every Playwright run a test starts inherits it: no test writes a history
    // folder next to a fixture config. History tests opt in with
    // LOUPE_HISTORY=on and a temporary LOUPE_HISTORY_DIR.
    env: { LOUPE_HISTORY: 'off' },
  },
});
