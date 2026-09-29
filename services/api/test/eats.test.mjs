import { includeExpectedStaffOwners, removeSafetyMonitoringFixtureTables } from './migration-fixtures.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import sharp from 'sharp';
import { harness, participants, PASSWORD, requestRide } from './helpers.mjs';
import { removeEatsFixtureTables, removeGuestFixtureTables } from './migration-fixtures.mjs';
import { SCHEMA_VERSION } from '../src/infrastructure/database.mjs';
import { readEatsResponse } from '../../../packages/shared/src/eats-contracts.mjs';
import { createEatsConfig } from '../src/modules/eats/config.mjs';

const details = { name: 'Test Abuja Kitchen', cuisine: 'Nigerian', description: 'Fictional kitchen for ordering tests.', address: '10 Fictional Road, Wuse II', areaId: 'wuse-ii', deliveryAreaIds: ['wuse-ii', 'maitama'], prepMinutes: 25, minimumKobo: 100_000, deliveryFeeKobo: 150_000 };
const item = { name: 'Jollof rice and chicken', description: 'Rice, tomato, peppers and grilled chicken. Test menu.', category: 'Meals', priceKobo: 250_000, available: true };

test('Eats emergency pause configuration accepts explicit booleans only', () => {
  assert.equal(createEatsConfig({}).paused, false);
  assert.equal(createEatsConfig({ TAXI_AI_EATS_PAUSED: 'true' }).paused, true);
  assert.throws(() => createEatsConfig({ TAXI_AI_EATS_PAUSED: 'yes' }), /must be true or false/);
});

test('schema 18 upgrades add empty Eats storage while preserving existing accounts, documents and journeys', async (t) => {
  const h = await harness(t, { persistent: true }), { customer, driver } = await participants(h);
  const ride = await requestRide(customer);
  const tables = h.db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE 'eats_%' ORDER BY name").all().map((r) => r.name).filter((name) => !['dispatch_commands','dispatch_offers','dispatch_journeys','account_revisions','worker_leases'].includes(name));
  const records = new Map(tables.map((name) => [name, h.db.prepare(`SELECT * FROM ${name}`).all()]));
  includeExpectedStaffOwners(h.db, records);
  removeEatsFixtureTables(h.db); h.db.exec('PRAGMA user_version=18'); await h.restart();
  assert.equal(h.db.prepare('PRAGMA user_version').get().user_version, SCHEMA_VERSION);
  for (const name of tables) assert.deepEqual(h.db.prepare(`SELECT * FROM ${name}`).all(), records.get(name), name);
  assert.deepEqual(h.db.prepare('PRAGMA foreign_key_check').all(), []);
  assert.equal(h.db.prepare('SELECT count(*) AS n FROM eats_stores').get().n, 0);
  assert.equal((await customer.send(`/api/rides/${ride.id}`)).body.ride.id, ride.id);
  assert.equal((await driver.send('/api/session')).body.user.driver.eligibility.eligible, true);
});
async function ok(client, path, data) { const result = data === undefined ? await client.send(path) : await client.post(path, data); assert.equal(result.status, 200, JSON.stringify(result.body)); return result.body; }
async function fixture(t, options = {}) {
  const h = await harness(t, options), people = await participants(h, 2), seller = h.client(), stranger = h.client();
  await seller.register('restaurant'); await stranger.register('stranger');
  let { store } = await ok(seller, '/api/eats/stores', { details });
  ({ store } = await ok(seller, `/api/eats/stores/${store.id}/menu`, { expectedVersion: store.version, itemId: null, item }));
  const { menu } = await ok(seller, '/api/eats/store');
  const f = { h, ...people, seller, stranger, store, menu };
  f.open = async () => {
    ({ store: f.store } = await ok(f.admin, `/api/eats/stores/${f.store.id}/review`, { expectedVersion: f.store.version, decision: 'approved', reason: 'Fictional restaurant manually reviewed for tests.', reference: 'TEST-REVIEW' }));
    ({ store: f.store } = await ok(seller, `/api/eats/stores/${f.store.id}/open`, { expectedVersion: f.store.version, isOpen: true }));
  };
  f.basket = () => ({ storeId: f.store.id, expectedVersion: f.store.version, items: [{ itemId: menu[0].id, quantity: 2 }], address: { line: '25 Fictional Close, test blue gate', areaId: 'maitama' }, instructions: 'Test handover at the gate.' });
  f.quote = async () => (await ok(f.customer, '/api/eats/quotes', f.basket())).quote;
  f.place = async () => (await ok(f.customer, '/api/eats/orders', { quoteId: (await f.quote()).id })).order;
  f.ready = async () => {
    let order = await f.place();
    for (const action of ['accept', 'prepare', 'ready']) ({ order } = await ok(seller, `/api/eats/orders/${order.id}/${action}`, { expectedVersion: order.version, ...(action === 'ready' && order.needsCollectionPoint ? { collectionPoint: details.address } : {}) }));
    return order;
  };
  return f;
}

test('restaurant membership, manual approval and open state control menu publishing and ordering', async (t) => {
  const f = await fixture(t);
  assert.deepEqual((await ok(f.customer, '/api/eats/restaurants')).restaurants, []);
  assert.equal((await f.customer.send(`/api/eats/restaurants/${f.store.id}`)).status, 404);
  assert.equal((await f.seller.post(`/api/eats/stores/${f.store.id}/open`, { expectedVersion: f.store.version, isOpen: true })).status, 409);
  assert.equal((await f.seller.post(`/api/eats/stores/${f.store.id}/review`, { expectedVersion: f.store.version, decision: 'approved', reason: 'I approve this store myself', reference: 'TEST-SELF' })).status, 403);
  assert.equal((await f.stranger.post(`/api/eats/stores/${f.store.id}/menu`, { expectedVersion: f.store.version, itemId: null, item })).status, 403);
  await f.open();
  assert.equal((await ok(f.customer, '/api/eats/restaurants?cuisine=Nigerian')).restaurants.length, 1);
  assert.equal((await ok(f.customer, '/api/eats/restaurants?q=pizza')).restaurants.length, 0);
  assert.equal((await f.seller.post('/api/eats/quotes', f.basket())).status, 403);
  assert.equal(f.h.db.prepare('SELECT COUNT(*) AS n FROM eats_reviews').get().n, 1);
  await ok(f.seller, `/api/eats/stores/${f.store.id}/save`, { expectedVersion: f.store.version, details: { ...details, address: '20 Fictional Road, Wuse II' } });
  assert.equal((await ok(f.seller, '/api/eats/store')).store.status, 'pending');
  assert.deepEqual((await ok(f.customer, '/api/eats/restaurants')).restaurants, []);
});

