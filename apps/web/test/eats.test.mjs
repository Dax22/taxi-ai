import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createEatsController } from '../../../packages/shared/src/eats-controller.mjs';
import { readEatsResponse } from '../../../packages/shared/src/eats-contracts.mjs';
import { foodAreaId } from '../../../packages/shared/src/nigeria-areas.mjs';
import { mealTotals } from '../../../packages/shared/src/eats-meals.mjs';
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
    if (path === '/eats/restaurants' || path.startsWith('/eats/restaurants?')) return { restaurants: [restaurant], areas: [{ id: 'wuse-ii', name: 'Wuse II' }] };
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
async function cart(f) { await f.c.refresh(); f.c.delivery(quote.address, ''); await f.c.selectRestaurant(store.id); f.c.quantity(menu[0].id, 1); }

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
const imports = (source) => source
  .replace("'../dashboard/dom.mjs'", `'${new URL('../public/dashboard/dom.mjs', import.meta.url)}'`)
  .replace("'/shared/eats.mjs'", `'${new URL('../../../packages/shared/src/eats.mjs', import.meta.url)}'`)
  .replace("'/shared/nigeria-areas.mjs'", `'${new URL('../../../packages/shared/src/nigeria-areas.mjs', import.meta.url)}'`)
  .replace("'/shared/locations.mjs'", `'${new URL('../../../packages/shared/src/locations.mjs', import.meta.url)}'`)
  .replace("'../dashboard/geolocation.mjs'", `'${new URL('../public/dashboard/geolocation.mjs', import.meta.url)}'`)
  .replace("'./location-fields.mjs'", `'data:text/javascript;base64,${Buffer.from(locationSource).toString('base64')}'`)
  .replace("'/shared/demo-booking.mjs'", `'${new URL('../../../packages/shared/src/demo-booking.mjs', import.meta.url)}'`);
const locationSource = (await readFile(new URL('../public/eats/location-fields.mjs', import.meta.url), 'utf8'))
  .replace("'../dashboard/dom.mjs'", `'${new URL('../public/dashboard/dom.mjs', import.meta.url)}'`)
  .replace("'/shared/nigeria-areas.mjs'", `'${new URL('../../../packages/shared/src/nigeria-areas.mjs', import.meta.url)}'`);
const mealSource = imports(await readFile(new URL('../public/eats/meal-view.mjs', import.meta.url), 'utf8'));
const viewSource = imports(await readFile(new URL('../public/eats/view.mjs', import.meta.url), 'utf8'))
  .replace("'./photo-view.mjs'", `'${new URL('../public/eats/photo-view.mjs', import.meta.url)}'`)
  .replace("'./photo-upload.mjs'", `'${new URL('../public/eats/photo-upload.mjs', import.meta.url)}'`)
  .replace("'./photo-manager.mjs'", `'${new URL('../public/eats/photo-manager.mjs', import.meta.url)}'`)
  .replace("'./meal-view.mjs'", `'data:text/javascript;base64,${Buffer.from(mealSource).toString('base64')}'`);
