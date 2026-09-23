import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createEatsController } from '../../../packages/shared/src/eats-controller.mjs';
import { readEatsResponse } from '../../../packages/shared/src/eats-contracts.mjs';
import { createEatsTransport } from '../public/eats/transport.mjs';
const uuid = (n) => `00000000-0000-4000-a000-${String(n).padStart(12, '0')}`;
const user = { id: uuid(1), name: 'Customer', role: 'customer' };
const store = { id: uuid(2), name: 'Fictional Kitchen', cuisine: 'Nigerian', description: 'Test kitchen', address: '10 Fictional Road', areaId: 'wuse-ii', prepMinutes: 25, minimumKobo: 0, deliveryFeeKobo: 150_000, status: 'approved', isOpen: true, version: 3, createdAt: 1000, updatedAt: 1000 };
const menu = [{ id: uuid(3), name: 'Jollof rice', description: 'Rice and peppers', category: 'Meals', priceKobo: 250_000, available: true }];
const quote = { id: uuid(4), restaurant: { id: store.id, name: store.name, address: store.address, areaId: store.areaId, prepMinutes: 25 }, lines: [{ itemId: menu[0].id, ...menu[0], quantity: 1 }],
  totals: { subtotalKobo: 250_000, deliveryFeeKobo: 150_000, serviceFeeKobo: 12_500, totalKobo: 412_500, currency: 'NGN' }, address: { line: '20 Test Close', areaId: 'wuse-ii' }, instructions: '', isDemo: true, payment: { method: 'test', status: 'not_charged' }, expiresAt: 601_000 };
const order = { ...quote, id: uuid(5), status: 'placed', version: 0, role: 'customer', actions: ['cancel'], customerName: 'Customer', courier: null, events: [{ status: 'placed', at: 1000 }], createdAt: 1000, updatedAt: 1000 };
const deferred = () => { let resolve; const promise = new Promise((done) => { resolve = done; }); return { promise, resolve }; };
const flush = () => new Promise((resolve) => setImmediate(resolve));
function fixture() {
  let now = 1000, key = 0, restaurant = structuredClone(store);
  const writes = [], api = { async request(path) {
    if (path.startsWith('/eats/restaurants?q=')) return { restaurants: [restaurant], dishes: menu.map((item) => ({ ...item, seller: restaurant })), areas: [{ id: 'wuse-ii', name: 'Wuse II' }] };
    if (path.startsWith('/eats/restaurants/')) return { store: restaurant, menu };
    if (path.startsWith('/eats/orders/')) return { order };
    if (path === '/eats/orders') return { orders: [order], nextBefore: null };
    if (path === '/eats/store') return { store: null, menu: [], areas: [{ id: 'wuse-ii', name: 'Wuse II' }] };
    throw new Error('Unexpected read ' + path);
  }, async command(path, data, key) { writes.push({ path, data, key }); return path === '/eats/quotes' ? { quote } : { order }; } };
  const c = createEatsController({ api, makeKey: () => 'test-command-key-' + ++key, now: () => now });
  c.context(user);
  return { c, api, writes, advance(ms) { now += ms; }, changeStore(value) { restaurant = { ...restaurant, ...value }; } };
}
async function cart(f) { await f.c.refresh(); f.c.delivery(quote.address, ''); assert.equal(f.c.confirmDelivery(), true); await f.c.selectRestaurant(store.id); f.c.quantity(menu[0].id, 1); }

test('one-restaurant cart replacement is explicit and server quotes expire or invalidate on edits', async () => {
  const f = fixture(); await cart(f); await f.c.checkout(); assert.equal(f.c.snapshot().quote.id, quote.id);
  assert.equal(await f.c.selectRestaurant(uuid(10)), false); assert.equal(f.c.snapshot().cart[0].quantity, 1);
  assert.equal(f.c.snapshot().replaceRestaurantId, uuid(10)); f.c.keepRestaurant(); assert.equal(f.c.snapshot().restaurantId, store.id);
  f.c.quantity(menu[0].id, 2); assert.equal(f.c.snapshot().quote, null);
  f.c.quantity(menu[0].id, 1); await f.c.checkout(); f.advance(600_001); f.c.tick();
  assert.equal(f.c.snapshot().quote, null); assert.equal(await f.c.place(), false);
  assert.equal(f.writes.filter((w) => w.path === '/eats/orders').length, 0);
});

test('a changed menu clears the confirmed price while preserving the customer cart and address', async () => {
  const f = fixture(); await cart(f); await f.c.checkout(); f.changeStore({ version: 4 }); await f.c.refresh();
  assert.equal(f.c.snapshot().quote, null); assert.equal(f.c.snapshot().address.line, quote.address.line);
  assert.equal(f.c.snapshot().cart[0].quantity, 1);
});

