import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { harness, participants, PASSWORD } from './helpers.mjs';
import { saveSnapshot } from '../src/infrastructure/database-snapshot.mjs';
import { DatabaseSync } from 'node:sqlite';
import { dirname, join } from 'node:path';
import { removeEatsTrackingFixtureTables } from './migration-fixtures.mjs';
import { SCHEMA_VERSION } from '../src/infrastructure/database.mjs';

async function ok(person, path, data) {
  const result = data === undefined ? await person.send('/api/eats' + path) : await person.post('/api/eats' + path, data);
  assert.equal(result.status, 200, JSON.stringify(result.body)); return result.body;
}
async function fixture(t, options = {}) {
  const h = await harness(t, options), people = await participants(h, 2), seller = h.client(), stranger = h.client();
  await seller.register('tracking-kitchen'); await stranger.register('tracking-stranger');
  let { store } = await ok(seller, '/stores', { details: { name: 'Tracking Kitchen', cuisine: 'Nigerian', description: 'Fictional tracking test kitchen.', ...(options.sellerType ? { sellerType: options.sellerType, dispatchPoint: options.dispatchPoint ?? null } : {}), address: '10 Fictional Business Road', areaId: 'wuse-ii', deliveryAreaIds: ['maitama'], prepMinutes: 20, minimumKobo: 0, deliveryFeeKobo: 100000 } });
  let menu;
  ({ store, menu } = await ok(seller, `/stores/${store.id}/menu`, { expectedVersion: store.version, itemId: null, item: { name: 'Jollof rice', description: 'Rice and tomato.', category: 'Meals', priceKobo: 250000, available: true, ...(options.sellerType === 'home_kitchen' ? { portionsRemaining: 20 } : {}) } }));
  ({ store } = await ok(people.admin, `/stores/${store.id}/review`, { expectedVersion: store.version, decision: 'approved', reason: 'Fictional kitchen checked for tracking tests.', reference: 'TRACK-TEST' }));
  ({ store } = await ok(seller, `/stores/${store.id}/open`, { expectedVersion: store.version, isOpen: true }));
  const quote = (await ok(people.customer, '/quotes', { storeId: store.id, expectedVersion: store.version, items: [{ itemId: menu[0].id, quantity: 1 }], address: { line: '25 Fictional Home Road', areaId: 'maitama' }, instructions: '' })).quote;
  let { order } = await ok(people.customer, '/orders', { quoteId: quote.id });
  for (const action of ['accept', 'prepare', 'ready']) ({ order } = await ok(seller, `/orders/${order.id}/${action}`, { expectedVersion: order.version, ...(action === 'ready' && options.sellerType ? { collectionPoint: '10 Fictional private collection gate' } : {}) }));
  const pickupPin = order.pickupPin;
  ({ order } = await ok(people.driver, `/orders/${order.id}/claim`, { expectedVersion: order.version }));
  const clientId = randomUUID();
  const tracking = (person, path, data, client = clientId, key = randomUUID()) => person.send('/api/eats' + path, { ...(data === undefined ? {} : { method: 'POST', data }), headers: { 'X-Location-Client': client, 'Idempotency-Key': key } });
  const fix = (sequence = 1) => ({ sequence, lat: 9.081, lng: 7.42, accuracy: 8, capturedAt: h.now });
  const start = async () => { const response = await tracking(people.driver, `/orders/${order.id}/tracking/start`, {}); assert.equal(response.status, 200, JSON.stringify(response.body)); return response.body.share; };
  return { h, ...people, seller, stranger, order, pickupPin, tracking, fix, start, clientId };
}

