// Demo Store front end. Some behaviors are wrong on purpose (price format,
// cart total, renamed invoice link, export button): see demo/README.md.

const SHIPPING = 4.9;
const page = document.body.dataset.page;

/** "14.00 €": the locale update moved the currency symbol (bug DEMO-142). */
const price = (amount) => `${amount.toFixed(2)} €`;

const cart = {
  read: () => JSON.parse(localStorage.getItem('cart') ?? '[]'),
  write: (items) => localStorage.setItem('cart', JSON.stringify(items)),
  add(id) {
    const items = cart.read();
    const item = items.find((entry) => entry.id === id);
    if (item) item.quantity += 1;
    else items.push({ id, quantity: 1 });
    cart.write(items);
    renderCartCount();
  },
};

async function getJson(url, init) {
  const response = await fetch(url, init);
  return { ok: response.ok, status: response.status, body: await response.json() };
}

function el(tag, props = {}, ...children) {
  const node = Object.assign(document.createElement(tag), props);
  node.append(...children);
  return node;
}

function renderCartCount() {
  const count = cart.read().reduce((sum, item) => sum + item.quantity, 0);
  document.querySelector('#cart-count').textContent = String(count);
}

async function catalogPage() {
  const list = document.querySelector('#products');
  const empty = document.querySelector('#empty');
  const search = document.querySelector('#search');
  const category = document.querySelector('#category');
  const sort = document.querySelector('#sort');
  const render = async () => {
    const query = new URLSearchParams({ q: search.value, category: category.value, sort: sort.value });
    const { body: products } = await getJson(`/api/products?${query}`);
    list.replaceChildren(
      ...products.map((product) => {
        const add = el('button', { type: 'button', textContent: 'Add to cart' });
        add.addEventListener('click', () => cart.add(product.id));
        return el(
          'li',
          { className: 'card' },
          el('a', { href: `/product?id=${product.id}` }, el('h2', { textContent: product.name })),
          el('p', { className: 'category', textContent: product.category }),
          el('p', { className: 'price', textContent: price(product.price) }),
          add,
        );
      }),
    );
    list.querySelectorAll('.card').forEach((card) => card.setAttribute('data-testid', 'product-card'));
    empty.hidden = products.length > 0;
  };
  for (const control of [search, category, sort]) control.addEventListener('input', render);
  await render();
}

async function productPage() {
  const id = new URLSearchParams(location.search).get('id');
  const { ok, body } = await getJson(`/api/products/${id}`);
  const main = document.querySelector('main');
  if (!ok) return main.replaceChildren(el('h1', { textContent: 'Product not found' }));
  document.title = `${body.name} · Demo Store`;
  const add = el('button', { type: 'button', textContent: 'Add to cart' });
  add.addEventListener('click', () => cart.add(body.id));
  main.replaceChildren(
    el('p', { className: 'category' }, el('a', { href: '/', textContent: 'Catalog' }), ` / ${body.category}`),
    el('h1', { textContent: body.name }),
    el('p', { className: 'description', textContent: body.description }),
    el('p', { className: 'price', textContent: price(body.price) }),
    add,
    el('section', { className: 'panel reviews' }, el('h2', { textContent: 'Reviews' }), el('p', { textContent: 'Reviews are coming soon.' })),
  );
}

async function cartPage() {
  const { body: products } = await getJson('/api/products');
  const lines = document.querySelector('#lines');
  const render = () => {
    const items = cart.read();
    document.querySelector('#empty').hidden = items.length > 0;
    lines.replaceChildren(
      ...items.map((item) => {
        const product = products.find((entry) => entry.id === item.id);
        const quantity = el('input', { type: 'number', min: '1', value: String(item.quantity) });
        quantity.setAttribute('aria-label', `Quantity for ${product.name}`);
        quantity.addEventListener('change', () => {
          cart.write(cart.read().map((entry) => (entry.id === item.id ? { ...entry, quantity: Number(quantity.value) } : entry)));
          render();
        });
        const remove = el('button', { type: 'button', className: 'secondary', textContent: 'Remove' });
        remove.addEventListener('click', () => {
          cart.write(cart.read().filter((entry) => entry.id !== item.id));
          render();
        });
        return el('div', { className: 'row' }, el('span', { className: 'name', textContent: product.name }), quantity, el('span', { textContent: price(product.price * item.quantity) }), remove);
      }),
    );
    const subtotal = items.reduce((sum, item) => sum + products.find((entry) => entry.id === item.id).price * item.quantity, 0);
    document.querySelector('#subtotal').textContent = price(subtotal);
    document.querySelector('#shipping').textContent = price(SHIPPING);
    // Bug DEMO-151: shipping is left out of the total.
    document.querySelector('#total').textContent = price(subtotal);
    renderCartCount();
  };
  render();

  const form = document.querySelector('#discount');
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const code = form.elements.code.value;
    const { ok, body } = await getJson('/api/discounts', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ code }) });
    document.querySelector('#discount-status').textContent = ok ? `${body.code} applied: −${body.percent}%` : body.error;
  });

  const delivery = document.querySelector('#delivery');
  const estimate = await getJson('/api/delivery-estimate');
  delivery.textContent = estimate.ok ? `Delivery in ${estimate.body.minDays}–${estimate.body.maxDays} business days` : 'Delivery estimate unavailable';
}

function checkoutPage() {
  const shipping = document.querySelector('#shipping-form');
  const payment = document.querySelector('#payment-form');
  shipping.addEventListener('submit', (event) => {
    event.preventDefault();
    shipping.hidden = true;
    payment.hidden = false;
  });
  payment.addEventListener('submit', async (event) => {
    event.preventDefault();
    const { ok, body } = await getJson('/api/payments', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
    document.querySelector('#payment-status').textContent = ok ? 'Order confirmed' : body.error;
  });
}

async function accountPage() {
  const signedIn = document.querySelector('#signed-in');
  const signInForm = document.querySelector('#sign-in');
  const me = await getJson('/api/me');
  if (!me.ok) {
    signInForm.hidden = false;
    signInForm.addEventListener('submit', async (event) => {
      event.preventDefault();
      const credentials = { email: signInForm.elements.email.value, password: signInForm.elements.password.value };
      const { ok, body } = await getJson('/api/session', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(credentials) });
      if (ok) location.reload();
      else document.querySelector('#sign-in-error').textContent = body.error;
    });
    return;
  }
  signedIn.hidden = false;
  document.querySelector('#who').textContent = `Signed in as ${me.body.email}`;
  document.querySelector('#sign-out').addEventListener('click', async () => {
    await fetch('/api/session', { method: 'DELETE' });
    location.reload();
  });
  const { body: orders } = await getJson('/api/orders');
  document.querySelector('#orders').replaceChildren(
    ...orders.map((order) =>
      el(
        'tr',
        {},
        el('td', { textContent: order.id }),
        el('td', { textContent: order.placedOn }),
        el('td', { textContent: price(order.total) }),
        el('td', { textContent: order.status }),
        // Renamed from "Download invoice" in the last redesign.
        el('td', {}, el('a', { href: `#invoice-${order.id}`, textContent: 'Invoice (PDF)' })),
      ),
    ),
  );
  // Bug: the export button is never enabled once the orders are loaded.
}

const PAGES = { catalog: catalogPage, product: productPage, cart: cartPage, checkout: checkoutPage, account: accountPage };
renderCartCount();
PAGES[page]?.();