test('expanding kitchen delivery coverage closes ordering until staff reviews the new area', async (t) => {
  const f = await fixture(t); await f.open();
  const quote = await f.quote();
  ({ store: f.store } = await ok(f.seller, `/api/eats/stores/${f.store.id}/save`, { expectedVersion: f.store.version,
    details: { ...details, deliveryAreaIds: [...details.deliveryAreaIds, 'garki'] } }));
  assert.equal(f.store.status, 'pending'); assert.equal(f.store.isOpen, false);
  assert.equal((await f.customer.post('/api/eats/orders', { quoteId: quote.id })).body.error.code, 'STORE_UNAVAILABLE');
  assert.equal((await ok(f.customer, '/api/eats/restaurants?deliveryAreaId=garki')).restaurants.length, 0);
  ({ store: f.store } = await ok(f.admin, `/api/eats/stores/${f.store.id}/review`, { expectedVersion: f.store.version,
    decision: 'approved', reason: 'Fictional extended coverage checked for tests.', reference: 'TEST-AREA-REVIEW' }));
  ({ store: f.store } = await ok(f.seller, `/api/eats/stores/${f.store.id}/open`, { expectedVersion: f.store.version, isOpen: true }));
  assert.equal((await ok(f.customer, '/api/eats/restaurants?deliveryAreaId=garki')).restaurants.length, 1);
});

test('Eats emergency pause blocks new quotes and old placements while existing orders and rides continue', async (t) => {
  const eatsConfig = { paused: false }, f = await fixture(t, { persistent: true, eatsConfig });
  await f.open();
  const pending = await f.quote(), existing = await f.place();
  eatsConfig.paused = true; await f.h.restart();
  assert.equal((await f.customer.post('/api/eats/quotes', f.basket())).body.error.code, 'EATS_PAUSED');
  assert.equal((await f.customer.post('/api/eats/orders', { quoteId: pending.id })).body.error.code, 'EATS_PAUSED');
  assert.equal((await f.customer.post('/api/eats/checkouts', { groups: [{ storeId: f.store.id, expectedVersion: f.store.version,
    items: [{ itemId: f.menu[0].id, quantity: 1 }] }], address: f.basket().address, instructions: '' })).body.error.code, 'EATS_PAUSED');
  assert.equal(f.h.db.prepare('SELECT count(*) AS n FROM eats_orders').get().n, 1);
  assert.equal((await ok(f.seller, `/api/eats/orders/${existing.id}/accept`, { expectedVersion: existing.version })).order.status, 'accepted');
  assert.equal((await requestRide(f.customer)).status, 'requested');
});

test('private kitchen search and customer orders show only town; assigned courier gets pickup address', async (t) => {
  const f = await fixture(t);
  ({ store: f.store } = await ok(f.seller, `/api/eats/stores/${f.store.id}/menu`, { expectedVersion: f.store.version, itemId: f.menu[0].id, item: { ...item, portionsRemaining: 20 } }));
  ({ store: f.store } = await ok(f.seller, `/api/eats/stores/${f.store.id}/save`, { expectedVersion: f.store.version,
    details: { ...details, sellerType: 'private_kitchen' } }));
  await f.open();
  const catalog = await ok(f.customer, '/api/eats/restaurants?q=jollof');
  assert.equal(catalog.restaurants.length, 1);
  assert.equal(catalog.dishes.length, 1);
  assert.equal(catalog.restaurants[0].town, 'Wuse II');
  assert.equal(catalog.restaurants[0].address, '');
  assert.equal(catalog.dishes[0].seller.address, '');
  assert.equal((await ok(f.customer, `/api/eats/restaurants/${f.store.id}`)).store.address, '');
  readEatsResponse(catalog);
  const ownerView = readEatsResponse(await ok(f.seller, '/api/eats/store'));
  assert.equal(ownerView.store.address, details.address);
  readEatsResponse(await ok(f.admin, '/api/eats/admin/stores'));
  const quote = await f.quote();
  assert.equal(quote.restaurant.address, '');
  assert.equal(quote.restaurant.town, 'Wuse II');
  const ready = await f.ready();
  assert.equal(ready.restaurant.address, details.address);
  assert.equal((await ok(f.customer, `/api/eats/orders/${ready.id}`)).order.restaurant.address, '');
  const available = (await ok(f.driver, '/api/eats/work')).available.find((job) => job.id === ready.id);
  assert.ok(available);
  assert.equal(available.restaurant.address, '');
  const claimed = (await ok(f.driver, `/api/eats/orders/${ready.id}/claim`, { expectedVersion: ready.version })).order;
  assert.equal(claimed.restaurant.address, details.address);
});