test('food tracking is participant-scoped, client-owned and mandatory for pickup/arrival while completion remains possible after stop', async t => {
  const f = await fixture(t); let order = f.order;
  for (const person of [f.seller, f.stranger, f.admin, f.drivers[1]]) assert.equal((await f.tracking(person, `/orders/${order.id}/tracking`)).status, person === f.admin ? 403 : 404);
  const initial = await f.tracking(f.driver, `/orders/${order.id}/tracking`);
  assert.equal(initial.body.required, true); assert.equal(initial.body.canShare, true); assert.equal(initial.body.share, null);
  const blocked = await f.driver.post(`/api/eats/orders/${order.id}/pickup`, { expectedVersion: order.version, pin: f.pickupPin }); assert.equal(blocked.body.error.code, 'LOCATION_REQUIRED');
  const share = await f.start(); assert.equal(share.orderId, order.id); assert.equal(share.owned, true); assert.equal(share.position, null);
  assert.equal((await f.tracking(f.driver, `/tracking/shares/${share.id}/position`, f.fix())).status, 200);
  const customer = await f.tracking(f.customer, `/orders/${order.id}/tracking`); assert.equal(customer.body.share.owned, false); assert.equal(customer.body.share.position, null); assert.equal(customer.body.share.updatedAt, null);
  const alienWindow = await f.tracking(f.driver, `/tracking/shares/${share.id}/position`, f.fix(2), randomUUID()); assert.equal(alienWindow.body.error.code, 'LOCATION_WINDOW');
  const duplicate = await f.tracking(f.driver, `/tracking/shares/${share.id}/position`, f.fix()); assert.equal(duplicate.body.replayed, true);
  const changed = await f.tracking(f.driver, `/tracking/shares/${share.id}/position`, { ...f.fix(), lng: 7.43 }); assert.equal(changed.body.error.code, 'STALE_LOCATION');
  f.h.advance(30001);
  assert.equal((await f.tracking(f.customer, `/orders/${order.id}/tracking`)).body.share.stale, true);
  assert.equal((await f.driver.post(`/api/eats/orders/${order.id}/pickup`, { expectedVersion: order.version, pin: f.pickupPin })).body.error.code, 'LOCATION_REQUIRED');
  assert.equal((await f.tracking(f.driver, `/tracking/shares/${share.id}/position`, f.fix(2))).status, 200);
  ({ order } = await ok(f.driver, `/orders/${order.id}/pickup`, { expectedVersion: order.version, pin: f.pickupPin }));
  assert.equal((await f.tracking(f.customer, `/orders/${order.id}/tracking`)).body.share.position.lat, f.fix().lat);
  f.h.advance(30001);
  assert.equal((await f.driver.post(`/api/eats/orders/${order.id}/arrive`, { expectedVersion: order.version })).body.error.code, 'LOCATION_REQUIRED');
  assert.equal((await f.tracking(f.driver, `/tracking/shares/${share.id}/position`, f.fix(3))).status, 200);
  ({ order } = await ok(f.driver, `/orders/${order.id}/arrive`, { expectedVersion: order.version }));
  const pin = (await ok(f.customer, `/orders/${order.id}`)).order.deliveryPin;
  assert.equal((await f.tracking(f.driver, `/tracking/shares/${share.id}/stop`, {})).body.share.active, false);
  ({ order } = await ok(f.driver, `/orders/${order.id}/deliver`, { expectedVersion: order.version, pin }));
  assert.equal(order.status, 'delivered'); assert.equal((await f.tracking(f.customer, `/orders/${order.id}/tracking`)).body.share, null);
  const row = f.h.db.prepare('SELECT active,position_json,session_hash,client_hash FROM eats_location_shares WHERE id=?').get(share.id);
  assert.deepEqual({ ...row }, { active: 0, position_json: null, session_hash: null, client_hash: null });
});

test('food tracking expires after sixty seconds and browser logout clears its GPS without exposing it to another account', async t => {
  const f = await fixture(t); let share = await f.start();
  assert.equal((await f.tracking(f.driver, `/tracking/shares/${share.id}/position`, f.fix())).status, 200);
  f.h.advance(60000);
  assert.equal((await f.tracking(f.customer, `/orders/${f.order.id}/tracking`)).body.share, null);
  assert.equal(f.h.db.prepare('SELECT position_json FROM eats_location_shares WHERE id=?').get(share.id).position_json, null);
  share = await f.start(); assert.equal((await f.tracking(f.driver, `/tracking/shares/${share.id}/position`, f.fix())).status, 200);
  assert.equal((await f.driver.post('/api/auth/logout')).status, 200);
  assert.equal(f.h.db.prepare('SELECT active FROM eats_location_shares WHERE id=?').get(share.id).active, 0);
  assert.equal((await f.tracking(f.customer, `/orders/${f.order.id}/tracking`)).body.share, null);
});

