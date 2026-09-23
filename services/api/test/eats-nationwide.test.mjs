import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { dirname, join } from 'node:path';
import { harness, participants, PASSWORD } from './helpers.mjs';
import { foodAreaId, LEGACY_FOOD_AREAS } from '../../../packages/shared/src/nigeria-areas.mjs';
import { SCHEMA_VERSION } from '../src/infrastructure/database.mjs';
import { saveSnapshot } from '../src/infrastructure/database-snapshot.mjs';
import { removeNationwideEatsFixtureTables } from './migration-fixtures.mjs';

const IKEJA = foodAreaId('lagos', 'Ikeja');
const KANO = foodAreaId('kano', 'Kano');
const LAGOS_POINT = { lat: 6.6018, lng: 3.3515 };
const KANO_POINT = { lat: 12.0022, lng: 8.5920 };
const item = { name: 'Jollof rice and plantain', description: 'Fictional test meal.', category: 'Meals', priceKobo: 200_000, available: true, portionsRemaining: 20 };

async function ok(client, path, data, key) {
  const r = data === undefined ? await client.send('/api/eats' + path) : await client.post('/api/eats' + path, data, key);
  assert.equal(r.status, 200, JSON.stringify(r.body)); return r.body;
}
async function fixture(t, options) {
  const h = await harness(t, options), people = await participants(h, 2, { online: false });
  let sequence = 0;
  async function kitchen(areaId = IKEJA, dispatchPoint = LAGOS_POINT, sellerType = 'home_kitchen', options = {}) {
    const seller = h.client(); await seller.register('nationwide-kitchen-' + sequence++);
    const details = { sellerType, name: 'Nationwide Test Kitchen', cuisine: 'Nigerian', description: 'Fictional nationwide test kitchen.', areaId,
      prepMinutes: 20, minimumKobo: 0, deliveryFeeKobo: 100_000, ...(sellerType === 'restaurant' ? { address: '10 Fictional Restaurant Road' } : {}), ...(dispatchPoint ? { dispatchPoint } : {}), ...(options.details ?? {}) };
    let { store } = await ok(seller, '/stores', { details }), menu;
    ({ store, menu } = await ok(seller, `/stores/${store.id}/menu`, { expectedVersion: store.version, itemId: null, item }));
    const k = { seller, details, store, menu };
    k.open = async () => {
      ({ store: k.store } = await ok(people.admin, `/stores/${k.store.id}/review`, { expectedVersion: k.store.version, decision: 'approved', reason: 'Fictional kitchen location manually reviewed.', reference: 'NATIONWIDE-TEST' }));
      ({ store: k.store } = await ok(seller, `/stores/${k.store.id}/open`, { expectedVersion: k.store.version, isOpen: true }));
    };
    k.basket = async (destination = areaId) => {
      ({ store: k.store } = await ok(seller, '/store'));
      return { storeId: k.store.id, expectedVersion: k.store.version, items: [{ itemId: menu[0].id, quantity: 1 }], address: { line: '20 Fictional Destination Road', areaId: destination }, instructions: '' };
    };
    k.quote = async () => (await ok(people.customer, '/quotes', await k.basket())).quote;
    k.place = async () => (await ok(people.customer, '/orders', { quoteId: (await k.quote()).id })).order;
    k.ready = async () => {
      let order = await k.place();
      for (const action of ['accept', 'prepare', 'ready']) ({ order } = await ok(seller, `/orders/${order.id}/${action}`, { expectedVersion: order.version,
        ...(action === 'ready' && order.needsCollectionPoint ? { collectionPoint: 'Fictional private collection gate' } : {}) }));
      return order;
    };
    if (options.open !== false) await k.open(); return k;
  }
  return { h, ...people, kitchen };
}
function noPrivatePoint(value, message = 'private dispatch coordinates must not be projected') {
  const raw = JSON.stringify(value);
  for (const field of ['dispatchPoint', 'dispatchLat', 'dispatchLng', 'lat', 'lng']) assert.equal(raw.includes(`"${field}"`), false, message + ': ' + field);
}

