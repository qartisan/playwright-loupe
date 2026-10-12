import { randomInt, randomUUID } from 'node:crypto';
import { createServer, type AddressInfo } from 'node:net';
import { expect, test } from '@playwright/test';

// Intentional failures: see fixtures/README.md. Do not "fix" these tests.

/**
 * Throws an error whose UUID, URL and duration change on every call, so tests
 * using it prove that error signatures ignore those values.
 */
function failOrderSync(): never {
  const url = `http://localhost:${randomInt(3000, 9000)}/api/orders/${randomInt(1, 10_000)}`;
  throw new Error(`Order sync ${randomUUID()} rejected by ${url} after ${randomInt(100, 5000)}ms`);
}

test.describe('failures', () => {
  test.describe('one per category', () => {
    test('times out (intentional)', { tag: '@layer:ui' }, async ({ page }) => {
      test.setTimeout(1_000);
      await page.setContent('<p>Waiting</p>');
      await page.waitForTimeout(5_000);
    });

    test('does not find a locator (intentional)', { tag: '@layer:ui' }, async ({ page }) => {
      await page.setContent('<p>Nothing to see</p>');
      await expect(page.getByRole('button', { name: 'Missing' })).toBeVisible({ timeout: 300 });
    });

    test('hits a network error (intentional)', { tag: '@layer:ui' }, async ({ page }) => {
      // A port that was just released: the connection is refused, offline too.
      const server = createServer().listen(0, '127.0.0.1');
      await new Promise((resolve) => server.once('listening', resolve));
      const { port } = server.address() as AddressInfo;
      await new Promise((resolve) => server.close(resolve));
      await page.goto(`http://127.0.0.1:${port}/`);
    });
  });

  test.describe('same error, different values', () => {
    test('syncs the first order (intentional)', { tag: '@layer:api' }, async () => {
      failOrderSync();
    });

    test('syncs the second order (intentional)', { tag: '@layer:api' }, async () => {
      failOrderSync();
    });
  });

  test('differs from the screenshot baseline (intentional)', { tag: '@layer:ui' }, async ({ page }) => {
    // The committed baseline is a red square: this blue one never matches.
    await page.setViewportSize({ width: 200, height: 200 });
    await page.setContent('<div style="width: 100px; height: 100px; background: rgb(0, 0, 255)"></div>');
    await expect(page.locator('div')).toHaveScreenshot('square.png');
  });
});