test('seller dish photos are re-encoded, owner-scoped, published after review, replaceable and removable on web and native', async (t) => {
  const f = await fixture(t, { persistent: true });
  removeSafetyMonitoringFixtureTables(f.h.db);
  f.h.db.exec('DROP TABLE eats_menu_photos; PRAGMA user_version=24;');
  await f.h.restart();
  assert.equal((await ok(f.seller, '/api/eats/store')).menu[0].id, f.menu[0].id);
  const original = await sharp({ create: { width: 420, height: 320, channels: 3, background: '#b84b29' } }).png().toBuffer();
  const image = { mimeType: 'image/png', base64: original.toString('base64') };
  const path = `/api/eats/stores/${f.store.id}/photo`, itemId = f.menu[0].id;
  const data = { expectedVersion: f.store.version, itemId, image }, key = randomUUID();
  assert.equal((await f.stranger.post(path, data)).status, 403);
  assert.equal((await f.seller.post(path, { ...data, image: { ...image, mimeType: 'image/jpeg' } })).status, 400);
  let saved = await f.seller.post(path, data, key); assert.equal(saved.status, 200, JSON.stringify(saved.body));
  assert.equal(saved.body.menu[0].photoVersion, saved.body.store.version);
  assert.equal(JSON.stringify(saved.body).includes(image.base64), false);
  readEatsResponse(saved.body); f.store = saved.body.store;
  const replay = await f.seller.post(path, data, key); assert.equal(replay.status, 200); assert.equal(replay.body.replayed, true);
  assert.equal((await f.seller.post(path, data)).body.error.code, 'STALE_VERSION');
  const imageUrl = `/api/eats/images/${itemId}?v=${f.store.version}`;
  const ownerImage = await fetch(f.h.base + imageUrl, { headers: { Cookie: f.seller.cookie } });
  assert.equal(ownerImage.status, 200); assert.equal(ownerImage.headers.get('content-type'), 'image/jpeg');
  const bytes = Buffer.from(await ownerImage.arrayBuffer()), metadata = await sharp(bytes).metadata();
  assert.equal(metadata.format, 'jpeg'); assert.equal(metadata.exif, undefined);
  assert.equal((await fetch(f.h.base + imageUrl, { headers: { Cookie: f.customer.cookie } })).status, 404);
  await f.open();
  assert.equal((await fetch(f.h.base + imageUrl, { headers: { Cookie: f.customer.cookie } })).status, 200);
  assert.equal((await ok(f.customer, '/api/eats/restaurants?q=jollof')).dishes[0].photoVersion, saved.body.menu[0].photoVersion);
  await f.h.restart();
  assert.equal((await fetch(f.h.base + imageUrl, { headers: { Cookie: f.customer.cookie } })).status, 200);
  const login = await f.seller.send('/api/mobile/v1/auth/login', { method: 'POST', data: { email: f.seller.user.email, password: PASSWORD, deviceName: 'Seller photo phone' }, headers: { Origin: null, Cookie: null, 'X-CSRF-Token': null } });
  assert.equal(login.status, 200); const token = login.body.credentials.accessToken;
  const native = (payload) => f.stranger.send(`/api/mobile/v1/eats/stores/${f.store.id}/photo`, { method: 'POST', data: payload,
    headers: { Origin: null, Cookie: null, 'X-CSRF-Token': null, Authorization: `Bearer ${token}`, 'Idempotency-Key': randomUUID() } });
  saved = await native({ expectedVersion: f.store.version, itemId, image });
  assert.equal(saved.status, 200, JSON.stringify(saved.body)); f.store = saved.body.store;
  const nativeImage = await fetch(f.h.base + `/api/mobile/v1/eats/images/${itemId}`, { headers: { Authorization: `Bearer ${token}` } });
  assert.equal(nativeImage.status, 200); assert.deepEqual(Buffer.from(await nativeImage.arrayBuffer()), bytes);
  saved = await native({ expectedVersion: f.store.version, itemId, image: null });
  assert.equal(saved.status, 200); assert.equal(saved.body.menu[0].photoVersion, null);
  assert.equal((await fetch(f.h.base + imageUrl, { headers: { Cookie: f.customer.cookie } })).status, 404);
});

test('kitchen pagination keeps an older unfinished order ahead of completed history without duplicates', async (t) => {
  const f = await fixture(t); await f.open(); const active = await f.place();
  const insert = f.h.db.prepare(`INSERT INTO eats_orders (id,store_id,customer_id,status,snapshot_json,events_json,created_at,updated_at)
    SELECT ?,store_id,customer_id,'delivered',snapshot_json,events_json,?,? FROM eats_orders WHERE id=?`);
  for (let i = 1; i <= 60; i++) insert.run(randomUUID(), f.h.now + i, f.h.now + i, active.id);
  const first = await ok(f.seller, '/api/eats/orders?scope=store');
  assert.equal(first.orders.length, 50); assert.equal(first.orders[0].id, active.id); assert.ok(first.nextBefore);
  const next = await ok(f.seller, '/api/eats/orders?scope=store&before=' + first.nextBefore);
  assert.equal(next.orders.length, 11); assert.equal(next.nextBefore, null);
  assert.equal(new Set([...first.orders, ...next.orders].map((o) => o.id)).size, 61);
  assert.equal((await f.stranger.send('/api/eats/orders?before=' + active.id)).status, 400);
});

test('checkout computes prices on the server and rejects changed menus, expired quotes and tampered items', async (t) => {
  const f = await fixture(t); await f.open(); const quote = await f.quote();
  assert.deepEqual(quote.totals, { subtotalKobo: 500_000, deliveryFeeKobo: 150_000, serviceFeeKobo: 25_000, totalKobo: 675_000, currency: 'NGN' });
  assert.equal((await f.customer.post('/api/eats/quotes', { ...f.basket(), totalKobo: 1 })).status, 400);
  for (const items of [[{ itemId: f.menu[0].id, quantity: -1 }], [{ itemId: randomUUID(), quantity: 1 }], [{ itemId: f.menu[0].id, quantity: 1, priceKobo: 1 }]]) {
    const response = await f.customer.post('/api/eats/quotes', { ...f.basket(), items }); assert.ok([400,409].includes(response.status));
  }
  assert.equal((await f.stranger.post('/api/eats/orders', { quoteId: quote.id })).status, 404);
  ({ store: f.store } = await ok(f.seller, `/api/eats/stores/${f.store.id}/menu`, { expectedVersion: f.store.version, itemId: f.menu[0].id, item: { ...item, priceKobo: 300_000 } }));
  assert.equal((await f.customer.post('/api/eats/orders', { quoteId: quote.id })).body.error.code, 'MENU_CHANGED');
  const expired = await f.quote(); f.h.advance(600_001);
  assert.equal((await f.customer.post('/api/eats/orders', { quoteId: expired.id })).body.error.code, 'QUOTE_EXPIRED');
  const closed = await f.quote(); await ok(f.seller, `/api/eats/stores/${f.store.id}/open`, { expectedVersion: f.store.version, isOpen: false });
  assert.equal((await f.customer.post('/api/eats/orders', { quoteId: closed.id })).body.error.code, 'STORE_UNAVAILABLE');
});

