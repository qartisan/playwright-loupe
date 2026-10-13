import { expect, test } from '@playwright/test';

// Would pass, but a load error in any file stops Playwright before any test runs.

test('would pass', () => {
  expect(1 + 1).toBe(2);
});
