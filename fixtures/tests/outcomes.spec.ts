import { expect, test } from '@playwright/test';

// Intentional outcomes: see fixtures/README.md. Do not "fix" these tests.

test.describe('outcomes', () => {
  test('is flaky: fails on the first attempt, passes on retry (intentional)', { tag: '@layer:api' }, async ({}, testInfo) => {
    // One attachment per attempt, so the report shows that each attempt keeps its own.
    await testInfo.attach('attempt', { body: `attempt ${testInfo.retry}`, contentType: 'text/plain' });
    expect(testInfo.retry, 'fails on the first attempt on purpose').toBeGreaterThan(0);
  });

  test.skip('is skipped (intentional)', async () => {});

  test.fixme('is marked fixme (intentional)', async () => {});

  test('is slow (about 3 s)', { tag: '@layer:ui' }, async ({ page }) => {
    await page.setContent('<p>Slow</p>');
    await page.waitForTimeout(3_000);
    await expect(page.getByText('Slow')).toBeVisible();
  });
});
