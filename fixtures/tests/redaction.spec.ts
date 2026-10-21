import { expect, test } from '@playwright/test';
import { FIXTURE_PASSWORD, FIXTURE_SECRET_ENV } from '../redaction-values.js';

// Secret redaction: see fixtures/README.md. Both tests pass; the report must
// show `[redacted]` and never the values.

const FORM = `
  <label>Password <input type="password"></label>
  <label>Notes <input id="notes"></label>
`;

test.describe('redaction', () => {
  test('fills a password field', { tag: '@layer:ui' }, async ({ page }) => {
    await page.setContent(FORM);
    await page.getByLabel('Password').fill(FIXTURE_PASSWORD);
    await expect(page.getByLabel('Password')).toHaveValue(FIXTURE_PASSWORD);
  });

  test('uses the value of a listed environment variable', { tag: '@layer:ui' }, async ({ page }) => {
    const value = process.env[FIXTURE_SECRET_ENV] ?? '';
    await page.setContent(FORM);
    // A neutral field: only redact.env catches this value.
    await page.locator('#notes').fill(value);
    console.log(`notes: ${value}`);
  });
});
