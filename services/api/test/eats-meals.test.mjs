import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { harness, participants, PASSWORD } from './helpers.mjs';
import { readEatsResponse } from '../../../packages/shared/src/eats-contracts.mjs';
import { SCHEMA_VERSION } from '../src/infrastructure/database.mjs';
import { removeGuestFixtureTables } from './migration-fixtures.mjs';

const address = { line: '20 Fictional Close, test blue gate', areaId: 'maitama' };
const privatePoint = 'Test collection point beside the community gate';
async function ok(client, path, data, key) {
  const response = data === undefined ? await client.send('/api/eats' + path) : await client.post('/api/eats' + path, data, key);
  assert.equal(response.status, 200, JSON.stringify(response.body));
  return readEatsResponse(response.body);
}
async function fixture(t, options = {}) {
  const h = await harness(t, options), people = await participants(h), kitchens = [];
  for (const [index, sellerType] of ['restaurant', 'food_vendor', 'home_kitchen'].entries()) {
    const seller = h.client(); await seller.register('meal-seller-' + index);
    const details = { sellerType, name: ['Jollof Spot', 'Dodo Vendor', 'Mama Test Kitchen'][index], cuisine: 'Nigerian', description: 'Fictional meal builder kitchen.', ...(sellerType === 'restaurant' ? { address: '10 Fictional Business Road' } : {}), areaId: 'wuse-ii', deliveryAreaIds: ['maitama'], prepMinutes: 25, minimumKobo: 0, deliveryFeeKobo: 100_000 };
    let { store } = await ok(seller, '/stores', { details });
    const item = { name: ['Jollof rice and chicken', 'Fried plantain', 'Egusi and pounded yam'][index], description: ['Rice, tomatoes and grilled chicken.', 'Golden dodo with peppers.', 'Egusi soup with pounded yam.'][index], category: 'Meals', priceKobo: [250_000, 100_000, 300_000][index], available: true, portionsRemaining: 5 };
    let menu;
    ({ store, menu } = await ok(seller, `/stores/${store.id}/menu`, { expectedVersion: store.version, itemId: null, item }));
    ({ store } = await ok(people.admin, `/stores/${store.id}/review`, { expectedVersion: store.version, decision: 'approved', reason: 'Fictional kitchen reviewed for test ordering.', reference: 'MEAL-TEST' }));
    ({ store } = await ok(seller, `/stores/${store.id}/open`, { expectedVersion: store.version, isOpen: true }));
    kitchens.push({ seller, store, menu, item, details });
  }
  const basket = (selected = kitchens) => ({ groups: selected.map((k) => ({ storeId: k.store.id, expectedVersion: k.store.version, items: [{ itemId: k.menu[0].id, quantity: 1 }] })), address, instructions: 'Test handover only.' });
  const quote = async (selected = kitchens) => (await ok(people.customer, '/checkouts', basket(selected))).checkout;
  return { h, ...people, kitchens, basket, quote };
}

test('location-first dish search returns real prices across seller types, filters coverage and availability, and keeps vendors and homes town-only', async (t) => {
  const f = await fixture(t), [restaurant, vendor, home] = f.kitchens;
  assert.equal((await f.customer.send('/api/eats/foods?q=jollof')).status, 400);
  const found = await ok(f.customer, '/foods?areaId=maitama&q=I%20want%20jollof%20rice%20and%20plantain');
  assert.deepEqual(found.foods.map((x) => x.item.name), ['Jollof rice and chicken', 'Fried plantain']);
  assert.deepEqual(found.foods.map((x) => x.item.priceKobo), [250_000, 100_000]);
  assert.equal((await ok(f.customer, '/foods?areaId=wuse-ii')).foodCount, 0);
  const options = (await ok(f.customer, '/foods?areaId=maitama')).foods;
  assert.deepEqual(new Set(options.map((x) => x.store.sellerType)), new Set(['restaurant', 'food_vendor', 'home_kitchen']));
  assert.equal(options.find((x) => x.store.id === restaurant.store.id).store.address, restaurant.details.address);
  for (const kitchen of [vendor, home]) {
    const privateKitchen = options.find((x) => x.store.id === kitchen.store.id).store;
    assert.equal(privateKitchen.address, ''); assert.equal(privateKitchen.addressHidden, true); assert.equal(privateKitchen.areaId, 'wuse-ii');
  }
  assert.equal((await ok(home.seller, '/store')).store.address, '');
  assert.equal((await ok(home.seller, '/foods?areaId=maitama')).foods.some((x) => x.store.id === home.store.id), false);
  await ok(vendor.seller, `/stores/${vendor.store.id}/menu`, { expectedVersion: vendor.store.version, itemId: vendor.menu[0].id, item: { ...vendor.item, portionsRemaining: 0 } });
  assert.equal((await ok(f.customer, '/foods?areaId=maitama&q=plantain')).foodCount, 0);
  await ok(restaurant.seller, `/stores/${restaurant.store.id}/open`, { expectedVersion: restaurant.store.version, isOpen: false });
  assert.equal((await ok(f.customer, '/foods?areaId=maitama&q=jollof')).foodCount, 0);
  const outOfArea = await f.customer.post('/api/eats/checkouts', { ...f.basket([home]), address: { ...address, areaId: 'wuse-ii' } });
  assert.equal(outOfArea.body.error.code, 'STORE_UNAVAILABLE');
});

