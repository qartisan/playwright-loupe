import { expect, test } from '@playwright/test';

// Intentional failures and skips are listed in demo/README.md.

// A video for this file only: the failing payment is worth watching. Set at
// file level: it needs its own worker.
test.use({ video: 'retain-on-failure' });

test.describe('Checkout', { tag: ['@area:checkout', '@layer:ui'], annotation: { type: 'owner', description: 'Payments' } }, () => {
  test.describe('card payment', () => {
    test('pays by card', { tag: '@smoke' }, async ({ page }) => {
      await page.goto('/checkout');
      await test.step('fill in the shipping address', async () => {
        await page.getByLabel('Full name').fill('Sam Example');
        await page.getByLabel('Street').fill('1 Market Street');
        await page.getByLabel('City').fill('Springfield');
        await page.getByLabel('Postcode').fill('12345');
        await page.getByRole('button', { name: 'Continue to payment' }).click();
      });
      await test.step('pay', async () => {
        await page.getByLabel('Card number').fill('4242 4242 4242 4242');
        await page.getByLabel('Expiry date').fill('12/30');
        await page.getByLabel('Security code').fill('123');
        await page.getByRole('button', { name: 'Pay now' }).click();
        await expect(page.getByRole('status')).toHaveText('Order confirmed', { timeout: 2_000 });
      });
    });
  });

  test('pays with a wallet', async ({ page }) => {
    test.skip(!process.env['WALLET_SANDBOX_URL'], 'Needs the wallet sandbox (WALLET_SANDBOX_URL)');
    await page.goto('/checkout');
  });
});
