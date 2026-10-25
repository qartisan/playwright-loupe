import { expect, test } from '@playwright/test';

// Intentional failures are listed in demo/README.md.

test.describe('Cart API', { tag: ['@area:cart', '@layer:api'], annotation: { type: 'owner', description: 'Storefront' } }, () => {
  test('creates a cart', { tag: '@smoke' }, async ({ request }) => {
    const response = await request.post('/api/carts', { data: { items: [{ id: 'mug', quantity: 2 }] } });
    expect(response.status()).toBe(201);
    expect(await response.json()).toMatchObject({ items: [{ id: 'mug', quantity: 2 }] });
  });

  test('rejects a negative quantity', async ({ request }) => {
    const response = await request.post('/api/carts', { data: { items: [{ id: 'mug', quantity: -1 }] } });
    expect(response.status()).toBe(400);
  });

  test('rejects an unknown discount code', async ({ request }) => {
    const response = await request.post('/api/discounts', { data: { code: 'NOTACODE' } });
    expect(response.status()).toBe(404);
  });

  test('reserves stock for the cart items', async ({ request }) => {
    await expect(await request.get('/api/inventory/tote')).toBeOK();
  });

  test('estimates the delivery date', async ({ request }) => {
    // The delivery service has a cold start: it answers 503 to each client's first request.
    const response = await request.get('/api/delivery-estimate', { headers: { 'x-client-id': test.info().testId } });
    await expect(response).toBeOK();
    expect(await response.json()).toEqual({ minDays: 2, maxDays: 3 });
  });
});