test('quiet refresh preserves loaded history and pagination merges duplicate orders with fresh status', async () => {
  const f = fixture(), recent = { ...order, id: uuid(60), createdAt: 3000 }, older = { ...order, id: uuid(61), createdAt: 2000 }, oldest = { ...order, id: uuid(62), createdAt: 1000 };
  let updated = recent;
  f.api.request = async (path) => path.includes('?before=') ? { orders: [older, oldest], nextBefore: null } : { orders: [updated, older], nextBefore: older.id };
  await f.c.navigate('orders'); await f.c.refresh({ before: older.id });
  assert.deepEqual(f.c.snapshot().orders.map((o) => o.id), [recent.id, older.id, oldest.id]);
  updated = { ...recent, status: 'accepted', actions: [], version: 1 }; await f.c.refresh({ quiet: true });
  assert.equal(f.c.snapshot().orders.length, 3); assert.equal(f.c.snapshot().orders[0].status, 'accepted'); assert.equal(f.c.snapshot().nextBefore, null);
});

test('uncertain checkout freezes edits and retries the exact saved command once without a duplicate order', async () => {
  const f = fixture(); await cart(f); await f.c.checkout(); let attempts = 0;
  f.api.command = async (path, data, key) => { f.writes.push({ path, data, key }); if (!attempts++) throw new Error('Lost reply'); return { order }; };
  assert.equal(await f.c.place(), false); assert.equal(f.c.snapshot().uncertain, true);
  f.c.quantity(menu[0].id, 4); assert.equal(f.c.snapshot().cart[0].quantity, 1);
  assert.equal(await f.c.navigate('store'), false); assert.equal(await f.c.place(), false);
  assert.equal(await f.c.retry(), true);
  assert.deepEqual(f.writes.at(-1), f.writes.at(-2)); assert.deepEqual(f.c.snapshot().cart, []);
  assert.equal(f.c.snapshot().order.id, order.id); assert.equal(f.c.snapshot().screen, 'order'); assert.equal(f.c.snapshot().uncertain, false);
});

test('a late read or order response cannot populate a replacement account', async () => {
  const f = fixture(); await cart(f); await f.c.checkout(); const waiting = deferred(); f.api.command = () => waiting.promise;
  const action = f.c.place(); f.c.context({ ...user, id: uuid(30) }); waiting.resolve({ order }); await action;
  assert.equal(f.c.snapshot().order, null); assert.deepEqual(f.c.snapshot().cart, []);
  const read = deferred(); f.api.request = () => read.promise; const load = f.c.navigate('orders'); f.c.reset(); read.resolve({ orders: [order], nextBefore: null }); await load;
  assert.equal(f.c.snapshot().user, null); assert.deepEqual(f.c.snapshot().orders, []);
});

test('Eats response checks reject altered totals and handover codes projected to the wrong participant', () => {
  assert.equal(readEatsResponse({ order }).order.id, order.id);
  assert.throws(() => readEatsResponse({ quote: { ...quote, totals: { ...quote.totals, totalKobo: 1 } } }));
  assert.throws(() => readEatsResponse({ order: { ...order, pickupPin: '123456' } }));
  assert.throws(() => readEatsResponse({ order: { ...order, role: 'courier', deliveryPin: '123456' } }));
});

test('web Eats discards cross-tab private reads and checks cookie identity before any command', async () => {
  let account = { user, csrfToken: 'one' }, identity = `${user.id}:one`, invalidated = 0;
  const writes = [], client = { async request(path, options) { if (path === '/api/session') return account; if (options) writes.push(options); return { orders: [order], nextBefore: null }; } };
  const transport = createEatsTransport({ client, identity: () => identity, onChanged() { invalidated++; } });
  account = { user: { ...user, id: uuid(7) }, csrfToken: 'two' };
  await assert.rejects(transport.command('/eats/orders', { quoteId: quote.id }, 'exact-key'), /account changed/); assert.equal(writes.length, 0);
  await assert.rejects(transport.request('/eats/orders'), /account changed/); assert.equal(invalidated, 2);
  identity = `${account.user.id}:two`; await transport.command('/eats/orders', { quoteId: quote.id }, 'exact-key'); assert.equal(writes[0].key, 'exact-key');
});

test('an expired web session clears private Eats state immediately', async () => {
  let cleared = 0;
  const client = { async request() { throw Object.assign(new Error('Session expired'), { status: 401 }); } };
  const transport = createEatsTransport({ client, identity: () => `${user.id}:one`, onChanged() { cleared++; } });
  await assert.rejects(transport.request('/eats/orders'), /expired/); assert.equal(cleared, 1);
  await assert.rejects(transport.command('/eats/orders', {}, 'test-command-key'), /expired/); assert.equal(cleared, 2);
});