test('food native GPS belongs to its device family across token rotation and is scrubbed by device revocation', async t => {
  const f = await fixture(t);
  const nativeAuth = async (path, data) => f.stranger.send('/api/mobile/v1/auth/' + path, { method: 'POST', data, headers: { Origin: null, Cookie: null, 'X-CSRF-Token': null } });
  let login = await nativeAuth('login', { email: f.driver.user.email, password: PASSWORD, deviceName: 'Food courier test phone' }); assert.equal(login.status, 200);
  let credentials = login.body.credentials;
  const native = (path, data, token = credentials.accessToken) => f.stranger.send(`/api/mobile/v1/eats${path}?clientId=${f.clientId}`, { ...(data === undefined ? {} : { method: 'POST', data }), headers: { Origin: null, Cookie: null, 'X-CSRF-Token': null, Authorization: `Bearer ${token}`, 'Idempotency-Key': randomUUID() } });
  const started = await native(`/orders/${f.order.id}/tracking/start`, {}); assert.equal(started.status, 200, JSON.stringify(started.body)); const share = started.body.share;
  assert.equal((await native(`/tracking/shares/${share.id}/position`, f.fix())).status, 200);
  login = await nativeAuth('refresh', { refreshToken: credentials.refreshToken }); assert.equal(login.status, 200); credentials = login.body.credentials;
  assert.equal((await native(`/tracking/shares/${share.id}/position`, f.fix(2))).status, 200);
  const other = await nativeAuth('login', { email: f.driver.user.email, password: PASSWORD, deviceName: 'Other courier phone' }); assert.equal(other.status, 200);
  assert.equal((await native(`/tracking/shares/${share.id}/position`, f.fix(3), other.body.credentials.accessToken)).body.error.code, 'LOCATION_WINDOW');
  assert.equal((await nativeAuth('logout', { refreshToken: credentials.refreshToken })).status, 200);
  assert.equal(f.h.db.prepare('SELECT position_json FROM eats_location_shares WHERE id=?').get(share.id).position_json, null);
  assert.equal((await f.tracking(f.customer, `/orders/${f.order.id}/tracking`)).body.share, null);
});

test('snapshotting clears food courier coordinates and session bindings while preserving the live order', async t => {
  const f = await fixture(t, { persistent: true }), share = await f.start();
  assert.equal((await f.tracking(f.driver, `/tracking/shares/${share.id}/position`, f.fix())).status, 200);
  const destination = join(dirname(f.h.filename), 'food-tracking-snapshot.sqlite'); saveSnapshot(f.h.filename, destination, { now: f.h.now });
  const snapshot = new DatabaseSync(destination, { readOnly: true });
  try {
    assert.equal(snapshot.prepare('SELECT status FROM eats_orders WHERE id=?').get(f.order.id).status, 'assigned');
    const row = snapshot.prepare('SELECT active,position_json,session_hash,client_hash FROM eats_location_shares WHERE id=?').get(share.id);
    assert.deepEqual({ ...row }, { active: 0, position_json: null, session_hash: null, client_hash: null });
    assert.notEqual(f.h.db.prepare('SELECT position_json FROM eats_location_shares WHERE id=?').get(share.id).position_json, null);
  } finally { snapshot.close(); }
});


