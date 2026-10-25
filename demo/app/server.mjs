// Demo Store: a tiny invented shop for the Loupe demo suite. No dependency,
// no external network: it listens on 127.0.0.1 only. Some endpoints fail on
// purpose so the demo report has something to show; see demo/README.md.

import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { extname } from 'node:path';

const PORT = Number(process.env.PORT ?? 3917);
const PUBLIC = new URL('./public/', import.meta.url);

const PRODUCTS = [
  { id: 'mug', name: 'Ceramic mug', category: 'Kitchen', price: 14, description: 'Stoneware mug, 350 ml, dishwasher safe.' },
  { id: 'kettle', name: 'Stovetop kettle', category: 'Kitchen', price: 39, description: 'Enamelled steel, 1.5 l, whistling lid.' },
  { id: 'tote', name: 'Linen tote bag', category: 'Accessories', price: 24, description: 'Washed linen, inner pocket, long handles.' },
  { id: 'bottle', name: 'Water bottle', category: 'Accessories', price: 19, description: 'Insulated, 500 ml, keeps drinks cold for 24 hours.' },
  { id: 'lamp', name: 'Desk lamp', category: 'Home office', price: 59, description: 'Adjustable arm, warm LED, USB-C powered.' },
  { id: 'notebook', name: 'Dotted notebook', category: 'Home office', price: 12, description: 'A5, 160 pages, lay-flat binding.' },
  { id: 'throw', name: 'Wool throw', category: 'Living room', price: 79, description: 'Merino wool, 130 × 170 cm.' },
  { id: 'cushion', name: 'Cotton cushion', category: 'Living room', price: 29, description: 'Removable cover, 45 × 45 cm.' },
];

// Invented accounts. Only the first one can sign in: the other two are the
// broken test accounts behind the demo's common failure point.
const ACCOUNTS = {
  'ana@example.test': { password: 'demo-password', status: 200, error: null },
  'ben@example.test': { password: 'demo-password', status: 401, error: 'Password expired' },
  'staff@example.test': { password: 'demo-password', status: 403, error: 'Two-factor code required' },
};

const ORDERS = [
  { id: 'A-1042', placedOn: '2026-09-14', total: 53, status: 'Delivered' },
  { id: 'A-1067', placedOn: '2026-10-02', total: 24, status: 'Shipped' },
];

const DISCOUNTS = { WELCOME10: 10 };

/** Session token → e-mail. */
const sessions = new Map();
/** Delivery estimate clients already seen: their first request gets a 503 (cold start). */
const warmClients = new Set();
let nextOrder = 1100;

const TYPES = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8' };
const PAGES = { '/': 'index.html', '/product': 'product.html', '/cart': 'cart.html', '/checkout': 'checkout.html', '/account': 'account.html' };

function json(response, status, body, headers = {}) {
  response.writeHead(status, { 'content-type': 'application/json', ...headers });
  response.end(JSON.stringify(body));
}

async function readBody(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
  } catch {
    return {};
  }
}

function sessionOf(request) {
  const bearer = /^Bearer (.+)$/.exec(request.headers.authorization ?? '')?.[1];
  const cookie = /(?:^|;\s*)session=([^;]+)/.exec(request.headers.cookie ?? '')?.[1];
  return sessions.get(bearer ?? cookie ?? '') ?? null;
}

