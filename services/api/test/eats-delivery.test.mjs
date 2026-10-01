import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { harness, participants, PASSWORD } from './helpers.mjs';
import { readEatsResponse } from '../../../packages/shared/src/eats-contracts.mjs';
import { SCHEMA_VERSION } from '../src/infrastructure/database.mjs';
import { createEatsService } from '../src/modules/eats/service.mjs';
import { removeEatsDeliveryProfileFixtureTable } from './migration-fixtures.mjs';

const address = { line: '20 Fictional Close, house 2, blue gate', areaId: 'maitama', point: { lat: 9.099123, lng: 7.493456 } };
const recipient = { kind: 'other', name: 'Fictional Recipient', phone: '+2348012345678' };
async function ok(client, path, data, key) {
  const response = data === undefined ? await client.send('/api/eats' + path) : await client.post('/api/eats' + path, data, key);
  assert.equal(response.status, 200, JSON.stringify(response.body));
  return readEatsResponse(response.body);
}
async function fixture(t, options = {}) {
  const h = await harness(t, options), people = await participants(h), kitchens = [];
  for (let index = 0; index < 2; index++) {
    const seller = h.client(); await seller.register(`delivery-seller-${index}`);
    let { store } = await ok(seller, '/stores', { details: { name: `Delivery Kitchen ${index}`, cuisine: 'Nigerian', description: 'Fictional delivery test restaurant.', address: '10 Fictional Business Road', areaId: 'wuse-ii', deliveryAreaIds: ['maitama'], prepMinutes: 25, minimumKobo: 0, deliveryFeeKobo: 100000 } });
    let menu;
    ({ store, menu } = await ok(seller, `/stores/${store.id}/menu`, { expectedVersion: store.version, itemId: null, item: { name: 'Jollof rice', description: 'Rice and tomato.', category: 'Meals', priceKobo: 250000, available: true } }));
    ({ store } = await ok(people.admin, `/stores/${store.id}/review`, { expectedVersion: store.version, decision: 'approved', reason: 'Fictional delivery kitchen reviewed.', reference: 'DELIVERY-TEST' }));
    ({ store } = await ok(seller, `/stores/${store.id}/open`, { expectedVersion: store.version, isOpen: true }));
    kitchens.push({ seller, store, menu });
  }
  const basket = () => ({ storeId: kitchens[0].store.id, expectedVersion: kitchens[0].store.version, items: [{ itemId: kitchens[0].menu[0].id, quantity: 1 }], address, instructions: 'Call at the gate.' });
  return { h, ...people, kitchens, basket };
}

test('self and other recipients are validated and snapshotted independently of later saved-address edits', async t => {
  const f = await fixture(t, { persistent: true });
  const self = (await ok(f.customer, '/quotes', f.basket())).quote;
  assert.deepEqual(self.recipient, { kind: 'self', name: f.customer.user.name, phone: '' });
  assert.deepEqual(self.address, address);
  for (const bad of [null, { kind: 'other', name: 'A', phone: recipient.phone }, { kind: 'other', name: recipient.name, phone: '8012345678' }, { kind: 'self', phone: false }, { kind: 'other', name: recipient.name, phone: recipient.phone, userId: randomUUID() }]) {
    assert.equal((await f.customer.post('/api/eats/quotes', { ...f.basket(), recipient: bad })).status, 400);
  }
  for (const point of [{ lat: 41.8781, lng: -87.6298 }, { lat: 9.1, lng: 7.4, address: 'untrusted' }]) {
    assert.equal((await f.customer.post('/api/eats/quotes', { ...f.basket(), address: { ...address, point } })).status, 400);
  }
  const key = randomUUID(), data = { ...f.basket(), recipient: { ...recipient, phone: '0801 234 5678' } };
  const quote = (await ok(f.customer, '/quotes', data, key)).quote;
  assert.deepEqual(quote.recipient, recipient);
  await ok(f.customer, '/delivery-profile', { expectedVersion: 0, label: 'home', address });
  await ok(f.customer, '/delivery-profile', { expectedVersion: 1, label: 'home', address: { ...address, line: '99 New Fictional Street, red gate', point: null } });
  assert.deepEqual((await ok(f.customer, '/quotes', data, key)).quote, quote);
  const placeKey = randomUUID(), placed = await ok(f.customer, '/orders', { quoteId: quote.id }, placeKey);
  assert.deepEqual(placed.order.recipient, recipient); assert.deepEqual(placed.order.address, address);
  await ok(f.customer, '/delivery-profile', { expectedVersion: 2, label: 'home', address: null });
  await f.h.restart();
  assert.deepEqual((await ok(f.customer, '/orders', { quoteId: quote.id }, placeKey)).order.address, address);
  assert.deepEqual((await ok(f.customer, `/orders/${placed.order.id}`)).order.recipient, recipient);
  const snapshot = JSON.parse(f.h.db.prepare('SELECT snapshot_json AS snapshot FROM eats_orders WHERE id=?').get(placed.order.id).snapshot);
  assert.deepEqual(snapshot.address, address); assert.deepEqual(snapshot.recipient, recipient);
});