test('a complete customer, restaurant and courier order preserves totals and verifies both handovers across restart', async (t) => {
  const f = await fixture(t, { persistent: true }); await f.open();
  const quote = await f.quote(), key = randomUUID();
  const [first, retry] = await Promise.all([f.customer.post('/api/eats/orders', { quoteId: quote.id }, key), f.customer.post('/api/eats/orders', { quoteId: quote.id }, key)]);
  assert.equal(first.status, 200); assert.equal(retry.body.order.id, first.body.order.id);
  let order = first.body.order; const id = order.id;
  assert.equal(order.deliveryPin, undefined); assert.equal(order.pickupPin, undefined);
  assert.equal((await f.customer.post('/api/eats/orders', { quoteId: quote.id })).body.error.code, 'QUOTE_USED');
  for (const action of ['accept', 'prepare', 'ready']) ({ order } = await ok(f.seller, `/api/eats/orders/${id}/${action}`, { expectedVersion: order.version }));
  const pickupPin = order.pickupPin; assert.match(pickupPin, /^\d{6}$/);
  const available = (await ok(f.driver, '/api/eats/work')).available[0];
  assert.equal(available.id, id); assert.equal(available.address, undefined); assert.equal(available.customerName, undefined);
  ({ order } = await ok(f.driver, `/api/eats/orders/${id}/claim`, { expectedVersion: order.version }));
  assert.equal(order.pickupPin, undefined); assert.equal(order.deliveryPin, undefined);
  assert.equal(order.address.line, quote.address.line); assert.equal(order.courier.name, f.driver.user.name);
  const badKey = randomUUID(), badData = { expectedVersion: order.version, pin: pickupPin === '000000' ? '111111' : '000000' };
  assert.equal((await f.driver.post(`/api/eats/orders/${id}/pickup`, badData, badKey)).body.error.code, 'INVALID_PIN');
  assert.equal((await f.driver.post(`/api/eats/orders/${id}/pickup`, badData, badKey)).body.error.code, 'INVALID_PIN');
  ({ order } = await ok(f.driver, `/api/eats/orders/${id}`));
  assert.equal(f.h.db.prepare('SELECT pin_failures AS failures FROM eats_orders WHERE id=?').get(id).failures, 1);
  ({ order } = await ok(f.driver, `/api/eats/orders/${id}/pickup`, { expectedVersion: order.version, pin: pickupPin }));
  const customer = (await ok(f.customer, `/api/eats/orders/${id}`)).order; assert.match(customer.deliveryPin, /^\d{6}$/);
  assert.equal((await ok(f.seller, `/api/eats/orders/${id}`)).order.deliveryPin, undefined);
  await f.h.restart();
  ({ order } = await ok(f.driver, `/api/eats/orders/${id}/arrive`, { expectedVersion: order.version }));
  ({ order } = await ok(f.driver, `/api/eats/orders/${id}/deliver`, { expectedVersion: order.version, pin: customer.deliveryPin }));
  assert.equal(order.status, 'delivered'); assert.deepEqual(order.totals, quote.totals); assert.equal(order.payment.status, 'not_charged');
  assert.equal(order.deliveryPin, undefined); assert.equal((await ok(f.driver, '/api/eats/work')).current.length, 0);
  assert.equal((await ok(f.customer, '/api/eats/orders')).orders[0].id, id);
  assert.equal((await f.stranger.send(`/api/eats/orders/${id}`)).status, 404);
  const row = f.h.db.prepare('SELECT pickup_pin, delivery_pin FROM eats_orders WHERE id=?').get(id);
  assert.equal(row.pickup_pin, null); assert.equal(row.delivery_pin, null);
});

test('staff can recover an uncollected delivery without restoring food or retaining courier access', async (t) => {
  const f = await fixture(t, { persistent: true }); await f.open();
  let order = await f.ready(); const originalPin = order.pickupPin;
  ({ order } = await ok(f.driver, `/api/eats/orders/${order.id}/claim`, { expectedVersion: order.version }));
  const path = `/api/eats/orders/${order.id}/unassign`;
  assert.equal((await f.customer.post(path, { expectedVersion: order.version, reason: 'Courier unavailable' })).status, 409);
  assert.equal((await f.admin.post(path, { expectedVersion: order.version })).status, 400);
  const key = randomUUID(), data = { expectedVersion: order.version, reason: 'Courier did not arrive at the kitchen.' };
  const first = await f.admin.post(path, data, key);
  assert.equal(first.status, 200, JSON.stringify(first.body)); order = first.body.order;
  assert.equal(order.status, 'ready'); assert.equal(order.courier, null);
  assert.equal(order.events.at(-1).reason, data.reason);
  assert.equal((await f.driver.send(`/api/eats/orders/${order.id}`)).status, 404);
  assert.equal((await ok(f.driver, '/api/driver/application')).application.busy, false);
  assert.equal((await ok(f.seller, `/api/eats/orders/${order.id}`)).order.pickupPin === originalPin, false);
  assert.equal((await ok(f.customer, `/api/eats/orders/${order.id}`)).order.courier, null);
  assert.ok((await ok(f.drivers[1], '/api/eats/work')).available.some((job) => job.id === order.id));
  await f.h.restart();
  assert.equal((await f.admin.post(path, data, key)).body.replayed, true);
  assert.equal((await f.admin.post(path, data)).body.error.code, 'STALE_VERSION');
  ({ order } = await ok(f.drivers[1], `/api/eats/orders/${order.id}/claim`, { expectedVersion: order.version }));
  assert.equal(order.courier.id, f.drivers[1].user.id);
  assert.equal((await f.driver.post(`/api/eats/orders/${order.id}/pickup`, { expectedVersion: order.version, pin: originalPin })).status, 404);
});