async function api(request, response, url) {
  const { pathname, searchParams } = url;
  const method = request.method ?? 'GET';

  if (method === 'GET' && pathname === '/api/products') {
    const category = searchParams.get('category');
    const query = searchParams.get('q')?.toLowerCase();
    let products = PRODUCTS.filter((product) => (!category || product.category === category) && (!query || product.name.toLowerCase().includes(query)));
    if (searchParams.get('sort') === 'price') products = [...products].sort((a, b) => a.price - b.price);
    return json(response, 200, products);
  }
  const product = /^\/api\/products\/([\w-]+)$/.exec(pathname);
  if (method === 'GET' && product) {
    const found = PRODUCTS.find((item) => item.id === product[1]);
    return found ? json(response, 200, found) : json(response, 404, { error: 'Product not found' });
  }
  // The inventory service is down in this environment: a server error shared by several tests.
  if (/^\/api\/inventory\/[\w-]+$/.test(pathname)) return json(response, 500, { error: 'Inventory database unreachable' });
  if (pathname === '/api/recommendations') return json(response, 429, { error: 'Too Many Requests' }, { 'retry-after': '30' });
  if (pathname === '/api/delivery-estimate') {
    const client = request.headers['x-client-id'];
    if (typeof client === 'string' && !warmClients.has(client)) {
      warmClients.add(client);
      return json(response, 503, { error: 'Delivery service is starting' });
    }
    return json(response, 200, { minDays: 2, maxDays: 3 });
  }

  if (method === 'POST' && pathname === '/api/session') {
    const { email, password } = await readBody(request);
    const account = ACCOUNTS[email];
    if (!account || account.password !== password) return json(response, 401, { error: 'Incorrect email or password' });
    if (account.status !== 200) return json(response, account.status, { error: account.error });
    const token = randomUUID();
    sessions.set(token, email);
    return json(response, 200, { token, email }, { 'set-cookie': `session=${token}; Path=/; HttpOnly; SameSite=Lax` });
  }
  if (method === 'DELETE' && pathname === '/api/session') {
    return json(response, 200, {}, { 'set-cookie': 'session=; Path=/; Max-Age=0' });
  }
  if (method === 'GET' && pathname === '/api/me') {
    const email = sessionOf(request);
    return email ? json(response, 200, { email }) : json(response, 401, { error: 'Not signed in' });
  }

  if (method === 'POST' && pathname === '/api/carts') {
    const { items } = await readBody(request);
    if (!Array.isArray(items) || items.some((item) => !(item.quantity > 0))) return json(response, 400, { error: 'Quantity must be positive' });
    return json(response, 201, { id: `C-${nextOrder++}`, items });
  }
  if (method === 'POST' && pathname === '/api/discounts') {
    const { code } = await readBody(request);
    const percent = DISCOUNTS[String(code ?? '').toUpperCase()];
    return percent ? json(response, 200, { code, percent }) : json(response, 404, { error: 'Unknown discount code' });
  }
  // The payment provider times out in this environment.
  if (method === 'POST' && pathname === '/api/payments') {
    return json(response, 502, { error: 'Payment provider unavailable. Your card was not charged.' });
  }

  if (pathname.startsWith('/api/orders')) {
    const email = sessionOf(request);
    if (!email) return json(response, 401, { error: 'Not signed in' });
    if (method === 'GET' && pathname === '/api/orders') return json(response, 200, ORDERS);
    if (method === 'POST' && pathname === '/api/orders') return json(response, 201, { id: `A-${nextOrder++}`, status: 'Placed' });
    if (method === 'GET' && pathname === '/api/orders/export') {
      await new Promise((resolve) => setTimeout(resolve, 1500));
      response.writeHead(200, { 'content-type': 'text/csv' });
      return response.end(['id,placedOn,total,status', ...ORDERS.map((order) => Object.values(order).join(','))].join('\n'));
    }
    const order = /^\/api\/orders\/([\w-]+)$/.exec(pathname);
    if (method === 'GET' && order) {
      const found = ORDERS.find((item) => item.id === order[1]);
      return found ? json(response, 200, found) : json(response, 404, { error: 'Order not found' });
    }
  }
  return json(response, 404, { error: 'Not found' });
}

const server = createServer(async (request, response) => {
  const url = new URL(request.url ?? '/', `http://${request.headers.host}`);
  if (url.pathname === '/health') return json(response, 200, { ok: true });
  if (url.pathname.startsWith('/api/')) return api(request, response, url);
  const file = PAGES[url.pathname] ?? (/^\/assets\/[\w-]+\.(?:css|js)$/.test(url.pathname) ? url.pathname.slice(1) : null);
  if (!file) {
    response.writeHead(404, { 'content-type': 'text/plain' });
    return response.end('Not found');
  }
  response.writeHead(200, { 'content-type': TYPES[extname(file)] });
  response.end(await readFile(new URL(file, PUBLIC)));
});

server.listen(PORT, '127.0.0.1', () => console.log(`Demo Store on http://127.0.0.1:${PORT}`));