test('mixed-kitchen checkout carries one immutable recipient and address through native placement and retries', async t => {
  const f = await fixture(t);
  const data = { groups: f.kitchens.map(k => ({ storeId: k.store.id, expectedVersion: k.store.version, items: [{ itemId: k.menu[0].id, quantity: 1 }] })), address, recipient, instructions: 'Deliver this gift at the gate.' };
  const login = await f.customer.send('/api/mobile/v1/auth/login', { method: 'POST', data: { email: f.customer.user.email, password: PASSWORD, deviceName: 'Delivery test phone' }, headers: { Origin: null, Cookie: null, 'X-CSRF-Token': null } });
  assert.equal(login.status, 200); const token = login.body.credentials.accessToken;
  const native = (path, body, key = randomUUID()) => f.customer.send('/api/mobile/v1/eats' + path, { method: 'POST', data: body, headers: { Origin: null, Cookie: null, 'X-CSRF-Token': null, Authorization: `Bearer ${token}`, 'Idempotency-Key': key } });
  const response = await native('/checkouts', data); assert.equal(response.status, 200, JSON.stringify(response.body));
  const checkout = readEatsResponse(response.body).checkout;
  for (const quote of checkout.quotes) { assert.deepEqual(quote.address, address); assert.deepEqual(quote.recipient, recipient); }
  const key = randomUUID(), results = await Promise.all([native('/checkouts/place', { checkoutId: checkout.id }, key), native('/checkouts/place', { checkoutId: checkout.id }, key)]);
  for (const result of results) {
    assert.equal(result.status, 200, JSON.stringify(result.body));
    for (const order of readEatsResponse(result.body).orders) { assert.deepEqual(order.address, address); assert.deepEqual(order.recipient, recipient); }
  }
  assert.deepEqual(results[0].body.orders.map(o => o.id), results[1].body.orders.map(o => o.id));
  assert.equal(f.h.db.prepare('SELECT count(*) AS n FROM eats_orders').get().n, 2);
});