test('staff can stop a failed delivery after collection with an audit reason and no stock restoration', async (t) => {
  const f = await homeFixture(t, { persistent: true });
  let order = await f.ready(); const id = order.id;
  ({ order } = await ok(f.driver, `/api/eats/orders/${id}/claim`, { expectedVersion: order.version }));
  ({ order } = await ok(f.driver, `/api/eats/orders/${id}/pickup`, { expectedVersion: order.version, pin: (await ok(f.seller, `/api/eats/orders/${id}`)).order.pickupPin }));
  assert.equal((await f.customer.post(`/api/eats/orders/${id}/cancel`, { expectedVersion: order.version, reason: 'Lost delivery' })).status, 409);
  const data = { expectedVersion: order.version, reason: 'Courier reported that the prepared food was lost.' }, key = randomUUID();
  const first = await f.admin.post(`/api/eats/orders/${id}/cancel`, data, key);
  assert.equal(first.status, 200, JSON.stringify(first.body)); order = first.body.order;
  assert.equal(order.status, 'cancelled'); assert.equal(order.events.at(-1).reason, data.reason);
  assert.equal(order.pickupPin, undefined); assert.equal(order.deliveryPin, undefined);
  assert.equal((await ok(f.driver, '/api/eats/work')).current.length, 0);
  assert.equal((await ok(f.driver, '/api/driver/application')).application.busy, false);
  assert.equal((await ok(f.seller, '/api/eats/store')).menu[0].portionsRemaining, 2);
  await f.h.restart();
  assert.equal((await f.admin.post(`/api/eats/orders/${id}/cancel`, data, key)).body.replayed, true);
  assert.equal((await f.driver.post(`/api/eats/orders/${id}/deliver`, { expectedVersion: order.version, pin: '000000' })).body.error.code, 'ORDER_CLOSED');
  assert.equal((await ok(f.customer, `/api/eats/orders/${id}`)).order.status, 'cancelled');
});

test('food reservation is atomic, excludes own orders, and blocks vehicle changes and overlapping ride work', async (t) => {
  const f = await fixture(t); await f.open(); const ready = await f.ready();
  const claims = await Promise.all(f.drivers.map((driver) => driver.post(`/api/eats/orders/${ready.id}/claim`, { expectedVersion: ready.version })));
  assert.equal(claims.filter((r) => r.status === 200).length, 1); assert.equal(claims.filter((r) => r.status === 409).length, 1);
  const courier = f.drivers[claims.findIndex((r) => r.status === 200)];
  const app = (await ok(courier, '/api/driver/application')).application; assert.equal(app.busy, true);
  assert.equal((await courier.post('/api/driver/application/reopen', { expectedVersion: app.version })).body.error.code, 'DRIVER_BUSY');
  assert.equal((await courier.post('/api/account/driver-profile/delete', { expectedVersion: app.version, confirmation: 'DELETE' })).body.error.code, 'DRIVER_BUSY');
  assert.equal((await courier.post('/api/rides', { pickupId: 'wuse-ii', destinationId: 'maitama' })).body.error.code, 'DRIVER_BUSY');
  const ride = await requestRide(f.stranger);
  assert.equal((await courier.post(`/api/rides/${ride.id}/claim`, { expectedVersion: ride.version })).body.error.code, 'DRIVER_BUSY');
  assert.equal((await courier.availability('/api/availability/online', { mode: 'sample', areaId: 'wuse-ii' })).status, 409);
});

test('only the right participant can change each order stage; cancellation cannot silently discard prepared food', async (t) => {
  const f = await fixture(t); await f.open(); let order = await f.place();
  assert.equal((await f.stranger.post(`/api/eats/orders/${order.id}/cancel`, { expectedVersion: order.version, reason: 'Not my order' })).status, 404);
  assert.equal((await f.customer.post(`/api/eats/orders/${order.id}/accept`, { expectedVersion: order.version })).status, 409);
  ({ order } = await ok(f.seller, `/api/eats/orders/${order.id}/accept`, { expectedVersion: order.version }));
  assert.equal((await f.customer.post(`/api/eats/orders/${order.id}/cancel`, { expectedVersion: order.version, reason: 'Changed my mind' })).status, 409);
  assert.equal((await f.seller.post(`/api/eats/orders/${order.id}/ready`, { expectedVersion: order.version })).status, 409);
  const second = await f.place();
  const cancelled = (await ok(f.customer, `/api/eats/orders/${second.id}/cancel`, { expectedVersion: second.version, reason: 'Test cancellation before acceptance' })).order;
  assert.equal(cancelled.status, 'cancelled');
  const third = await f.place();
  assert.equal((await ok(f.seller, `/api/eats/orders/${third.id}/reject`, { expectedVersion: third.version, reason: 'Test item out of stock' })).order.status, 'rejected');
  f.h.db.prepare('DELETE FROM eats_memberships WHERE user_id=?').run(f.seller.user.id);
  assert.equal((await f.seller.send(`/api/eats/orders/${order.id}`)).status, 404);
});

test('five wrong codes persist a lockout and command persistence failure rolls back a courier reservation', async (t) => {
  const f = await fixture(t); await f.open(); let order = await f.ready(); const pin = order.pickupPin;
  f.h.db.exec("CREATE TRIGGER fail_food_command BEFORE INSERT ON eats_commands BEGIN SELECT RAISE(ABORT, 'fixture'); END");
  assert.equal((await f.driver.post(`/api/eats/orders/${order.id}/claim`, { expectedVersion: order.version })).status, 500);
  assert.equal((await ok(f.customer, `/api/eats/orders/${order.id}`)).order.status, 'ready');
  assert.equal((await ok(f.driver, '/api/eats/work')).online, true);
  f.h.db.exec('DROP TRIGGER fail_food_command');
  ({ order } = await ok(f.driver, `/api/eats/orders/${order.id}/claim`, { expectedVersion: order.version }));
  for (let i = 0; i < 5; i++) {
    const response = await f.driver.post(`/api/eats/orders/${order.id}/pickup`, { expectedVersion: order.version, pin: pin === '000000' ? '111111' : '000000' });
    assert.equal(response.body.error.code, 'INVALID_PIN'); ({ order } = await ok(f.driver, `/api/eats/orders/${order.id}`));
  }
  assert.equal((await f.driver.post(`/api/eats/orders/${order.id}/pickup`, { expectedVersion: order.version, pin })).body.error.code, 'DELIVERY_PIN_LOCKED');
  f.h.advance(300_001);
  assert.equal((await ok(f.driver, `/api/eats/orders/${order.id}/pickup`, { expectedVersion: order.version, pin })).order.status, 'picked_up');
});