test('state-and-town food discovery and checkout use explicit local coverage; legacy omitted coverage stays in the original areas', async (t) => {
  const f = await fixture(t), lagos = await f.kitchen(), otherStateSameTown = foodAreaId('ogun', 'Ikeja');
  assert.deepEqual(lagos.store.deliveryAreaIds, [IKEJA]);
  assert.equal((await ok(f.customer, '/foods?areaId=' + IKEJA)).foodCount, 1);
  for (const areaId of [KANO, otherStateSameTown]) {
    assert.equal((await ok(f.customer, '/foods?areaId=' + areaId)).foodCount, 0);
    const result = await f.customer.post('/api/eats/quotes', await lagos.basket(areaId));
    assert.equal(result.body.error.code, 'STORE_UNAVAILABLE');
  }
  for (const areaId of ['ghana:accra', 'ng:unknown:ikeja', 'ng:lagos:../ikeja']) {
    assert.equal((await f.customer.send('/api/eats/foods?areaId=' + encodeURIComponent(areaId))).status, 400);
    assert.equal((await f.customer.post('/api/eats/quotes', await lagos.basket(areaId))).status, 400);
  }
  const legacy = await f.kitchen('wuse-ii', null, 'restaurant');
  const record = JSON.parse(f.h.db.prepare('SELECT details_json FROM eats_stores WHERE id=?').get(legacy.store.id).details_json);
  delete record.deliveryAreaIds;
  f.h.db.prepare('UPDATE eats_stores SET details_json=? WHERE id=?').run(JSON.stringify(record), legacy.store.id);
  assert.deepEqual((await ok(legacy.seller, '/store')).store.deliveryAreaIds, LEGACY_FOOD_AREAS.map((a) => a.id));
  assert.equal((await ok(f.customer, '/foods?areaId=maitama')).foods[0].store.id, legacy.store.id);
  assert.equal((await ok(f.customer, '/foods?areaId=' + IKEJA)).foods.some((food) => food.store.id === legacy.store.id), false);
  assert.equal((await f.customer.post('/api/eats/quotes', await legacy.basket(IKEJA))).body.error.code, 'STORE_UNAVAILABLE');
});

test('GPS couriers only discover and claim nearby pinned kitchens; another state and missing pins cannot bypass matching', async (t) => {
  const f = await fixture(t), lagos = await f.kitchen(), kano = await f.kitchen(KANO, KANO_POINT), noPin = await f.kitchen('maitama', null);
  const lagosOrder = await lagos.ready(), kanoOrder = await kano.ready(), noPinOrder = await noPin.ready();
  await f.driver.online({ mode: 'gps', ...LAGOS_POINT });
  const work = await ok(f.driver, '/work');
  assert.deepEqual(work.available.map((o) => o.id), [lagosOrder.id]); noPrivatePoint(work);
  for (const order of [kanoOrder, noPinOrder]) {
    const r = await f.driver.post(`/api/eats/orders/${order.id}/claim`, { expectedVersion: order.version });
    assert.equal(r.body.error.code, 'OUTSIDE_MATCH_AREA');
    assert.equal((await ok(f.customer, `/orders/${order.id}`)).order.status, 'ready');
  }
  await f.drivers[1].online({ mode: 'gps', ...KANO_POINT });
  assert.deepEqual((await ok(f.drivers[1], '/work')).available.map((o) => o.id), [kanoOrder.id]);
  await f.driver.online({ mode: 'gps', lat: LAGOS_POINT.lat + 0.11, lng: LAGOS_POINT.lng });
  assert.equal((await ok(f.driver, '/work')).available.length, 0);
  assert.equal((await f.driver.post(`/api/eats/orders/${lagosOrder.id}/claim`, { expectedVersion: lagosOrder.version })).body.error.code, 'OUTSIDE_MATCH_AREA');
  await f.driver.online({ mode: 'gps', lat: LAGOS_POINT.lat + 0.04, lng: LAGOS_POINT.lng });
  const assigned = (await ok(f.driver, `/orders/${lagosOrder.id}/claim`, { expectedVersion: lagosOrder.version })).order;
  assert.equal(assigned.status, 'assigned'); noPrivatePoint(assigned);
});