test('recipient contact and delivery pin coordinates are visible only to authorized order participants', async t => {
  const f = await fixture(t), seller = f.kitchens[0].seller;
  const quote = (await ok(f.customer, '/quotes', { ...f.basket(), recipient })).quote;
  let { order } = await ok(f.customer, '/orders', { quoteId: quote.id });
  const kitchen = (await ok(seller, `/orders/${order.id}`)).order;
  assert.deepEqual(kitchen.recipient, { kind: 'other', name: recipient.name }); assert.deepEqual(kitchen.address, { areaId: address.areaId });
  for (const action of ['accept', 'prepare', 'ready']) ({ order } = await ok(seller, `/orders/${order.id}/${action}`, { expectedVersion: order.version }));
  const pickupPin = order.pickupPin;
  const jobs = await ok(f.driver, '/work');
  assert.equal(JSON.stringify(jobs.available).includes(recipient.name), false); assert.equal(JSON.stringify(jobs.available).includes(recipient.phone), false);
  assert.equal(JSON.stringify(jobs.available).includes(String(address.point.lat)), false);
  ({ order } = await ok(f.driver, `/orders/${order.id}/claim`, { expectedVersion: order.version }));
  assert.deepEqual(order.recipient, recipient); assert.deepEqual(order.address, address);
  const adminOrder = (await ok(f.admin, `/orders/${order.id}`)).order; assert.deepEqual(adminOrder.recipient, recipient);
  await f.driver.shareFoodLocation(order.id);
  ({ order } = await ok(f.driver, `/orders/${order.id}/pickup`, { expectedVersion: order.version, pin: pickupPin }));
  const deliveryPin = (await ok(f.customer, `/orders/${order.id}`)).order.deliveryPin;
  ({ order } = await ok(f.driver, `/orders/${order.id}/arrive`, { expectedVersion: order.version }));
  ({ order } = await ok(f.driver, `/orders/${order.id}/deliver`, { expectedVersion: order.version, pin: deliveryPin }));
  assert.deepEqual(order.recipient, { kind: 'other', name: recipient.name }); assert.equal(Object.hasOwn(order.address, 'point'), false);
  const history = (await ok(f.driver, '/orders?scope=courier')).orders[0]; assert.equal(history.recipient.phone, undefined); assert.equal(history.address.point, undefined);
  const customer = (await ok(f.customer, `/orders/${order.id}`)).order; assert.deepEqual(customer.recipient, recipient); assert.deepEqual(customer.address.point, address.point);
});

test('schema 42 upgrade adds empty saved addresses without modifying older order snapshots', async t => {
  const f = await fixture(t, { persistent: true });
  const quote = (await ok(f.customer, '/quotes', f.basket())).quote;
  const { order } = await ok(f.customer, '/orders', { quoteId: quote.id });
  const old = JSON.parse(f.h.db.prepare('SELECT snapshot_json AS snapshot FROM eats_orders WHERE id=?').get(order.id).snapshot); delete old.recipient; delete old.address.point;
  const encoded = JSON.stringify(old); f.h.db.prepare('UPDATE eats_orders SET snapshot_json=? WHERE id=?').run(encoded, order.id);
  removeEatsDeliveryProfileFixtureTable(f.h.db); f.h.db.exec('PRAGMA user_version=42'); await f.h.restart();
  assert.equal(f.h.db.prepare('PRAGMA user_version').get().user_version, SCHEMA_VERSION);
  assert.deepEqual((await ok(f.customer, '/delivery-profile')).deliveryProfile, { version: 0, addresses: { home: null, work: null } });
  assert.equal((await ok(f.customer, `/orders/${order.id}`)).order.recipient.kind, 'self');
  assert.equal(f.h.db.prepare('SELECT snapshot_json AS snapshot FROM eats_orders WHERE id=?').get(order.id).snapshot, encoded);
});

test('lookup discards location output after session revocation and rejects foreign points before external I/O', async () => {
  const user = { id: randomUUID(), role: 'customer', capabilities: ['customer'], name: 'Customer' }; let complete, began, lookups = 0;
  const started = new Promise(resolve => { began = resolve; });
  const service = createEatsService({ getAccount: async () => user, resolveDeliveryLocation: point => { lookups++; began(); return new Promise(resolve => { complete = () => resolve({ point, line: 'Fictional road', areaId: 'maitama', attribution: '' }); }); } });
  await assert.rejects(service.deliveryLocation(user, { lat: 41.87, lng: -87.63 }, async () => user), error => error.code === 'INVALID_LOCATION'); assert.equal(lookups, 0);
  const pending = service.deliveryLocation(user, address.point, async () => null); await started; complete();
  await assert.rejects(pending, error => error.code === 'UNAUTHENTICATED'); assert.equal(lookups, 1);
});