test('mixed-kitchen checkout itemizes fees and places all orders exactly once across retries and restart', async (t) => {
  const f = await fixture(t, { persistent: true }), checkout = await f.quote();
  assert.equal(checkout.quotes.length, 3);
  assert.deepEqual(checkout.totals, { subtotalKobo: 650_000, deliveryFeeKobo: 300_000, serviceFeeKobo: 32_500, totalKobo: 982_500, currency: 'NGN' });
  assert.equal(checkout.quotes.find((q) => q.restaurant.sellerType === 'home_kitchen').restaurant.address, '');
  assert.equal(checkout.quotes.find((q) => q.restaurant.sellerType === 'food_vendor').restaurant.address, '');
  const key = randomUUID(), data = { checkoutId: checkout.id };
  const [first, second] = await Promise.all([ok(f.customer, '/checkouts/place', data, key), ok(f.customer, '/checkouts/place', data, key)]);
  assert.equal(first.orders.length, 3); assert.deepEqual(second.orders.map((o) => o.id), first.orders.map((o) => o.id));
  for (const order of first.orders) { assert.equal(order.address.line, address.line); assert.equal(order.payment.status, 'not_charged'); }
  for (const k of f.kitchens) assert.equal((await ok(k.seller, '/store')).menu[0].portionsRemaining, 4);
  await f.h.restart();
  assert.deepEqual((await ok(f.customer, '/checkouts/place', data, key)).orders.map((o) => o.id), first.orders.map((o) => o.id));
  assert.equal((await f.customer.post('/api/eats/checkouts/place', data)).body.error.code, 'QUOTE_USED');
  assert.equal(f.h.db.prepare('SELECT count(*) AS n FROM eats_orders').get().n, 3);
  assert.equal((await f.kitchens[0].seller.post('/api/eats/checkouts/place', data)).status, 404);
});

test('an unavailable second kitchen rolls back the first order, portions, quote binding and retry record', async (t) => {
  const f = await fixture(t), checkout = await f.quote(), [, second] = f.kitchens;
  await ok(second.seller, `/stores/${second.store.id}/open`, { expectedVersion: second.store.version, isOpen: false });
  const key = randomUUID(), result = await f.customer.post('/api/eats/checkouts/place', { checkoutId: checkout.id }, key);
  assert.equal(result.body.error.code, 'STORE_UNAVAILABLE');
  assert.equal(f.h.db.prepare('SELECT count(*) AS n FROM eats_orders').get().n, 0);
  assert.equal(f.h.db.prepare('SELECT count(*) AS n FROM eats_quotes WHERE order_id IS NOT NULL').get().n, 0);
  assert.equal(f.h.db.prepare('SELECT count(*) AS n FROM eats_commands WHERE key=?').get(key).n, 0);
  assert.equal((await ok(f.kitchens[0].seller, '/store')).menu[0].portionsRemaining, 5);
});

test('invalid combined baskets, aggregate limits, expired quotes and persistence failure cannot create partial orders', async (t) => {
  const f = await fixture(t), original = f.basket();
  const bad = [ { ...original, groups: [original.groups[0], original.groups[0]] }, { ...original, totalKobo: 1 }, { ...original, groups: [] }, { ...original, groups: original.groups.map((g) => ({ ...g, items: [{ ...g.items[0], quantity: 0 }] })) } ];
  for (const data of bad) assert.equal((await f.customer.post('/api/eats/checkouts', data)).status, 400);
  assert.equal(f.h.db.prepare('SELECT count(*) AS n FROM eats_quotes').get().n, 0);
  const checkout = await f.quote();
  f.h.db.exec("CREATE TRIGGER reject_meal_command BEFORE INSERT ON eats_commands BEGIN SELECT RAISE(ABORT, 'fixture'); END");
  assert.equal((await f.customer.post('/api/eats/checkouts/place', { checkoutId: checkout.id })).status, 500);
  f.h.db.exec('DROP TRIGGER reject_meal_command');
  assert.equal(f.h.db.prepare('SELECT count(*) AS n FROM eats_orders').get().n, 0);
  for (const k of f.kitchens) assert.equal((await ok(k.seller, '/store')).menu[0].portionsRemaining, 5);
  f.h.advance(600_001);
  assert.equal((await f.customer.post('/api/eats/checkouts/place', { checkoutId: checkout.id })).body.error.code, 'QUOTE_EXPIRED');
  for (const k of f.kitchens) ({ store: k.store } = await ok(k.seller, `/stores/${k.store.id}/menu`, { expectedVersion: k.store.version, itemId: k.menu[0].id, item: { ...k.item, priceKobo: 5_000_000 } }));
  const large = f.basket(); large.groups.forEach((g) => { g.items[0].quantity = 2; });
  assert.equal((await f.customer.post('/api/eats/checkouts', large)).body.error.code, 'INVALID_CART');
  assert.equal(f.h.db.prepare('SELECT count(*) AS n FROM eats_checkouts').get().n, 1);
});