test('private dispatch pins are owner/admin only across discovery, quote, retry, mobile, courier and history views', async (t) => {
  const f = await fixture(t), k = await f.kitchen();
  assert.deepEqual((await ok(k.seller, '/store')).store.dispatchPoint, LAGOS_POINT);
  assert.deepEqual((await ok(f.admin, `/restaurants/${k.store.id}`)).store.dispatchPoint, LAGOS_POINT);
  for (const path of ['/restaurants?areaId=' + IKEJA, `/restaurants/${k.store.id}`, '/foods?areaId=' + IKEJA]) noPrivatePoint(await ok(f.customer, path), path);
  const quote = await k.quote(); noPrivatePoint(quote);
  const key = randomUUID(), data = { quoteId: quote.id };
  let { order } = await ok(f.customer, '/orders', data, key); noPrivatePoint(order);
  noPrivatePoint(await ok(f.customer, '/orders', data, key));
  for (const action of ['accept', 'prepare', 'ready']) ({ order } = await ok(k.seller, `/orders/${order.id}/${action}`, { expectedVersion: order.version,
    ...(action === 'ready' ? { collectionPoint: 'Fictional private collection gate' } : {}) }));
  await f.driver.online({ mode: 'gps', ...LAGOS_POINT }); noPrivatePoint(await ok(f.driver, '/work'));
  ({ order } = await ok(f.driver, `/orders/${order.id}/claim`, { expectedVersion: order.version })); noPrivatePoint(order);
  const login = await f.customer.send('/api/mobile/v1/auth/login', { method: 'POST', data: { email: f.customer.user.email, password: PASSWORD, deviceName: 'Nationwide Eats phone' }, headers: { Origin: null, Cookie: null, 'X-CSRF-Token': null } });
  assert.equal(login.status, 200);
  const native = await f.customer.send(`/api/mobile/v1/eats/orders/${order.id}`, { headers: { Origin: null, Cookie: null, 'X-CSRF-Token': null, Authorization: `Bearer ${login.body.credentials.accessToken}` } });
  assert.equal(native.status, 200); noPrivatePoint(native.body);
  await ok(f.admin, `/orders/${order.id}/cancel`, { expectedVersion: order.version, reason: 'Close the test order for history inspection.' });
  noPrivatePoint(await ok(f.customer, '/orders')); noPrivatePoint(await ok(f.driver, '/orders?scope=courier'));
  noPrivatePoint(await ok(f.customer, '/orders', data, key));
});

test('foreign or malformed dispatch points are rejected; changing a valid point closes the kitchen for a new review without moving an existing order', async (t) => {
  const f = await fixture(t, { persistent: true }), k = await f.kitchen(), order = await k.ready();
  ({ store: k.store } = await ok(k.seller, '/store'));
  for (const dispatchPoint of [{ lat: 9.3, lng: 13.4 }, { lat: 6.4969, lng: 2.6289 }, { lat: '6.6018', lng: 3.3515 }, { lat: 6.6018, lng: 3.3515, private: true }]) {
    const r = await k.seller.post(`/api/eats/stores/${k.store.id}/save`, { expectedVersion: k.store.version, details: { ...k.details, dispatchPoint } });
    assert.equal(r.status, 400, JSON.stringify(r.body));
  }
  const before = f.h.db.prepare('SELECT * FROM eats_order_dispatch_points WHERE order_id=?').get(order.id);
  assert.equal(before.lat, LAGOS_POINT.lat); assert.equal(before.lng, LAGOS_POINT.lng);
  const nextPoint = { lat: 6.4818, lng: LAGOS_POINT.lng };
  ({ store: k.store } = await ok(k.seller, `/stores/${k.store.id}/save`, { expectedVersion: k.store.version, details: { ...k.details, dispatchPoint: nextPoint } }));
  assert.equal(k.store.status, 'pending'); assert.equal(k.store.isOpen, false); assert.deepEqual(k.store.dispatchPoint, nextPoint);
  assert.equal((await ok(f.customer, '/foods?areaId=' + IKEJA)).foodCount, 0);
  assert.equal((await k.seller.post(`/api/eats/stores/${k.store.id}/open`, { expectedVersion: k.store.version, isOpen: true })).status, 409);
  await f.h.restart();
  assert.deepEqual(f.h.db.prepare('SELECT * FROM eats_order_dispatch_points WHERE order_id=?').get(order.id), before);
  await f.driver.online({ mode: 'gps', ...LAGOS_POINT });
  assert.deepEqual((await ok(f.driver, '/work')).available.map((o) => o.id), [order.id]);
  await f.drivers[1].online({ mode: 'gps', ...nextPoint });
  assert.equal((await ok(f.drivers[1], '/work')).available.length, 0);
  await k.open();
  const fresh = await k.place(), saved = f.h.db.prepare('SELECT lat,lng FROM eats_order_dispatch_points WHERE order_id=?').get(fresh.id);
  assert.deepEqual({ ...saved }, nextPoint);
  const destination = join(dirname(f.h.filename), 'nationwide-snapshot.sqlite');
  saveSnapshot(f.h.filename, destination, { now: f.h.now });
  const snapshot = new DatabaseSync(destination, { readOnly: true });
  try {
    for (const table of ['eats_store_dispatch_points', 'eats_order_dispatch_points']) {
      assert.deepEqual(snapshot.prepare(`SELECT * FROM ${table} ORDER BY 1`).all(), f.h.db.prepare(`SELECT * FROM ${table} ORDER BY 1`).all());
    }
    assert.equal(snapshot.prepare('SELECT count(*) AS n FROM driver_availability WHERE active=1 OR position_json IS NOT NULL').get().n, 0);
    assert.equal(f.h.db.prepare('SELECT count(*) AS n FROM driver_availability WHERE active=1').get().n, 2);
  } finally { snapshot.close(); }
});

