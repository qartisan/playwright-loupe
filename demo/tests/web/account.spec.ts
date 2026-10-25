import { expect, test } from '@playwright/test';
import { accounts, signIn } from '../../support/session.js';

// Intentional failures are listed in demo/README.md.

test.describe('Account', { tag: ['@area:account', '@layer:ui'], annotation: { type: 'owner', description: 'Accounts' } }, () => {
  test.describe('sign-in', () => {
    test('shows the sign-in form', { tag: '@smoke' }, async ({ page }) => {
      await page.goto('/account');
      await expect(page.getByRole('form', { name: 'Sign in' })).toBeVisible();
    });

    test('rejects a wrong password', async ({ page }) => {
      await page.goto('/account');
      await page.getByLabel('Email').fill(accounts.customer.email);
      await page.getByLabel('Password').fill('not-the-password');
      await page.getByRole('button', { name: 'Sign in' }).click();
      await expect(page.getByRole('alert')).toHaveText('Incorrect email or password');
    });

    test('signs in through the form', async ({ page }) => {
      await page.goto('/account');
      await page.getByLabel('Email').fill(accounts.customer.email);
      await page.getByLabel('Password').fill(accounts.customer.password);
      await page.getByRole('button', { name: 'Sign in' }).click();
      await expect(page.getByText(`Signed in as ${accounts.customer.email}`)).toBeVisible();
    });

    test('signs out', async ({ page }) => {
      await signIn(page.request, accounts.customer);
      await page.goto('/account');
      await page.getByRole('button', { name: 'Sign out' }).click();
      await expect(page.getByRole('form', { name: 'Sign in' })).toBeVisible();
    });
  });

  test.describe('orders', () => {
    test('lists the orders of a returning customer', async ({ page }) => {
      await signIn(page.request, accounts.returningCustomer);
      await page.goto('/account');
      await expect(page.getByRole('row')).toHaveCount(3);
    });

    test('downloads an invoice', async ({ page }) => {
      await signIn(page.request, accounts.customer);
      await page.goto('/account');
      await expect(page.getByRole('link', { name: 'Download invoice' }).first()).toBeVisible({ timeout: 1_000 });
    });

    test('exports the order history', { annotation: { type: 'bug', description: 'DEMO-163' } }, async ({ page }) => {
      test.setTimeout(3_000);
      await signIn(page.request, accounts.customer);
      await page.goto('/account');
      await page.getByRole('button', { name: 'Export CSV' }).click();
    });
  });

  test('opens the staff dashboard', async ({ page }) => {
    await signIn(page.request, accounts.staff);
    await page.goto('/account');
    await expect(page.getByRole('heading', { name: 'Staff' })).toBeVisible();
  });
});
