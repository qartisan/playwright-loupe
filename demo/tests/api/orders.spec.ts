import { expect, test } from '@playwright/test';
import { accounts, signIn } from '../../support/session.js';

// Intentional failures and skips are listed in demo/README.md.

test.describe('Orders API', { tag: ['@area:account', '@layer:api'], annotation: { type: 'owner', description: 'Accounts' } }, () => {
  test('refuses access without a session', async ({ request }) => {
    const response = await request.get('/api/orders');
    expect(response.status()).toBe(401);
  });

  test('returns an order by id', async ({ request }) => {
    await signIn(request, accounts.customer);
    const response = await request.get('/api/orders/A-1042');
    expect(await response.json()).toMatchObject({ id: 'A-1042', status: 'Delivered' });
  });

  test('lists the orders of a returning customer', async ({ request }) => {
    await signIn(request, accounts.returningCustomer);
    const response = await request.get('/api/orders');
    expect(await response.json()).toHaveLength(2);
  });

  test('lets staff see every order', async ({ request }) => {
    await signIn(request, accounts.staff);
    const response = await request.get('/api/orders');
    await expect(response).toBeOK();
  });

  test('exports orders as CSV', async ({ request }) => {
    await signIn(request, accounts.customer);
    const response = await request.get('/api/orders/export');
    expect(response.headers()['content-type']).toBe('text/csv');
    expect((await response.text()).split('\n')).toHaveLength(3);
  });
});

// Each step needs the previous one: when a step fails, Playwright does not run the next ones.
test.describe.serial('Order lifecycle', { tag: ['@area:checkout', '@layer:api'], annotation: { type: 'owner', description: 'Payments' } }, () => {
  let orderId = '';

  test('places an order', async ({ request }) => {
    await signIn(request, accounts.customer);
    const response = await request.post('/api/orders', { data: { items: [{ id: 'lamp', quantity: 1 }] } });
    expect(response.status()).toBe(201);
    orderId = ((await response.json()) as { id: string }).id;
  });

  test('checks stock before shipping', async ({ request }) => {
    await expect(await request.get('/api/inventory/lamp')).toBeOK();
  });

  test('ships the order', async ({ request }) => {
    await signIn(request, accounts.customer);
    await expect(await request.post(`/api/orders/${orderId}/ship`)).toBeOK();
  });

  test('sends the delivery notification', async ({ request }) => {
    await signIn(request, accounts.customer);
    await expect(await request.get(`/api/orders/${orderId}`)).toBeOK();
  });
});