test('native Eats uses device credentials and the same checkout, ownership and saved order contracts', async (t) => {
  const f = await fixture(t); await f.open();
  const login = await f.customer.send('/api/mobile/v1/auth/login', { method: 'POST', data: { email: f.customer.user.email, password: PASSWORD, deviceName: 'Eats test phone' }, headers: { Origin: null, Cookie: null, 'X-CSRF-Token': null } });
  assert.equal(login.status, 200, JSON.stringify(login.body)); const token = login.body.credentials.accessToken;
  const native = (path, data) => f.stranger.send('/api/mobile/v1/eats' + path, { ...(data ? { method: 'POST', data } : {}), headers: { Origin: null, Cookie: null, 'X-CSRF-Token': null, Authorization: `Bearer ${token}`, 'Idempotency-Key': randomUUID() } });
  assert.equal((await native('/restaurants')).body.restaurants.length, 1);
  const quote = (await native('/quotes', f.basket())).body.quote;
  const created = await native('/orders', { quoteId: quote.id }); assert.equal(created.status, 200);
  assert.equal((await ok(f.customer, `/api/eats/orders/${created.body.order.id}`)).order.id, created.body.order.id);
  assert.equal((await native('/admin/stores')).status, 403);
  assert.equal((await f.customer.send('/api/mobile/v1/eats/orders')).status, 401);
  assert.equal((await f.stranger.send('/api/eats/orders', { headers: { Authorization: `Bearer ${token}`, Cookie: null } })).status, 401);
});

async function homeFixture(t, { stock = 4, pickup = true, persistent = false, sellerType = 'home_kitchen' } = {}) {
  const f = await fixture(t, { persistent });
  ({ store: f.store, menu: f.menu } = await ok(f.seller, `/api/eats/stores/${f.store.id}/menu`, { expectedVersion: f.store.version, itemId: f.menu[0].id, item: { ...item, portionsRemaining: stock, allergens: 'Contains milk. Prepared in a kitchen handling nuts.' } }));
  ({ store: f.store } = await ok(f.seller, `/api/eats/stores/${f.store.id}/save`, { expectedVersion: f.store.version, details: { ...details, sellerType, pickupEnabled: pickup, deliveryEnabled: true } }));
  await f.open();
  f.latest = async () => { ({ store: f.store, menu: f.menu } = await ok(f.seller, '/api/eats/store')); };
  return f;
}

for (const sellerType of ['home_kitchen', 'food_vendor']) test(`${sellerType} addresses and batch internals stay private in discovery, quotes, order history, retries and unclaimed jobs`, async (t) => {
  const f = await homeFixture(t, { sellerType }); const paths = ['/api/eats/restaurants', `/api/eats/restaurants/${f.store.id}`];
  for (const path of paths) {
    const body = await ok(f.customer, path); assert.equal(JSON.stringify(body).includes(details.address), false); assert.equal(JSON.stringify(body).includes('batchId'), false);
  }
  assert.equal((await ok(f.customer, '/api/eats/restaurants?sellerType=' + sellerType)).restaurants.length, 1);
  assert.equal((await ok(f.customer, '/api/eats/restaurants?sellerType=restaurant')).restaurants.length, 0);
  const quote = await f.quote(); assert.equal(quote.restaurant.addressHidden, true); assert.equal(quote.restaurant.address, '');
  assert.ok(quote.lines[0].allergens); assert.equal(quote.lines[0].batchId, undefined);
  const key = randomUUID(); let order = (await f.customer.post('/api/eats/orders', { quoteId: quote.id }, key)).body.order;
  for (const action of ['accept', 'prepare', 'ready']) ({ order } = await ok(f.seller, `/api/eats/orders/${order.id}/${action}`, { expectedVersion: order.version, ...(action === 'ready' && order.needsCollectionPoint ? { collectionPoint: details.address } : {}) }));
  const job = (await ok(f.driver, '/api/eats/work')).available[0]; assert.equal(job.restaurant.address, ''); assert.equal(job.restaurant.addressHidden, true);
  assert.equal(JSON.stringify(await ok(f.customer, '/api/eats/orders')).includes(details.address), false);
  assert.equal((await f.customer.post('/api/eats/orders', { quoteId: quote.id }, key)).body.order.restaurant.address, '');
  ({ order } = await ok(f.driver, `/api/eats/orders/${order.id}/claim`, { expectedVersion: order.version }));
  assert.equal(order.restaurant.address, details.address); assert.equal(order.restaurant.addressHidden, false);
  assert.equal((await ok(f.admin, `/api/eats/orders/${order.id}`)).order.restaurant.address, details.address);
  assert.equal((await f.stranger.send(`/api/eats/orders/${order.id}`)).status, 404);
});

for (const sellerType of ['home_kitchen', 'food_vendor']) test(`${sellerType} pickup has no delivery fee, reveals a private collection point when ready, verifies customer code and never dispatches`, async (t) => {
  const f = await homeFixture(t, { persistent: true, sellerType });
  const quote = (await ok(f.customer, '/api/eats/quotes', { ...f.basket(), fulfillment: 'pickup', address: { line: '', areaId: 'wuse-ii' } })).quote;
  assert.equal(quote.totals.deliveryFeeKobo, 0); assert.equal(quote.restaurant.address, ''); assert.equal(quote.address.line, undefined);
  let order = (await ok(f.customer, '/api/eats/orders', { quoteId: quote.id })).order;
  assert.equal(order.fulfillment, 'pickup'); assert.equal(order.deliveryPin, undefined); assert.equal(order.restaurant.address, '');
  ({ order } = await ok(f.seller, `/api/eats/orders/${order.id}/accept`, { expectedVersion: order.version }));
  assert.equal((await ok(f.customer, `/api/eats/orders/${order.id}`)).order.restaurant.address, '');
  for (const action of ['prepare', 'ready']) ({ order } = await ok(f.seller, `/api/eats/orders/${order.id}/${action}`, { expectedVersion: order.version, ...(action === 'ready' && order.needsCollectionPoint ? { collectionPoint: details.address } : {}) }));
  assert.equal((await ok(f.customer, `/api/eats/orders/${order.id}`)).order.restaurant.address, details.address);
  assert.deepEqual(order.actions, ['complete_pickup']); assert.equal(order.pickupPin, undefined); assert.equal(order.deliveryPin, undefined);
  const customer = (await ok(f.customer, `/api/eats/orders/${order.id}`)).order; assert.match(customer.deliveryPin, /^\d{6}$/);
  assert.deepEqual((await ok(f.driver, '/api/eats/work')).available, []);
  assert.equal((await f.driver.post(`/api/eats/orders/${order.id}/claim`, { expectedVersion: order.version })).status, 409);
  assert.equal((await f.customer.post(`/api/eats/orders/${order.id}/complete_pickup`, { expectedVersion: order.version, pin: customer.deliveryPin })).status, 409);
  for (let i = 0; i < 5; i++) {
    const bad = await f.seller.post(`/api/eats/orders/${order.id}/complete_pickup`, { expectedVersion: order.version, pin: customer.deliveryPin === '000000' ? '111111' : '000000' });
    assert.equal(bad.body.error.code, 'INVALID_PIN'); ({ order } = await ok(f.seller, `/api/eats/orders/${order.id}`));
  }
  await f.h.restart();
  assert.equal((await f.seller.post(`/api/eats/orders/${order.id}/complete_pickup`, { expectedVersion: order.version, pin: customer.deliveryPin })).body.error.code, 'DELIVERY_PIN_LOCKED');
  f.h.advance(300_001);
  ({ order } = await ok(f.seller, `/api/eats/orders/${order.id}/complete_pickup`, { expectedVersion: order.version, pin: customer.deliveryPin }));
  assert.equal(order.status, 'delivered'); assert.equal(order.courier, null);
  const done = (await ok(f.customer, `/api/eats/orders/${order.id}`)).order; assert.equal(done.deliveryPin, undefined); assert.equal(done.restaurant.address, '');
});

