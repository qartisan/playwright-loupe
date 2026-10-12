import { expect, test } from '@playwright/test';

// Intentional outcomes: see fixtures/README.md. Do not "fix" these tests.

test.describe('structure', () => {
  test.describe('nested level', { tag: '@area:checkout' }, () => {
    test.describe('deepest level', () => {
      test('runs nested steps', { tag: ['@layer:ui', '@smoke'] }, async ({ page }) => {
        await test.step('open the page', async () => {
          await page.setContent('<button type="button">Pay</button>');
          await test.step('check the button', async () => {
            await expect(page.getByRole('button')).toHaveText('Pay');
          });
        });
      });
    });
  });

  test('writes to stdout and stderr', { tag: '@layer:api' }, async () => {
    console.log('Hello from the fixture suite');
    console.error('A warning from the fixture suite');
  });
});
