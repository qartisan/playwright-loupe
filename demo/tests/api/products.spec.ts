import { createServer, type AddressInfo } from 'node:net';
import { expect, test } from '@playwright/test';

// Intentional failures are listed in demo/README.md.

test.describe('Products API', { tag: ['@area:catalog', '@layer:api'], annotation: { type: 'owner', description: 'Storefront' } }, () => {
  test('lists products', { tag: '@smoke' }, async ({ request }) => {
    const response = await request.get('/api/products');
    await expect(response).toBeOK();
    const products = (await response.json()) as unknown[];
    await test.info().attach('products.json', { body: JSON.stringify(products, null, 2), contentType: 'application/json' });
    expect(products).toHaveLength(8);
  });

  test('returns one product', async ({ request }) => {
    const response = await request.get('/api/products/lamp');
    expect(await response.json()).toMatchObject({ id: 'lamp', name: 'Desk lamp', price: 59 });
  });

  test('returns 404 for an unknown product', async ({ request }) => {
    const response = await request.get('/api/products/umbrella');
    expect(response.status()).toBe(404);
  });

  test('filters products by category', async ({ request }) => {
    const response = await request.get('/api/products', { params: { category: 'Living room' } });
    const names = ((await response.json()) as Array<{ name: string }>).map((product) => product.name);
    expect(names).toEqual(['Wool throw', 'Cotton cushion']);
  });

  test('returns the stock of a product', async ({ request }) => {
    await expect(await request.get('/api/inventory/mug')).toBeOK();
  });

  test('recommends related products', async ({ request }) => {
    await expect(await request.get('/api/recommendations', { params: { product: 'mug' } })).toBeOK();
  });

  test('still answers on the legacy search endpoint', async ({ request }) => {
    // The legacy search service was shut down: nothing listens on its port any more.
    const server = createServer().listen(0, '127.0.0.1');
    await new Promise((resolve) => server.once('listening', resolve));
    const { port } = server.address() as AddressInfo;
    await new Promise((resolve) => server.close(resolve));
    await request.get(`http://127.0.0.1:${port}/search?q=mug`);
  });
});