const html = await readFile(new URL('../public/eats.html', import.meta.url), 'utf8');
const viewSource = (await readFile(new URL('../public/eats/view.mjs', import.meta.url), 'utf8'))
  .replace("'../dashboard/dom.mjs'", `'${new URL('../public/dashboard/dom.mjs', import.meta.url)}'`)
  .replace("'/shared/eats.mjs'", `'${new URL('../../../packages/shared/src/eats.mjs', import.meta.url)}'`)
  .replace("'/shared/demo-booking.mjs'", `'${new URL('../../../packages/shared/src/demo-booking.mjs', import.meta.url)}'`);
const { createEatsView } = await import(`data:text/javascript;base64,${Buffer.from(viewSource).toString('base64')}`);
// Uses shipped element IDs; this fixture does not claim browser or device layout coverage.
function dom(t) {
  const original = globalThis.document, nodes = new Map();
  class Element {
    constructor(tag) { this.tag = tag; this.children = []; this.handlers = {}; this.value = ''; this.dataset = {}; this.disabled = false; }
    append(...children) { this.children.push(...children); if (this.tag === 'select' && !this.value && children[0]) this.value = children[0].value; }
    replaceChildren(...children) { this.children = children; }
    setAttribute(name, value) { this[name] = value; }
    addEventListener(name, handler) { this.handlers[name] = handler; }
    reset() {} focus() {} scrollIntoView() {} reportValidity() { return true; }
  }
  for (const [, tag, id] of html.matchAll(/<(\w+)\b[^>]*?\bid="([^"]+)"/g)) { assert.ok(!nodes.has(id), 'Duplicate HTML ID ' + id); nodes.set(id, new Element(tag)); }
  const node = (id) => { assert.ok(nodes.has('food-' + id), 'Missing shipped HTML ID ' + id); return nodes.get('food-' + id); };
  globalThis.document = { createElement: (tag) => new Element(tag), getElementById: (id) => node(id.slice(5)) };
  t.after(() => { globalThis.document = original; }); return node;
}

test('shipped Eats page connects menu buttons, delivery form and checkout to the shared order flow', async (t) => {
  const node = dom(t), f = fixture(), view = createEatsView(f.c); f.c.subscribe(() => view.render(f.c.snapshot()));
  view.render(f.c.snapshot()); await f.c.refresh();
  assert.equal(node('discovery-content').hidden, true);
  node('address').value = quote.address.line; node('area').value = quote.address.areaId;
  node('delivery-form').handlers.submit({ preventDefault() {} });
  assert.equal(node('discovery-content').hidden, false);
  await f.c.selectRestaurant(store.id);
  assert.equal(node('shopping').hidden, false);
  node('menu-list').children[0].children[1].children[2].handlers.click();
  assert.equal(f.c.snapshot().cart[0].quantity, 1);
  node('checkout-form').handlers.submit({ preventDefault() {} }); await flush();
  assert.equal(node('quote').hidden, false); assert.equal(node('place').disabled, false);
  assert.deepEqual(f.writes.at(-1).data.address, quote.address);
  node('place').handlers.click(); await flush();
  assert.equal(f.c.snapshot().screen, 'order'); assert.ok(node('order-detail').children.length > 0);
  f.c.reset(); assert.equal(node('app').hidden, true); assert.equal(node('order-detail').children.length, 0);
});

test('the seller page introduces onboarding before sign-in and opens the store workspace after sign-in', async (t) => {
  const node = dom(t), f = fixture(), view = createEatsView(f.c, { sellerPage: () => true });
  f.c.subscribe(() => view.render(f.c.snapshot()));
  f.c.reset(); view.render(f.c.snapshot());
  assert.equal(node('intro').hidden, true);
  assert.equal(node('seller-intro').hidden, false);
  assert.equal(node('seller-sign-in').hidden, false);
  f.c.context(user); await f.c.navigate('store');
  assert.equal(node('seller-sign-in').hidden, true);
  assert.equal(node('screen-store').hidden, false);
  assert.equal(node('store-form-title').textContent, 'Create your store');
});

test('a customer can remove an item from the cart after the restaurant marks it unavailable', async (t) => {
  const node = dom(t), f = fixture(), view = createEatsView(f.c); f.c.subscribe(() => view.render(f.c.snapshot()));
  await cart(f); await f.c.checkout(); const oldRead = f.api.request;
  f.api.request = (path) => path.startsWith('/eats/restaurants/') ? { store: { ...store, version: 4 }, menu: [] } : oldRead(path);
  await f.c.refresh({ quiet: true }); assert.equal(f.c.snapshot().quote, null); assert.equal(f.c.snapshot().cart.length, 1);
  node('cart-lines').children[0].children[1].handlers.click(); assert.deepEqual(f.c.snapshot().cart, []);
});