test('finite portions reserve atomically and restore once before preparation without inflating a replacement batch', async (t) => {
  const f = await homeFixture(t, { stock: 2 });
  const quote = await f.quote(), other = (await ok(f.stranger, '/api/eats/quotes', f.basket())).quote;
  const requests = await Promise.all([f.customer.post('/api/eats/orders', { quoteId: quote.id }), f.stranger.post('/api/eats/orders', { quoteId: other.id })]);
  assert.equal(requests.filter((r) => r.status === 200).length, 1); assert.equal(requests.filter((r) => r.status === 409).length, 1);
  const order = requests.find((r) => r.status === 200).body.order, owner = requests[0].status === 200 ? f.customer : f.stranger;
  await f.latest(); assert.equal(f.menu[0].portionsRemaining, 0);
  const key = randomUUID(), cancel = { expectedVersion: order.version, reason: 'Changed my mind before preparation' };
  assert.equal((await owner.post(`/api/eats/orders/${order.id}/cancel`, cancel, key)).status, 200);
  assert.equal((await owner.post(`/api/eats/orders/${order.id}/cancel`, cancel, key)).status, 200);
  await f.latest(); assert.equal(f.menu[0].portionsRemaining, 2);
  const next = await f.place(); await f.latest();
  ({ store: f.store } = await ok(f.seller, `/api/eats/stores/${f.store.id}/menu`, { expectedVersion: f.store.version, itemId: f.menu[0].id, item: { ...item, portionsRemaining: 10 } }));
  await ok(f.customer, `/api/eats/orders/${next.id}/cancel`, { expectedVersion: next.version, reason: 'Cancel old batch order' });
  await f.latest(); assert.equal(f.menu[0].portionsRemaining, 10);
  const prepared = await f.ready(); await f.latest(); const remaining = f.menu[0].portionsRemaining;
  await ok(f.admin, `/api/eats/orders/${prepared.id}/cancel`, { expectedVersion: prepared.version, reason: 'Staff resolves a prepared test order' });
  await f.latest(); assert.equal(f.menu[0].portionsRemaining, remaining);
});

test('batch reservation rolls back on failed command persistence and old clients preserve home kitchen settings', async (t) => {
  const f = await homeFixture(t, { stock: 2 }); const quote = await f.quote();
  f.h.db.exec("CREATE TRIGGER fail_home_order BEFORE INSERT ON eats_commands BEGIN SELECT RAISE(ABORT, 'fixture'); END");
  assert.equal((await f.customer.post('/api/eats/orders', { quoteId: quote.id })).status, 500);
  f.h.db.exec('DROP TRIGGER fail_home_order'); await f.latest(); assert.equal(f.menu[0].portionsRemaining, 2);
  await ok(f.seller, `/api/eats/stores/${f.store.id}/save`, { expectedVersion: f.store.version, details });
  await f.latest(); assert.equal(f.store.sellerType, 'home_kitchen'); assert.equal(f.store.pickupEnabled, true);
  assert.equal((await f.seller.post(`/api/eats/stores/${f.store.id}/menu`, { expectedVersion: f.store.version, itemId: null, item })).status, 400);
  assert.equal((await f.seller.post(`/api/eats/stores/${f.store.id}/menu`, { expectedVersion: f.store.version, itemId: null, item: { ...item, portionsRemaining: -1 } })).status, 400);
});

test('meal photos are decoded and stripped, private until review, and scoped to their store in both transports', async (t) => {
  const { default: sharp } = await import('sharp'); const f = await fixture(t);
  const bytes = await sharp({ create: { width: 240, height: 180, channels: 3, background: '#f4b400' } }).jpeg().withMetadata().toBuffer();
  const photo = { mimeType: 'image/jpeg', base64: bytes.toString('base64') };
  const body = { expectedVersion: f.store.version, itemId: f.menu[0].id, item: { ...item, photo } }, key = randomUUID();
  const saved = await f.seller.post(`/api/eats/stores/${f.store.id}/menu`, body, key); assert.equal(saved.status, 200, JSON.stringify(saved.body));
  f.store = saved.body.store; const id = saved.body.menu[0].photoId; assert.ok(id);
  assert.equal((await f.seller.post(`/api/eats/stores/${f.store.id}/menu`, body, key)).body.menu[0].photoId, id);
  assert.equal((await f.customer.send('/api/eats/photos/' + id)).status, 404);
  const own = (await ok(f.seller, '/api/eats/photos/' + id)).photo;
  assert.equal((await sharp(Buffer.from(own.base64, 'base64')).metadata()).exif, undefined);
  await f.open(); assert.equal((await ok(f.customer, '/api/eats/restaurants')).restaurants[0].coverPhotoId, id);
  assert.equal((await ok(f.customer, '/api/eats/photos/' + id)).photo.mimeType, 'image/jpeg');
  assert.equal((await f.stranger.send('/api/eats/photos/' + id, { headers: { Cookie: null } })).status, 401);
  assert.equal((await f.seller.post(`/api/eats/stores/${f.store.id}/menu`, { expectedVersion: f.store.version, itemId: f.menu[0].id, item: { ...item, photo: { mimeType: 'image/jpeg', base64: 'AAAA' } } })).status, 400);
  await ok(f.seller, `/api/eats/stores/${f.store.id}/menu`, { expectedVersion: f.store.version, itemId: f.menu[0].id, item: { ...item, photoId: null } });
  assert.equal((await f.customer.send('/api/eats/photos/' + id)).status, 404);
});

