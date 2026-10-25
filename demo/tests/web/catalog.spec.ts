import { expect, test } from '@playwright/test';
import { accounts, signIn } from '../../support/session.js';

// Intentional failures and skips are listed in demo/README.md.

test.describe('Catalog', { tag: ['@area:catalog', '@layer:ui'], annotation: { type: 'owner', description: 'Storefront' } }, () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
  });

  test('lists every product', { tag: '@smoke' }, async ({ page }) => {
    await expect(page.getByTestId('product-card')).toHaveCount(8);
  });

  test('filters products by category', async ({ page }) => {
    await page.getByLabel('Category').selectOption('Kitchen');
    await expect(page.getByTestId('product-card')).toHaveCount(2);
    await expect(page.getByRole('heading', { name: 'Stovetop kettle' })).toBeVisible();
  });

  test('sorts products by price', async ({ page }) => {
    await page.getByLabel('Sort by').selectOption('price');
    await expect(page.getByTestId('product-card').first().getByRole('heading')).toHaveText('Dotted notebook');
  });

  test.describe('search', () => {
    test('finds products by name', async ({ page }) => {
      await page.getByLabel('Search').fill('lamp');
      await expect(page.getByTestId('product-card')).toHaveCount(1);
      await expect(page.getByRole('heading', { name: 'Desk lamp' })).toBeVisible();
    });

    test('shows an empty state when nothing matches', async ({ page }) => {
      await page.getByLabel('Search').fill('umbrella');
      await expect(page.getByText('No products match your search.')).toBeVisible();
    });
  });

  test.describe('product page', () => {
    test('opens from the catalog', async ({ page }) => {
      await test.step('open the product', async () => {
        await page.getByRole('link', { name: 'Linen tote bag' }).click();
        await expect(page).toHaveURL(/\/product\?id=tote$/);
      });
      await test.step('check the details', async () => {
        await expect(page.getByRole('heading', { level: 1 })).toHaveText('Linen tote bag');
        await expect(page.getByText('Washed linen')).toBeVisible();
      });
    });

    test('shows customer reviews', async ({ page }) => {
      test.fixme(true, 'The reviews widget is being rebuilt');
      await page.getByRole('link', { name: 'Ceramic mug' }).click();
      await expect(page.getByRole('list', { name: 'Reviews' })).toBeVisible();
    });
  });

  test('shows prices with the currency symbol first', { annotation: { type: 'bug', description: 'DEMO-142' } }, async ({ page }) => {
    await expect(page.getByTestId('product-card').first().locator('.price')).toHaveText('€14.00', { timeout: 1_000 });
  });

  test('shows recently viewed products to a returning customer', async ({ page }) => {
    await signIn(page.request, accounts.returningCustomer);
    await page.reload();
    await expect(page.getByRole('region', { name: 'Recently viewed' })).toBeVisible();
  });

  test('keeps the product card design', async ({ page }) => {
    await expect(page.getByTestId('product-card').first()).toHaveScreenshot('product-card.png');
  });
});