test('order dispatch snapshots commit atomically with inventory and idempotency and are not duplicated on retry', async (t) => {
  const f = await fixture(t), k = await f.kitchen(), quote = await k.quote(), key = randomUUID();
  f.h.db.exec("CREATE TRIGGER reject_nationwide_order BEFORE INSERT ON eats_commands BEGIN SELECT RAISE(ABORT, 'fixture'); END");
  assert.equal((await f.customer.post('/api/eats/orders', { quoteId: quote.id }, key)).status, 500);
  for (const table of ['eats_orders', 'eats_order_dispatch_points']) assert.equal(f.h.db.prepare(`SELECT count(*) AS n FROM ${table}`).get().n, 0);
  assert.equal(f.h.db.prepare('SELECT order_id FROM eats_quotes WHERE id=?').get(quote.id).order_id, null);
  assert.equal((await ok(k.seller, '/store')).menu[0].portionsRemaining, 20);
  f.h.db.exec('DROP TRIGGER reject_nationwide_order');
  const first = await ok(f.customer, '/orders', { quoteId: quote.id }, key), replay = await ok(f.customer, '/orders', { quoteId: quote.id }, key);
  assert.equal(first.order.id, replay.order.id); assert.equal(replay.replayed, true);
  assert.equal(f.h.db.prepare('SELECT count(*) AS n FROM eats_order_dispatch_points').get().n, 1);
  assert.equal((await ok(k.seller, '/store')).menu[0].portionsRemaining, 19);
});

test('discovery applies geographic scope before store and ready-order caps so busy distant towns cannot starve local results', async (t) => {
  const f = await fixture(t), local = await f.kitchen(), distant = await f.kitchen(KANO, KANO_POINT);
  const insertStore = f.h.db.prepare(`INSERT INTO eats_stores (id,status,version,is_open,details_json,created_at,updated_at)
    SELECT ?,status,version,is_open,details_json,?,? FROM eats_stores WHERE id=?`);
  const insertMenu = f.h.db.prepare('INSERT INTO eats_menu (id,store_id,available,details_json) SELECT ?,?,available,details_json FROM eats_menu WHERE id=?');
  for (let i = 1; i <= 205; i++) {
    const id = randomUUID(); insertStore.run(id, f.h.now + i, f.h.now + i, distant.store.id); insertMenu.run(randomUUID(), id, distant.menu[0].id);
  }
  assert.deepEqual((await ok(f.customer, '/foods?areaId=' + IKEJA)).foods.map((food) => food.store.id), [local.store.id]);
  assert.deepEqual((await ok(f.customer, '/restaurants?areaId=' + IKEJA)).restaurants.map((store) => store.id), [local.store.id]);
  const farOrder = await distant.ready(), localOrder = await local.ready();
  const insertOrder = f.h.db.prepare(`INSERT INTO eats_orders (id,store_id,customer_id,status,snapshot_json,events_json,created_at,updated_at)
    SELECT ?,store_id,customer_id,status,snapshot_json,events_json,?,? FROM eats_orders WHERE id=?`);
  const insertPoint = f.h.db.prepare('INSERT INTO eats_order_dispatch_points (order_id,lat,lng) SELECT ?,lat,lng FROM eats_order_dispatch_points WHERE order_id=?');
  for (let i = 1; i <= 105; i++) {
    const id = randomUUID(); insertOrder.run(id, f.h.now - i, f.h.now - i, farOrder.id); insertPoint.run(id, farOrder.id);
  }
  await f.driver.online({ mode: 'gps', ...LAGOS_POINT });
  assert.deepEqual((await ok(f.driver, '/work')).available.map((o) => o.id), [localOrder.id]);
});