for (const sellerType of ['home_kitchen', 'food_vendor']) test(`${sellerType} supplies a private collection point at ready, hidden from customers and unassigned couriers`, async (t) => {
  const f = await fixture(t), home = f.kitchens.find((k) => k.store.sellerType === sellerType), checkout = await f.quote([home]);
  let order = (await ok(f.customer, '/checkouts/place', { checkoutId: checkout.id })).orders[0];
  for (const action of ['accept', 'prepare']) ({ order } = await ok(home.seller, `/orders/${order.id}/${action}`, { expectedVersion: order.version }));
  assert.equal(order.needsCollectionPoint, true);
  assert.equal((await home.seller.post(`/api/eats/orders/${order.id}/ready`, { expectedVersion: order.version })).status, 400);
  ({ order } = await ok(home.seller, `/orders/${order.id}/ready`, { expectedVersion: order.version, collectionPoint: privatePoint }));
  assert.equal(order.restaurant.address, privatePoint);
  const available = await ok(f.driver, '/work'); assert.equal(available.available[0].restaurant.address, '');
  assert.equal(JSON.stringify(await ok(f.customer, '/orders')).includes(privatePoint), false);
  ({ order } = await ok(f.driver, `/orders/${order.id}/claim`, { expectedVersion: order.version }));
  assert.equal(order.restaurant.address, privatePoint);
  assert.equal(JSON.stringify(await ok(f.customer, '/foods?areaId=maitama')).includes(privatePoint), false);
  assert.equal((await ok(home.seller, '/store')).store.address, '');
  await ok(f.admin, `/orders/${order.id}/cancel`, { expectedVersion: order.version, reason: 'Close the assigned test order' });
  assert.equal((await ok(f.driver, `/orders/${order.id}`)).order.restaurant.address, '');
});

test('mobile bearer transport searches dishes and places the same mixed-kitchen checkout', async (t) => {
  const f = await fixture(t);
  const login = await f.customer.send('/api/mobile/v1/auth/login', { method: 'POST', data: { email: f.customer.user.email, password: PASSWORD, deviceName: 'Meal builder phone' }, headers: { Origin: null, Cookie: null, 'X-CSRF-Token': null } });
  const native = async (path, data) => {
    const r = await f.customer.send('/api/mobile/v1/eats' + path, { ...(data ? { method: 'POST', data } : {}), headers: { Origin: null, Cookie: null, 'X-CSRF-Token': null, Authorization: `Bearer ${login.body.credentials.accessToken}`, 'Idempotency-Key': randomUUID() } });
    assert.equal(r.status, 200, JSON.stringify(r.body)); return readEatsResponse(r.body);
  };
  assert.equal((await native('/foods?areaId=maitama&q=egusi')).foods[0].store.sellerType, 'home_kitchen');
  const vendor = (await native('/foods?areaId=maitama&q=plantain')).foods[0].store;
  assert.equal(vendor.sellerType, 'food_vendor'); assert.equal(vendor.address, ''); assert.equal(vendor.addressHidden, true);
  const checkout = (await native('/checkouts', f.basket())).checkout;
  assert.equal(checkout.quotes.find((q) => q.restaurant.sellerType === 'food_vendor').restaurant.address, '');
  assert.equal((await native('/checkouts/place', { checkoutId: checkout.id })).orders.length, 3);
  assert.equal((await ok(f.customer, '/orders')).orders.length, 3);
});

