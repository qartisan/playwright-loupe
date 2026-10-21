import { test } from '@playwright/test';
import { fetchResource } from '../../helpers/resources.js';

// Intentional failures through a shared helper: see fixtures/README.md. Do not "fix" these tests.

test.describe('orders', () => {
  test('loads the order history (intentional)', { tag: '@layer:api' }, async ({ request }) => {
    await fetchResource(request, '/api/orders/history', 404);
  });

  test('loads a shipped order (intentional)', { tag: '@layer:api' }, async ({ request }) => {
    await fetchResource(request, '/api/orders/42', 503);
  });
});