const { createEatsView } = await import(`data:text/javascript;base64,${Buffer.from(viewSource).toString('base64')}`);
// Uses shipped element IDs; this fixture does not claim browser or device layout coverage.
function dom(t) {
  const original = globalThis.document, nodes = new Map();
  class Element {
    constructor(tag) { this.tag = tag; this.children = []; this.handlers = {}; this.value = ''; this.dataset = {}; this.disabled = false; }
    append(...children) { this.children.push(...children); if (this.tag === 'select' && !this.value && children[0]) this.value = children[0].value; }
    replaceChildren(...children) { this.children = children; }
    setAttribute(name, value) { this[name] = value; }
    removeAttribute(name) { delete this[name]; }
    addEventListener(name, handler) { this.handlers[name] = handler; }
    querySelectorAll(tag) { return this.children.flatMap((child) => [ ...(child.tag === tag ? [child] : []), ...child.querySelectorAll(tag) ]); }
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
  f.c.delivery(quote.address, '');
  await f.c.selectRestaurant(store.id);
  assert.equal(node('shopping').hidden, false);
  node('menu-list').children[0].children[1].children[2].handlers.click();
  assert.equal(f.c.snapshot().cart[0].quantity, 1);
  node('address').value = quote.address.line; node('state').value = 'fct'; node('town').value = 'Wuse II';
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

test('pickup selection invalidates a delivery quote, freezes during uncertain writes and resets with the account', async () => {
  const f = fixture(); await cart(f); await f.c.checkout(); f.c.fulfillment('pickup');
  assert.equal(f.c.snapshot().quote, null); assert.equal(f.c.snapshot().fulfillment, 'pickup');
  f.api.command = async (path, data, key) => { f.writes.push({ path, data, key }); throw new Error('Lost reply'); };
  await f.c.checkout(); assert.equal(f.writes.at(-1).data.fulfillment, 'pickup');
  f.c.fulfillment('delivery'); assert.equal(f.c.snapshot().fulfillment, 'pickup');
  f.c.context({ ...user, id: uuid(29) }); assert.equal(f.c.snapshot().fulfillment, 'delivery');
});

test('meal-photo reads are bounded, deduplicated and discarded after an account change', async () => {
  const f = fixture(), pending = deferred(); let calls = 0;
  f.api.request = () => { calls++; return pending.promise; };
  const first = f.c.photo(uuid(100)), duplicate = f.c.photo(uuid(100)); assert.equal(calls, 1);
  f.c.context({ ...user, id: uuid(99) }); pending.resolve({ photo: { id: uuid(100), mimeType: 'image/jpeg', base64: 'aGVsbG8=' } });
  assert.equal(await first, null); assert.equal(await duplicate, null);
  assert.throws(() => readEatsResponse({ photo: { id: uuid(100), mimeType: 'image/svg+xml', base64: 'aGVsbG8=' } }));
  assert.throws(() => readEatsResponse({ store: { ...store, sellerType: 'home_kitchen', addressHidden: true }, menu }));
});

test('shipped home-kitchen controls filter discovery, preselect seller type and send pickup without a street address', async (t) => {
  const node = dom(t), f = fixture(); f.changeStore({ sellerType: 'home_kitchen', pickupEnabled: true, addressHidden: true, address: '' });
  const view = createEatsView(f.c); f.c.subscribe(() => view.render(f.c.snapshot())); await f.c.navigate('browse');
  node('seller-filter').value = 'restaurant'; node('seller-filter').handlers.change(); assert.match(node('results').textContent, /^0 kitchens/);
  node('seller-filter').value = 'home_kitchen'; node('seller-filter').handlers.change(); assert.match(node('results').textContent, /^1 kitchen/);
  node('pickup-mode').handlers.click(); await f.c.selectRestaurant(store.id); f.c.quantity(menu[0].id, 1);
  assert.equal(node('delivery-fields').hidden, true); assert.equal(node('address').required, false);
  node('checkout-form').handlers.submit({ preventDefault() {} }); await flush(); assert.equal(f.writes.at(-1).data.fulfillment, 'pickup');
  node('home-start').handlers.click(); await flush(); assert.equal(f.c.snapshot().screen, 'store'); assert.equal(node('store-type').value, 'home_kitchen');
  assert.equal(node('store-address-row').hidden, true); assert.equal(node('store-address').required, false);
});

for (const sellerType of ['restaurant', 'food_vendor', 'home_kitchen']) test(`web ${sellerType} discovery and registration follow the public address rule`, async (t) => {
  const node = dom(t), f = fixture(), privateKitchen = sellerType !== 'restaurant';
  // A stale listing must not cause a private street to appear in public cards.
  f.changeStore({ sellerType, address: '17 Fictional Street Wuse II' });
  const view = createEatsView(f.c); f.c.subscribe(() => view.render(f.c.snapshot()));
  await f.c.navigate('browse');
  const visibleText = (n) => [n.textContent ?? '', ...n.children.map(visibleText)].join(' ');
  assert.equal(visibleText(node('restaurants')).includes('17 Fictional Street Wuse II'), !privateKitchen);
  assert.match(visibleText(node('restaurants')), /Wuse II/);
  node('store').handlers.click(); await flush();
  node('store-type').value = sellerType; node('store-type').handlers.change();
  assert.equal(node('store-address-row').hidden, privateKitchen);
  assert.equal(node('store-address').required, !privateKitchen);
  node('store-address').value = '17 Fictional Street Wuse II'; node('store-state').value = 'fct'; node('store-town').value = 'Wuse II'; node('store-town').handlers.input();
  node('store-minimum').value = '0'; node('store-fee').value = '1500';
  node('store-form').handlers.submit({ preventDefault() {} }); await flush();
  assert.equal(f.writes.at(-1).data.details.address, privateKitchen ? '' : '17 Fictional Street Wuse II');
});

function mealFixture() {
  const f = fixture(), second = { ...store, id: uuid(20), name: 'Home Test Kitchen', sellerType: 'home_kitchen', address: '', addressHidden: true };
  const foods = [{ store, item: menu[0] }, { store: second, item: { ...menu[0], id: uuid(21), name: 'Fried plantain', portionsRemaining: 5 } }];
  const quotes = [{ ...quote, fulfillment: 'delivery' }, { ...quote, id: uuid(22), fulfillment: 'delivery', restaurant: { id: second.id, name: second.name, sellerType: 'home_kitchen', address: '', addressHidden: true, areaId: 'wuse-ii' }, lines: [{ ...quote.lines[0], itemId: uuid(21), name: 'Fried plantain' }] }];
  const checkout = { id: uuid(23), quotes, totals: mealTotals(quotes), expiresAt: quote.expiresAt };
  const orders = quotes.map((q, i) => ({ ...order, ...q, id: uuid(30 + i) }));
  const reads = [], oldRead = f.api.request;
  f.api.request = async (path) => {
    reads.push(path);
    if (path.startsWith('/eats/foods?')) return { foods, foodCount: foods.length, nextOffset: null, area: { id: 'wuse-ii', name: 'Wuse II' } };
    if (path === '/eats/restaurants' || path.startsWith('/eats/restaurants?')) return { restaurants: [store, second], areas: [{ id: 'wuse-ii', name: 'Wuse II' }] };
    if (path === '/eats/orders') return { orders, nextBefore: null };
    return oldRead(path);
  };
  f.api.command = async (path, data, key) => { f.writes.push({ path, data, key }); return path === '/eats/checkouts' ? { checkout } : { checkoutId: checkout.id, orders, nextBefore: null }; };
  return { ...f, reads, foods, checkout, orders };
}

test('shipped meal builder asks for location first, searches menu dishes, combines kitchens and reviews every fee', async (t) => {
  const node = dom(t), f = mealFixture(), view = createEatsView(f.c); f.c.subscribe(() => view.render(f.c.snapshot()));
  await f.c.navigate('browse');
  assert.equal(node('meal-builder').hidden, true); assert.equal(node('kitchen-browser').hidden, true);
  assert.equal(f.reads.some((p) => p.startsWith('/eats/foods')), false);
  node('meal-address').value = quote.address.line; node('meal-state').value = 'fct'; node('meal-town').value = 'Wuse II';
  node('meal-location-form').handlers.submit({ preventDefault() {} }); await flush();
  assert.equal(node('meal-builder').hidden, false); assert.equal(node('meal-location-form').hidden, true);
  node('meal-query').value = 'jollof and plantain'; node('meal-search-form').handlers.submit({ preventDefault() {} }); await flush();
  assert.ok(f.reads.at(-1).includes('q=jollof%20and%20plantain'));
  for (const b of node('meal-results').querySelectorAll('button').filter((b) => b['aria-label']?.startsWith('Add one'))) b.handlers.click();
  assert.equal(f.c.snapshot().mealBasket.length, 2);
  node('meal-review').handlers.click(); await flush();
  assert.equal(f.writes.at(-1).path, '/eats/checkouts'); assert.equal(f.writes.at(-1).data.groups.length, 2);
  assert.equal(node('meal-checkout').hidden, false); assert.equal(node('meal-quotes').children.length, 3);
  node('meal-place').handlers.click(); await flush();
  assert.equal(f.c.snapshot().screen, 'orders'); assert.equal(f.c.snapshot().orders.length, 2); assert.equal(f.c.snapshot().mealBasket.length, 0);
  f.c.reset(); assert.equal(node('meal-address').value, ''); assert.equal(node('meal-results').children.length, 0);
});

test('combined checkout retries the identical request after a lost reply and blocks basket or location changes', async () => {
  const f = mealFixture(); await f.c.navigate('browse'); await f.c.confirmDelivery(quote.address);
  for (const food of f.foods) f.c.mealQuantity(food, 1);
  await f.c.reviewMeal(); let attempts = 0;
  f.api.command = async (path, data, key) => { f.writes.push({ path, data, key }); if (!attempts++) throw new Error('Lost reply'); return { checkoutId: f.checkout.id, orders: f.orders, nextBefore: null }; };
  assert.equal(await f.c.placeMeal(), false); f.c.editDelivery(); f.c.mealQuantity(f.foods[0], 0);
  assert.equal(f.c.snapshot().deliveryConfirmed, true); assert.equal(f.c.snapshot().mealBasket.length, 2);
  assert.equal(await f.c.findMeals('suya'), false);
  assert.equal(await f.c.retry(), true); assert.deepEqual(f.writes.at(-1), f.writes.at(-2));
  assert.equal(f.c.snapshot().mealBasket.length, 0); assert.equal(f.c.snapshot().screen, 'orders');
});

test('changing location or account invalidates meal quotes and late search results cannot replace a newer search', async () => {
  const f = mealFixture(); await f.c.navigate('browse');
  assert.equal(await f.c.confirmDelivery({ line: 'short', areaId: 'wuse-ii' }), false);
  assert.equal(f.c.snapshot().deliveryConfirmed, false);
  await f.c.confirmDelivery(quote.address); await f.c.findMeals('jollof and plantain'); f.c.mealQuantity(f.foods[0], 1); await f.c.reviewMeal();
  f.c.editDelivery(); assert.equal(f.c.snapshot().mealCheckout, null); assert.deepEqual(f.c.snapshot().foods, []);
  await f.c.confirmDelivery(quote.address);
  assert.equal(f.c.snapshot().foodQuery, 'jollof and plantain');
  assert.ok(f.reads.at(-1).includes('q=jollof%20and%20plantain'));
  const first = deferred(), second = deferred(); let count = 0;
  f.api.request = () => count++ ? second.promise : first.promise;
  const older = f.c.findMeals('rice'), newer = f.c.findMeals('plantain');
  const response = (foods) => ({ foods, foodCount: foods.length, nextOffset: null, area: { id: 'wuse-ii', name: 'Wuse II' } });
  second.resolve(response([f.foods[1]])); await newer; first.resolve(response([f.foods[0]])); await older;
  assert.equal(f.c.snapshot().foods[0].item.name, 'Fried plantain');
  const late = deferred(); f.api.request = () => late.promise; const pending = f.c.findMeals('rice');
  f.c.context({ ...user, id: uuid(99) }); late.resolve(response(f.foods)); await pending;
  assert.deepEqual(f.c.snapshot().foods, []); assert.deepEqual(f.c.snapshot().mealBasket, []); assert.equal(f.c.snapshot().deliveryConfirmed, false);
});

test('combined response checks reject altered totals, duplicate kitchens and mismatched expiry', () => {
  const f = mealFixture(); assert.equal(readEatsResponse({ checkout: f.checkout }).checkout.id, f.checkout.id);
  assert.throws(() => readEatsResponse({ checkout: { ...f.checkout, totals: { ...f.checkout.totals, totalKobo: 1 } } }));
  assert.throws(() => readEatsResponse({ checkout: { ...f.checkout, quotes: [f.checkout.quotes[0], f.checkout.quotes[0]] } }));
  assert.throws(() => readEatsResponse({ checkout: { ...f.checkout, expiresAt: f.checkout.expiresAt + 1 } }));
  assert.throws(() => readEatsResponse({ checkoutId: f.checkout.id, orders: [f.orders[0], f.orders[0]], nextBefore: null }));
});

test('loaded dish pages refresh availability and a removed individual kitchen cannot block the combined basket', async () => {
  const f = mealFixture(), oldRead = f.api.request;
  let foods = Array.from({ length: 65 }, (_, i) => ({ store, item: { ...menu[0], id: uuid(100 + i) } }));
  f.api.request = async (path) => {
    if (!path.startsWith('/eats/foods?')) return oldRead(path);
    const offset = Number(new URL(path, 'https://test.invalid').searchParams.get('offset') ?? 0);
    return { foods: foods.slice(offset, offset + 60), foodCount: foods.length, nextOffset: offset + 60 < foods.length ? offset + 60 : null, area: { id: 'wuse-ii', name: 'Wuse II' } };
  };
  await f.c.navigate('browse'); await f.c.confirmDelivery(quote.address); await f.c.findMeals('', true);
  assert.equal(f.c.snapshot().foods.length, 65);
  foods = foods.slice(1); await f.c.refresh({ quiet: true });
  assert.equal(f.c.snapshot().foods.length, 64); assert.equal(f.c.snapshot().foods.some((f) => f.item.id === uuid(100)), false);
  await f.c.selectRestaurant(store.id); f.c.mealQuantity(f.foods[1], 1);
  const currentRead = f.api.request;
  f.api.request = async (path) => { if (path.startsWith('/eats/restaurants/')) throw Object.assign(new Error('Kitchen unavailable'), { status: 404 }); return currentRead(path); };
  assert.equal(await f.c.reviewMeal(), true); assert.equal(f.c.snapshot().restaurant, null); assert.ok(f.c.snapshot().mealCheckout);
});


test('nationwide Eats asks for a state and town, keeps incomplete typing, and searches the chosen locality', async (t) => {
  const node = dom(t), f = mealFixture(), view = createEatsView(f.c); f.c.subscribe(() => view.render(f.c.snapshot()));
  await f.c.navigate('browse');
  assert.equal(node('meal-state').children.length, 38);
  node('meal-state').value = 'lagos'; node('meal-town').value = 'Ikorodu'; node('meal-address').value = '20 Fictional Road';
  node('meal-location-form').handlers.submit({ preventDefault() {} }); await flush();
  assert.equal(f.c.snapshot().address.areaId, foodAreaId('lagos', 'Ikorodu'));
  assert.ok(f.reads.some((path) => path.includes(encodeURIComponent(foodAreaId('lagos', 'Ikorodu')))));
  assert.match(node('meal-destination-text').textContent, /Ikorodu, Lagos/);
  node('state').value = 'kaduna'; node('state').handlers.change();
  node('town').value = 'Z'; node('town').handlers.input();
  assert.equal(node('state').value, 'kaduna'); assert.equal(node('town').value, 'Z');
  node('town').value = 'Zaria'; node('town').handlers.input();
  assert.equal(f.c.snapshot().address.areaId, foodAreaId('kaduna', 'Zaria'));
});

test('nationwide kitchen creation starts blank and delivery coverage is explicit and local', async (t) => {
  const node = dom(t), f = fixture(), view = createEatsView(f.c); f.c.subscribe(() => view.render(f.c.snapshot()));
  await f.c.navigate('store');
  assert.equal(node('store-state').value, ''); assert.equal(node('store-town').value, '');
  assert.equal(node('store-delivery-areas').children.length, 0);
  node('store-state').value = 'oyo'; node('store-town').value = 'Ibadan'; node('store-town').handlers.input();
  assert.equal(node('store-delivery-areas').children.length, 1);
  node('coverage-state').value = 'oyo'; node('coverage-town').value = 'Akobo'; node('coverage-add').handlers.click();
  assert.equal(node('store-delivery-areas').children.length, 2);
  node('store-type').value = 'home_kitchen'; node('store-form').handlers.submit({ preventDefault() {} }); await flush();
  assert.deepEqual(f.writes.at(-1).data.details.deliveryAreaIds, [foodAreaId('oyo', 'Ibadan'), foodAreaId('oyo', 'Akobo')]);
  assert.equal(f.writes.at(-1).data.details.address, ''); assert.equal(f.writes.at(-1).data.details.dispatchPoint, null);
});

test('kitchen pickup GPS needs an explicit action and is private in the owner command', async (t) => {
  const node = dom(t), f = fixture(); let locates = 0;
  const point = { lat: 6.6018, lng: 3.3515 }, geolocation = { supported: () => true, async locate() { locates++; return { coords: { latitude: point.lat, longitude: point.lng, accuracy: 20 } }; } };
  let saved = null; const originalRead = f.api.request;
  f.api.request = async (path) => path === '/eats/store' ? { store: saved, menu: [], areas: [] } : path.startsWith('/eats/orders?') ? { orders: [], nextBefore: null } : originalRead(path);
  f.api.command = async (path, data, key) => { f.writes.push({ path, data, key }); saved = { ...store, ...data.details, version: (saved?.version ?? 0) + 1 }; return { store: saved, menu: [] }; };
  const view = createEatsView(f.c, { geolocation }); f.c.subscribe(() => view.render(f.c.snapshot())); await f.c.navigate('store');
  assert.equal(locates, 0); node('store-state').value = 'lagos'; node('store-town').value = 'Ikeja'; node('store-town').handlers.input();
  await node('dispatch-locate').handlers.click(); assert.equal(locates, 1);
  node('store-form').handlers.submit({ preventDefault() {} }); await flush();
  assert.deepEqual(f.writes.at(-1).data.details.dispatchPoint, point);
  assert.equal(node('dispatch-status').textContent.includes(String(point.lat)), false);
  node('dispatch-clear').handlers.click(); node('store-form').handlers.submit({ preventDefault() {} }); await flush();
  assert.equal(f.writes.at(-1).data.details.dispatchPoint, null);
});

test('a delayed kitchen GPS response cannot populate a different account', async (t) => {
  const node = dom(t), f = fixture(), pending = deferred();
  const view = createEatsView(f.c, { geolocation: { supported: () => true, locate: () => pending.promise } }); f.c.subscribe(() => view.render(f.c.snapshot())); await f.c.navigate('store');
  const locate = node('dispatch-locate').handlers.click();
  f.c.context({ ...user, id: uuid(80) }); await f.c.navigate('store');
  pending.resolve({ coords: { latitude: 6.6018, longitude: 3.3515, accuracy: 20 } }); await locate;
  assert.match(node('dispatch-status').textContent, /No private pickup location/);
  assert.equal(node('store-state').value, ''); assert.equal(node('store-town').value, '');
});

test('kitchen town filtering queries the server and leaves the delivery address and meal intact', async (t) => {
  const node = dom(t), f = mealFixture(), view = createEatsView(f.c); f.c.subscribe(() => view.render(f.c.snapshot()));
  await f.c.navigate('browse'); await f.c.confirmDelivery(quote.address); f.c.mealQuantity(f.foods[0], 1);
  const initialReads = f.reads.length;
  node('state-filter').value = 'lagos'; node('town-filter').value = 'Ikeja';
  assert.equal(f.reads.length, initialReads);
  node('kitchen-filter-apply').handlers.click(); await flush();
  assert.ok(f.reads.some((path) => path.startsWith('/eats/restaurants?') && new URL(path, 'https://test.invalid').searchParams.get('areaId') === foodAreaId('lagos', 'Ikeja')));
  assert.deepEqual(f.c.snapshot().address, quote.address); assert.equal(f.c.snapshot().mealBasket.length, 1);
  assert.match(node('kitchen-filter-status').textContent, /Ikeja, Lagos/);
  node('kitchen-filter-clear').handlers.click(); await flush();
  assert.equal(f.c.snapshot().catalogAreaId, ''); assert.equal(node('state-filter').value, ''); assert.equal(node('town-filter').value, '');
});

test('dish and kitchen listings use neutral placeholders while editorial illustrations stay labelled', async (t) => {
  const node = dom(t), f = mealFixture(), view = createEatsView(f.c); f.c.subscribe(() => view.render(f.c.snapshot()));
  await f.c.navigate('browse'); await f.c.confirmDelivery(quote.address); await f.c.selectRestaurant(store.id);
  const text = (n) => [n.textContent ?? '', ...n.children.map(text)].join(' ');
  for (const root of ['meal-results', 'menu-list', 'restaurants', 'restaurant-heading']) {
    assert.match(text(node(root)), /Photo coming soon/);
    assert.equal(node(root).querySelectorAll('img').some((image) => image.src?.includes('/assets/eats-')), false);
  }
  assert.match(html, /Illustrative Nigerian food artwork/);
  assert.match(html, /id="food-item-camera"[^>]*capture="environment"/);
  assert.match(html, /id="food-item-photo"[^>]*accept="image\/jpeg,image\/png,image\/webp"/);
});

test('a dish photo is prepared privately and only submitted with the saved structured menu item', async (t) => {
  const node = dom(t), f = fixture(), prepared = { photo: { mimeType: 'image/jpeg', base64: 'aGVsbG8=' }, preview: 'data:image/jpeg;base64,aGVsbG8=' };
  const originalRead = f.api.request;
  f.api.request = (path) => path === '/eats/store' ? { store, menu } : path.startsWith('/eats/orders?') ? { orders: [], nextBefore: null } : originalRead(path);
  f.api.command = async (path, data, key) => { f.writes.push({ path, data, key }); return { store: { ...store, version: 4 }, menu }; };
  const view = createEatsView(f.c, { preparePhoto: async () => prepared }); f.c.subscribe(() => view.render(f.c.snapshot()));
  await f.c.navigate('store'); node('store-menu').querySelectorAll('button')[0].handlers.click();
  node('item-camera').files = [{ type: 'image/jpeg', size: 100 }]; await node('item-camera').handlers.change();
  assert.equal(f.writes.length, 0); assert.match(node('photo-status').textContent, /after approval/);
  await node('menu-form').handlers.submit({ preventDefault() {} });
  assert.equal(f.writes[0].path, `/eats/stores/${store.id}/menu`); assert.deepEqual(f.writes[0].data.item.photo, prepared.photo); assert.equal(f.writes[0].data.item.name, 'Jollof rice');
});

test('a delayed selected photo cannot populate another account or menu item', async (t) => {
  const node = dom(t), f = fixture(), waiting = deferred();
  const view = createEatsView(f.c, { preparePhoto: () => waiting.promise }); f.c.subscribe(() => view.render(f.c.snapshot()));
  await f.c.navigate('store'); node('item-photo').files = [{ type: 'image/jpeg', size: 100 }];
  const reading = node('item-photo').handlers.change(); f.c.context({ ...user, id: uuid(901) });
  waiting.resolve({ photo: { mimeType: 'image/jpeg', base64: 'aGVsbG8=' }, preview: 'data:image/jpeg;base64,aGVsbG8=' }); await reading;
  assert.equal(node('photo-preview').querySelectorAll('img').length, 0); assert.equal(f.writes.length, 0);
});

test('store image drafts detect changed versions and private menu references stay separate from sellable dishes', async (t) => {
  const node = dom(t), f = fixture(), prepared = { photo: { mimeType: 'image/jpeg', base64: 'aGVsbG8=' }, preview: 'data:image/jpeg;base64,aGVsbG8=' };
  let ownStore = { ...store, assets: { logo: null, cover: null, menuReference: null } };
  const originalRead = f.api.request;
  f.api.request = (path) => path === '/eats/store' ? { store: ownStore, menu } : path.startsWith('/eats/orders?') ? { orders: [], nextBefore: null } : originalRead(path);
  f.api.command = async (path, data, key) => { f.writes.push({ path, data, key }); return { store: ownStore, menu }; };
  const view = createEatsView(f.c, { preparePhoto: async () => prepared }); f.c.subscribe(() => view.render(f.c.snapshot())); await f.c.navigate('store');
  const [logo, , reference] = node('store-photos').children;
  const input = logo.querySelectorAll('input')[0]; input.files = [{ type: 'image/png', size: 100 }]; await input.handlers.change();
  ownStore = { ...ownStore, version: 4 }; await f.c.refresh({ quiet: true });
  await logo.handlers.submit({ preventDefault() {} }); assert.equal(f.writes.length, 0);
  assert.equal(logo.querySelectorAll('p').find((p) => p.className === 'food-error').hidden, false);
  const referenceInput = reference.querySelectorAll('input')[0]; referenceInput.files = [{ type: 'image/jpeg', size: 100 }]; await referenceInput.handlers.change();
  await reference.handlers.submit({ preventDefault() {} });
  assert.equal(f.writes[0].path, `/eats/stores/${store.id}/assets`); assert.equal(f.writes[0].data.purpose, 'menu_reference'); assert.equal(f.writes[0].data.expectedVersion, 4); assert.equal(f.writes[0].data.item, undefined);
});

test('staff photo review requires a reason, sends the displayed version and reloads stale decisions', async (t) => {
  const node = dom(t), f = fixture();
  let asset = { id: uuid(801), storeId: store.id, storeName: store.name, itemId: menu[0].id, itemName: menu[0].name, purpose: 'dish', status: 'pending', version: 1, reviewNote: '', createdAt: 1000 };
  let stale = true;
  f.api.request = async (path) => {
    if (path === '/eats/admin/stores') return { stores: [store] };
    if (path.startsWith('/eats/admin/photos?')) return { photos: path.includes(`status=${asset.status}`) ? [asset] : [], nextBefore: null };
    if (path.startsWith('/eats/photos/')) return { photo: { id: asset.id, mimeType: 'image/jpeg', base64: 'aGVsbG8=' } };
    throw new Error('Unexpected path: ' + path);
  };
  f.api.command = async (path, data, key) => {
    f.writes.push({ path, data, key });
    if (stale) { stale = false; asset = { ...asset, version: 2 }; throw Object.assign(new Error('Photo changed. Review its current version.'), { status: 409, code: 'STALE_VERSION' }); }
    asset = { ...asset, status: data.decision, reviewNote: data.reason, version: 3 }; return { photoReview: asset };
  };
  const view = createEatsView(f.c); f.c.subscribe(() => view.render(f.c.snapshot())); f.c.context({ ...user, role: 'admin' }); await f.c.navigate('review');
  assert.equal(node('photo-review-section').hidden, false);
  let form = node('photo-review-list').querySelectorAll('form')[0], reason = form.querySelectorAll('textarea')[0];
  reason.value = 'short'; await form.handlers.submit({ preventDefault() {}, submitter: { value: 'rejected' } }); assert.equal(f.writes.length, 0);
  reason.value = 'The image shows a private home address.'; await form.handlers.submit({ preventDefault() {}, submitter: { value: 'rejected' } });
  assert.equal(f.writes[0].path, `/eats/photos/${asset.id}/review`); assert.equal(f.writes[0].data.expectedVersion, 1);
  assert.match(node('error').textContent, /Photo changed/); assert.equal(f.c.snapshot().reviewPhotos[0].version, 2);
  form = node('photo-review-list').querySelectorAll('form')[0]; reason = form.querySelectorAll('textarea')[0];
  reason.value = 'The image shows a private home address.'; await form.handlers.submit({ preventDefault() {}, submitter: { value: 'rejected' } });
  assert.equal(f.writes[1].data.expectedVersion, 2); assert.deepEqual(f.c.snapshot().reviewPhotos, []);
  node('photo-review-filter').value = 'rejected'; node('photo-review-filter').handlers.change(); await flush();
  assert.equal(f.c.snapshot().reviewPhotos[0].status, 'rejected'); assert.equal(f.c.snapshot().review, null);
});
