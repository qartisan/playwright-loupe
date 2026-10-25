import { expect, test } from '@playwright/test';

// Intentional failures and skips are listed in demo/README.md.

// Traces for this file only: enough to show the trace card, small enough for
// the live demo. Set at file level: it needs its own worker.
test.use({ trace: 'retain-on-failure' });

test.describe('Cart', { tag: ['@area:cart', '@layer:ui'], annotation: { type: 'owner', description: 'Storefront' } }, () => {
  test.describe('with a product', () => {
    test.beforeEach(async ({ page }) => {
      await page.goto('/');
      await page.getByTestId('product-card').filter({ hasText: 'Ceramic mug' }).getByRole('button', { name: 'Add to cart' }).click();
      await page.getByRole('link', { name: /^Cart/ }).click();
    });

    test('adds a product to the cart', { tag: '@smoke' }, async ({ page }) => {
      await expect(page.getByRole('region', { name: 'Cart items' })).toContainText('Ceramic mug');
      await expect(page.getByRole('link', { name: 'Cart (1)' })).toBeVisible();
    });

    test('updates the quantity', async ({ page }) => {
      await page.getByLabel('Quantity for Ceramic mug').fill('3');
      await page.getByLabel('Quantity for Ceramic mug').press('Enter');
      await expect(page.getByLabel('Order summary')).toContainText('Subtotal 42.00 €');
    });

    test('removes a product', async ({ page }) => {
      await page.getByRole('button', { name: 'Remove' }).click();
      await expect(page.getByText('Your cart is empty.')).toBeVisible();
    });

    test('adds shipping to the total', { annotation: { type: 'bug', description: 'DEMO-151' } }, async ({ page }) => {
      await test.step('check the order summary', async () => {
        await expect(page.locator('#shipping')).toHaveText('4.90 €');
        await test.step('check the total', async () => {
          await expect(page.getByTestId('cart-total')).toHaveText('Total 18.90 €', { timeout: 1_000 });
        });
      });
    });

    test('applies a discount code', async ({ page }) => {
      await page.getByLabel('Discount code').fill('WELCOME10');
      await page.getByRole('button', { name: 'Apply' }).click();
      await expect(page.locator('#discount-status')).toHaveText('WELCOME10 applied: −10%');
    });

    test('applies two discount codes at once', async ({ page }) => {
      test.fixme(true, 'Stacked discount codes are being redesigned');
      await page.getByLabel('Discount code').fill('WELCOME10, SPRING5');
      await page.getByRole('button', { name: 'Apply' }).click();
    });
  });

  test('shows the delivery estimate', async ({ page }) => {
    // The delivery service has a cold start: it answers 503 to each client's
    // first request. The client id is set before the first page loads.
    await page.context().setExtraHTTPHeaders({ 'x-client-id': test.info().testId });
    await page.goto('/cart');
    await expect(page.locator('#delivery')).toHaveText('Delivery in 2–3 business days', { timeout: 2_000 });
  });
});