test('sample couriers remain restricted to their exact demonstration pickup area even without GPS pins', async (t) => {
  const f = await fixture(t), wuse = await f.kitchen('wuse-ii', null), maitama = await f.kitchen('maitama', null);
  const localOrder = await wuse.ready(), otherOrder = await maitama.ready();
  await f.driver.online({ mode: 'sample', areaId: 'wuse-ii' });
  assert.deepEqual((await ok(f.driver, '/work')).available.map((o) => o.id), [localOrder.id]);
  assert.equal((await f.driver.post(`/api/eats/orders/${otherOrder.id}/claim`, { expectedVersion: otherOrder.version })).body.error.code, 'OUTSIDE_MATCH_AREA');
  assert.equal((await ok(f.driver, `/orders/${localOrder.id}/claim`, { expectedVersion: localOrder.version })).order.status, 'assigned');
});

test('new nationwide delivery kitchens need a reviewed dispatch pin; pickup-only kitchens can operate without one', async (t) => {
  const f = await fixture(t), k = await f.kitchen(IKEJA, null, 'home_kitchen', { open: false });
  ({ store: k.store } = await ok(f.admin, `/stores/${k.store.id}/review`, { expectedVersion: k.store.version, decision: 'approved', reason: 'Fictional kitchen reviewed before dispatch setup.', reference: 'MISSING-PIN' }));
  const opened = await k.seller.post(`/api/eats/stores/${k.store.id}/open`, { expectedVersion: k.store.version, isOpen: true });
  assert.equal(opened.status, 409, JSON.stringify(opened.body));
  // A stale open flag cannot bypass the quote/discovery preconditions.
  f.h.db.prepare('UPDATE eats_stores SET is_open=1 WHERE id=?').run(k.store.id);
  assert.equal((await f.customer.post('/api/eats/quotes', await k.basket())).status, 409);
  assert.equal((await ok(f.customer, '/foods?areaId=' + IKEJA)).foodCount, 0);
  k.details = { ...k.details, deliveryEnabled: false, pickupEnabled: true };
  ({ store: k.store } = await ok(k.seller, `/stores/${k.store.id}/save`, { expectedVersion: k.store.version, details: k.details }));
  assert.equal(k.store.status, 'pending'); assert.equal(k.store.isOpen, false);
  await k.open();
  const quote = (await ok(f.customer, '/quotes', { ...await k.basket(), fulfillment: 'pickup', address: { line: '', areaId: '' } })).quote;
  assert.equal(quote.fulfillment, 'pickup'); assert.equal(quote.totals.deliveryFeeKobo, 0);
  assert.deepEqual(quote.address, { areaId: IKEJA });
  const order = (await ok(f.customer, '/orders', { quoteId: quote.id })).order;
  assert.equal(order.fulfillment, 'pickup');
  assert.equal(f.h.db.prepare('SELECT count(*) AS n FROM eats_order_dispatch_points WHERE order_id=?').get(order.id).n, 0);
  k.details = { ...k.details, deliveryEnabled: true };
  ({ store: k.store } = await ok(k.seller, `/stores/${k.store.id}/save`, { expectedVersion: (await ok(k.seller, '/store')).store.version, details: k.details }));
  assert.equal(k.store.status, 'pending'); assert.equal(k.store.isOpen, false);
});

test('schema 22 upgrade preserves existing account and Eats records and creates empty private dispatch tables', async (t) => {
  const f = await fixture(t, { persistent: true }), k = await f.kitchen('wuse-ii', null), order = await k.place();
  const tables = f.h.db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT IN ('eats_store_dispatch_points','eats_order_dispatch_points') ORDER BY name").all().map((row) => row.name);
  const before = new Map(tables.map((name) => [name, f.h.db.prepare(`SELECT * FROM ${name}`).all()]));
  removeNationwideEatsFixtureTables(f.h.db); f.h.db.exec('PRAGMA user_version=22');
  await f.h.restart();
  assert.equal(f.h.db.prepare('PRAGMA user_version').get().user_version, SCHEMA_VERSION);
  for (const name of tables) assert.deepEqual(f.h.db.prepare(`SELECT * FROM ${name}`).all(), before.get(name), name);
  for (const table of ['eats_store_dispatch_points', 'eats_order_dispatch_points']) assert.equal(f.h.db.prepare(`SELECT count(*) AS n FROM ${table}`).get().n, 0);
  assert.deepEqual(f.h.db.prepare('PRAGMA foreign_key_check').all(), []);
  assert.equal((await ok(f.customer, `/orders/${order.id}`)).order.id, order.id);
});