test('schema 19 upgrade preserves populated Eats orders and restaurant settings with backward-compatible defaults', async (t) => {
  const f = await fixture(t, { persistent: true }); await f.open(); const order = await f.place();
  const savedOrder = f.h.db.prepare('SELECT * FROM eats_orders WHERE id=?').get(order.id);
  const legacyDetails = JSON.stringify(details), legacyMenu = JSON.stringify(item);
  f.h.db.prepare('UPDATE eats_stores SET details_json=? WHERE id=?').run(legacyDetails, f.store.id);
  f.h.db.prepare('UPDATE eats_menu SET details_json=? WHERE id=?').run(legacyMenu, f.menu[0].id);
  removeGuestFixtureTables(f.h.db);
  f.h.db.exec('DROP TABLE eats_collection_points; DROP TABLE eats_checkouts; DROP TABLE eats_photos; PRAGMA user_version=19'); await f.h.restart();
  assert.equal(f.h.db.prepare('PRAGMA user_version').get().user_version, SCHEMA_VERSION);
  const current = await ok(f.seller, '/api/eats/store');
  assert.deepEqual({ name: current.store.name, address: current.store.address, fee: current.store.deliveryFeeKobo, version: current.store.version, isOpen: current.store.isOpen }, { name: details.name, address: details.address, fee: details.deliveryFeeKobo, version: f.store.version, isOpen: true });
  assert.equal(current.store.sellerType, 'restaurant'); assert.equal(current.store.deliveryEnabled, true); assert.equal(current.store.pickupEnabled, false);
  assert.equal(current.menu[0].portionsRemaining, null); assert.equal(current.menu[0].photoId, null);
  assert.deepEqual(f.h.db.prepare('SELECT * FROM eats_orders WHERE id=?').get(order.id), savedOrder);
  assert.deepEqual(f.h.db.prepare('PRAGMA foreign_key_check').all(), []);
});

for (const sellerType of ['home_kitchen', 'food_vendor']) test(`native ${sellerType} seller can upload a meal photo and serve customer pickup through shared device contracts`, async (t) => {
  const { default: sharp } = await import('sharp'); const f = await homeFixture(t, { sellerType });
  const login = async (person) => (await person.send('/api/mobile/v1/auth/login', { method: 'POST', data: { email: person.user.email, password: PASSWORD, deviceName: 'Home kitchen phone' }, headers: { Origin: null, Cookie: null, 'X-CSRF-Token': null } })).body.credentials.accessToken;
  const sellerToken = await login(f.seller), customerToken = await login(f.customer);
  const native = (token, path, data) => f.stranger.send('/api/mobile/v1/eats' + path, { ...(data ? { method: 'POST', data } : {}), headers: { Origin: null, Cookie: null, 'X-CSRF-Token': null, Authorization: `Bearer ${token}`, 'Idempotency-Key': randomUUID() } });
  const bytes = await sharp({ create: { width: 240, height: 180, channels: 3, background: '#c3703f' } }).png().toBuffer();
  const upload = await native(sellerToken, `/stores/${f.store.id}/menu`, { expectedVersion: f.store.version, itemId: f.menu[0].id, item: { ...item, portionsRemaining: 4, photo: { mimeType: 'image/png', base64: bytes.toString('base64') } } });
  assert.equal(upload.status, 200, JSON.stringify(upload.body)); f.store = upload.body.store;
  const catalog = await native(customerToken, '/restaurants'); assert.equal(catalog.body.restaurants[0].address, ''); assert.equal(catalog.body.restaurants[0].sellerType, sellerType);
  const id = upload.body.menu[0].photoId; assert.equal((await native(customerToken, '/photos/' + id)).body.photo.id, id);
  const quote = (await native(customerToken, '/quotes', { ...f.basket(), fulfillment: 'pickup' })).body.quote;
  assert.equal(quote.restaurant.addressHidden, true); assert.equal(quote.restaurant.address, '');
  let order = (await native(customerToken, '/orders', { quoteId: quote.id })).body.order;
  assert.equal(order.restaurant.addressHidden, true); assert.equal(order.restaurant.address, '');
  for (const action of ['accept', 'prepare', 'ready']) { const response = await native(sellerToken, `/orders/${order.id}/${action}`, { expectedVersion: order.version, ...(action === 'ready' && order.needsCollectionPoint ? { collectionPoint: details.address } : {}) }); assert.equal(response.status, 200); order = response.body.order; }
  const ready = (await native(customerToken, '/orders/' + order.id)).body.order;
  assert.equal(ready.restaurant.address, details.address); assert.equal(ready.totals.deliveryFeeKobo, 0);
  assert.equal((await native(sellerToken, `/orders/${order.id}/complete_pickup`, { expectedVersion: order.version, pin: ready.deliveryPin })).body.order.status, 'delivered');
  assert.equal((await native(customerToken, '/orders/' + order.id)).body.order.restaurant.address, '');
});

test('a meal photo cannot be committed after its session is revoked during decoding', async () => {
  const { createEatsService } = await import('../src/modules/eats/service.mjs');
  const user = { id: randomUUID(), role: 'customer' }, id = randomUUID(); let complete, writes = 0;
  let started; const decoding = new Promise((resolve) => { started = resolve; });
  const service = createEatsService({ repository: { store: () => ({ id, version: 1 }), membership: () => ({ storeId: id }), command: () => null },
    getAccount: () => user, normalisePhoto: () => new Promise((resolve) => { complete = resolve; started(); }), unitOfWork: () => { writes++; }, clock: () => 1 });
  const pending = service.saveMenu(user, id, { expectedVersion: 1, itemId: null, item: { ...item, photo: { mimeType: 'image/jpeg', base64: 'fixture' } } }, randomUUID(), () => null);
  await decoding;
  complete('normalised-fixture'); await assert.rejects(pending, (error) => error.code === 'UNAUTHENTICATED'); assert.equal(writes, 0);
});