test('legacy vendor profile and order addresses remain private after restart, including snapshots without seller type', async (t) => {
  const f = await fixture(t, { persistent: true }), vendor = f.kitchens[1];
  const legacyAddress = '42 Legacy Vendor Street, private gate';
  const oldProfile = JSON.stringify({ ...vendor.details, address: legacyAddress });
  f.h.db.prepare('UPDATE eats_stores SET details_json=? WHERE id=?').run(oldProfile, vendor.store.id);
  const checkout = await f.quote([vendor]);
  const newSnapshot = JSON.parse(f.h.db.prepare('SELECT snapshot_json FROM eats_quotes WHERE id=?').get(checkout.quotes[0].id).snapshot_json);
  assert.equal(newSnapshot.restaurant.address, '', 'new quotes must not retain a legacy private profile address');
  const placementKey = randomUUID(), placement = { checkoutId: checkout.id };
  let order = (await ok(f.customer, '/checkouts/place', placement, placementKey)).orders[0];
  const legacySnapshot = { ...newSnapshot, restaurant: { ...newSnapshot.restaurant, address: legacyAddress } };
  // Older order snapshots can lack seller type; the current store still controls privacy.
  delete legacySnapshot.restaurant.sellerType;
  const savedSnapshot = JSON.stringify(legacySnapshot);
  f.h.db.prepare('UPDATE eats_orders SET snapshot_json=? WHERE id=?').run(savedSnapshot, order.id);
  f.h.db.prepare('UPDATE eats_quotes SET snapshot_json=? WHERE id=?').run(savedSnapshot, checkout.quotes[0].id);
  await f.h.restart();
  assert.equal(f.h.db.prepare('SELECT snapshot_json FROM eats_orders WHERE id=?').get(order.id).snapshot_json, savedSnapshot);
  for (const path of ['/restaurants', `/restaurants/${vendor.store.id}`, '/foods?areaId=maitama&q=plantain', '/orders', `/orders/${order.id}`]) {
    assert.equal(JSON.stringify(await ok(f.customer, path)).includes(legacyAddress), false, path);
  }
  assert.equal(JSON.stringify(await ok(f.customer, '/checkouts/place', placement, placementKey)).includes(legacyAddress), false);
  const login = await f.customer.send('/api/mobile/v1/auth/login', { method: 'POST', data: { email: f.customer.user.email, password: PASSWORD, deviceName: 'Legacy vendor privacy phone' }, headers: { Origin: null, Cookie: null, 'X-CSRF-Token': null } });
  const nativeOrder = await f.customer.send('/api/mobile/v1/eats/orders/' + order.id, { headers: { Origin: null, Cookie: null, 'X-CSRF-Token': null, Authorization: `Bearer ${login.body.credentials.accessToken}` } });
  assert.equal(nativeOrder.status, 200); assert.equal(nativeOrder.body.order.restaurant.addressHidden, true); assert.equal(nativeOrder.body.order.restaurant.address, '');
  for (const action of ['accept', 'prepare', 'ready']) ({ order } = await ok(vendor.seller, `/orders/${order.id}/${action}`, { expectedVersion: order.version }));
  assert.equal((await ok(f.driver, '/work')).available[0].restaurant.address, '');
  ({ order } = await ok(f.driver, `/orders/${order.id}/claim`, { expectedVersion: order.version }));
  assert.equal(order.restaurant.address, legacyAddress, 'assigned courier retains collection access for an existing order');
  await ok(f.admin, `/orders/${order.id}/cancel`, { expectedVersion: order.version, reason: 'Close the legacy test order' });
  assert.equal((await ok(f.driver, `/orders/${order.id}`)).order.restaurant.address, '');
  assert.deepEqual(f.h.db.prepare('PRAGMA foreign_key_check').all(), []);
});

test('schema 20 upgrade preserves existing Eats records and adds empty combined checkout storage', async (t) => {
  const f = await fixture(t, { persistent: true }), home = f.kitchens[2];
  const quote = (await ok(f.customer, '/quotes', { ...f.basket([home]).groups[0], address, instructions: '' })).quote;
  const order = (await ok(f.customer, '/orders', { quoteId: quote.id })).order;
  const old = f.h.db.prepare('SELECT * FROM eats_orders WHERE id=?').get(order.id);
  removeGuestFixtureTables(f.h.db);
  f.h.db.exec('DROP TABLE eats_collection_points; DROP TABLE eats_checkouts; PRAGMA user_version=20'); await f.h.restart();
  assert.equal(f.h.db.prepare('PRAGMA user_version').get().user_version, SCHEMA_VERSION);
  assert.deepEqual(f.h.db.prepare('SELECT * FROM eats_orders WHERE id=?').get(order.id), old);
  assert.equal(f.h.db.prepare('SELECT count(*) AS n FROM eats_checkouts').get().n, 0);
  assert.deepEqual(f.h.db.prepare('PRAGMA foreign_key_check').all(), []);
});
