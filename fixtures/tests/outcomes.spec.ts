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

test.describe('skip reasons', () => {
  test('skips at runtime with a reason on one project', async ({}, testInfo) => {
    test.skip(testInfo.project.name === 'chromium-b', 'Runs on chromium-a only');
  });

  test('is marked fixme at runtime with a reason', async () => {
    test.fixme(true, 'Export button not implemented yet');
  });

  test.describe('skipped block', () => {
    test.skip(({ browserName }) => browserName === 'chromium', 'Not supported on Chromium');

    test('is skipped by its describe with a reason', async () => {});
  });

  // Playwright skips the tests after a failure in a serial group without any skip annotation: "Not run".
  test.describe.serial('serial group', () => {
    test('fails first in a serial group (intentional)', async () => {
      expect(['draft'], 'fails on purpose so the next test is not run').toEqual(['draft', 'published']);
    });

    test('is not run after a failure in its serial group', async () => {});
  });
});
