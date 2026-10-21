import { test } from '@playwright/test';
import { fetchResource } from '../../helpers/resources.js';

// Intentional failures through a shared helper: see fixtures/README.md. Do not "fix" these tests.

test.describe('invoices', () => {
  test('downloads an invoice (intentional)', { tag: '@layer:api' }, async ({ request }) => {
    await fetchResource(request, '/api/invoices/7/pdf', 404);
  });

  test('lists unpaid invoices (intentional)', { tag: '@layer:api' }, async ({ request }) => {
    await fetchResource(request, '/api/invoices?status=unpaid', 503);
  });
});