test('cancelled food deliveries clear a still-active location lease even when its last fix is stale', async t => {
  const f = await fixture(t), share = await f.start();
  assert.equal((await f.tracking(f.driver, `/tracking/shares/${share.id}/position`, f.fix())).status, 200);
  f.h.advance(30001);
  await ok(f.admin, `/orders/${f.order.id}/cancel`, { expectedVersion: f.order.version, reason: 'Cancel this fictional delivery during stale GPS.' });
  assert.equal((await f.tracking(f.customer, `/orders/${f.order.id}/tracking`)).body.share, null);
  const stored = f.h.db.prepare('SELECT active,position_json,session_hash FROM eats_location_shares WHERE id=?').get(share.id);
  assert.deepEqual({ ...stored }, { active: 0, position_json: null, session_hash: null });
});

test('schema 43 migration preserves an assigned food order and starts with no location consent or coordinates', async t => {
  const f = await fixture(t, { persistent: true });
  const original = f.h.db.prepare('SELECT * FROM eats_orders WHERE id=?').get(f.order.id);
  removeEatsTrackingFixtureTables(f.h.db); f.h.db.exec('PRAGMA user_version=43'); await f.h.restart();
  assert.equal(f.h.db.prepare('PRAGMA user_version').get().user_version, SCHEMA_VERSION);
  assert.deepEqual(f.h.db.prepare('SELECT * FROM eats_orders WHERE id=?').get(f.order.id), original);
  assert.equal(f.h.db.prepare('SELECT count(*) AS n FROM eats_location_shares').get().n, 0);
  assert.equal((await f.tracking(f.customer, `/orders/${f.order.id}/tracking`)).body.share, null);
  assert.equal((await f.driver.post(`/api/eats/orders/${f.order.id}/pickup`, { expectedVersion: f.order.version, pin: f.pickupPin })).body.error.code, 'LOCATION_REQUIRED');
});


for (const sellerType of ['home_kitchen', 'food_vendor']) test(`${sellerType} live courier tracking hides its collection location before pickup and near the private dispatch pin`, async t => {
  const pickup = { lat: 9.081, lng: 7.42 };
  const f = await fixture(t, { sellerType, dispatchPoint: pickup }), share = await f.start(); let order = f.order;
  assert.equal((await f.tracking(f.driver, `/tracking/shares/${share.id}/position`, f.fix())).status, 200);
  let customer = (await f.tracking(f.customer, `/orders/${order.id}/tracking`)).body;
  assert.equal(customer.share.position, null); assert.equal(customer.share.updatedAt, null);
  assert.equal(JSON.stringify(customer).includes(String(pickup.lng)), false);
  assert.deepEqual((await f.tracking(f.driver, `/orders/${order.id}/tracking`)).body.share.position, { lat: pickup.lat, lng: pickup.lng, accuracy: 8, capturedAt: f.h.now });
  ({ order } = await ok(f.driver, `/orders/${order.id}/pickup`, { expectedVersion: order.version, pin: f.pickupPin }));
  assert.equal((await f.tracking(f.customer, `/orders/${order.id}/tracking`)).body.share.position, null);
  assert.equal((await f.tracking(f.driver, `/tracking/shares/${share.id}/position`, { ...f.fix(2), lat: pickup.lat + 0.005 })).status, 200);
  assert.equal((await f.tracking(f.customer, `/orders/${order.id}/tracking`)).body.share.position.lat, Number((pickup.lat + 0.005).toFixed(6)));
  assert.equal((await f.tracking(f.driver, `/tracking/shares/${share.id}/position`, f.fix(3))).status, 200);
  customer = (await f.tracking(f.customer, `/orders/${order.id}/tracking`)).body;
  assert.equal(customer.share.position, null); assert.equal(customer.share.updatedAt, null); assert.equal(customer.share.stale, true);
  f.h.db.prepare('DELETE FROM eats_order_dispatch_points WHERE order_id=?').run(order.id);
  assert.equal((await f.tracking(f.driver, `/tracking/shares/${share.id}/position`, { ...f.fix(4), lat: pickup.lat + 0.005 })).status, 200);
  assert.equal((await f.tracking(f.customer, `/orders/${order.id}/tracking`)).body.share.position, null);
});
