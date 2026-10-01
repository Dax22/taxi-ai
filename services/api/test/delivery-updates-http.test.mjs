import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { harness, participants, PASSWORD } from './helpers.mjs';
import { createApplication } from '../src/application.mjs';
import { saveSnapshot } from '../src/infrastructure/database-snapshot.mjs';

const ok = (response, status = 200) => {
  assert.equal(response.status, status, JSON.stringify(response.body));
  return response.body;
};
const inbox = async actor => ok(await actor.send('/api/delivery-updates'));
const food = async (actor, path, data, key) => ok(data === undefined
  ? await actor.send('/api/eats' + path) : await actor.post('/api/eats' + path, data, key));
const delivery = { description: 'Sealed fictional delivery', weightKg: 2, recipientName: 'Fictional Recipient',
  pickupInstructions: 'PRIVATE-SENDER-COLLECTION-INSTRUCTIONS', dropoffInstructions: 'Reception desk' };

async function foodFixture(t, options = {}) {
  const h = await harness(t, options), people = await participants(h), seller = h.client(), outsider = h.client();
  await seller.register('kemmy-kitchen'); await outsider.register('kemmy-outsider');
  const collectionPoint = 'PRIVATE-KITCHEN-COLLECTION-ADDRESS';
  let { store } = await food(seller, '/stores', { details: { name: 'Kemmy Kitchen', cuisine: 'Nigerian',
    description: 'Fictional notification test kitchen.', sellerType: 'home_kitchen', address: collectionPoint,
    dispatchPoint: { lat: 9.08, lng: 7.4 }, areaId: 'wuse-ii', deliveryAreaIds: ['maitama'],
    prepMinutes: 20, minimumKobo: 0, deliveryFeeKobo: 100000 } });
  let menu;
  ({ store, menu } = await food(seller, `/stores/${store.id}/menu`, { expectedVersion: store.version, itemId: null,
    item: { name: 'Jollof rice', description: 'Rice and tomato.', category: 'Meals', priceKobo: 250000,
      available: true, portionsRemaining: 20 } }));
  ({ store } = await food(people.admin, `/stores/${store.id}/review`, { expectedVersion: store.version,
    decision: 'approved', reason: 'Fictional kitchen reviewed for tests.', reference: 'KEMMY-TEST' }));
  ({ store } = await food(seller, `/stores/${store.id}/open`, { expectedVersion: store.version, isOpen: true }));
  const quote = (await food(people.customer, '/quotes', { storeId: store.id, expectedVersion: store.version,
    items: [{ itemId: menu[0].id, quantity: 1 }], address: { line: '25 Fictional Recipient Close', areaId: 'maitama',
      point: { lat: 9.099123, lng: 7.493456 } }, recipient: { kind: 'other', name: 'Gift Recipient', phone: '+2348012345678' }, instructions: '' })).quote;
  let { order } = await food(people.customer, '/orders', { quoteId: quote.id });
  for (const action of ['accept', 'prepare', 'ready']) ({ order } = await food(seller, `/orders/${order.id}/${action}`,
    { expectedVersion: order.version, ...(action === 'ready' ? { collectionPoint } : {}) }));
  const pickupPin = order.pickupPin;
  ({ order } = await food(people.driver, `/orders/${order.id}/claim`, { expectedVersion: order.version }));
  return { h, ...people, seller, outsider, order, pickupPin, collectionPoint };
}

async function parcelFixture(t, options = {}) {
  const h = await harness(t, options), people = await participants(h), recipient = h.client(), outsider = h.client();
  await recipient.register('kemmy-parcel-recipient'); await outsider.register('kemmy-parcel-outsider');
  let ride = ok(await people.customer.post('/api/rides', { pickupId: 'wuse-ii', destinationId: 'maitama',
    vehicleCategory: 'standard', delivery }), 201).ride;
  const step = async (actor, action, extra = {}, key) => {
    ride = ok(await actor.post(`/api/rides/${ride.id}/${action}`, { expectedVersion: ride.version, ...extra }, key)).ride;
    return ride;
  };
  await step(people.driver, 'claim');
  await step(people.driver, 'offers', { amountKobo: ride.suggestedFareKobo + 10000 });
  await step(people.customer, 'accept', { offerId: ride.negotiation.currentOffer.id });
  await step(people.customer, 'confirm');
  const pickupPin = ride.trip.pickupPin;
  const link = ok(await people.customer.post(`/api/parcels/${ride.id}/link`, { expectedLinkId: null }));
  ok(await recipient.post('/api/parcels/accept', { token: link.token }));
  await people.driver.shareTripLocation(ride.id);
  await step(people.driver, 'depart'); await step(people.driver, 'arrive');
  return { h, ...people, recipient, outsider, get ride() { return ride; }, step, pickupPin };
}

function assertPrivateNotices(updates, forbiddenValues = []) {
  const forbiddenKeys = new Set(['pickup', 'pickupPin', 'deliveryPin', 'dropoffPin', 'pickupInstructions', 'customerId',
    'driverId', 'email', 'phone', 'location', 'position', 'lat', 'lng', 'token', 'sessionToken', 'collectionPoint']);
  const visit = value => {
    if (!value || typeof value !== 'object') return;
    for (const [key, child] of Object.entries(value)) {
      assert.equal(forbiddenKeys.has(key), false, `Delivery update leaked ${key}`); visit(child);
    }
  };
  visit(updates);
  const json = JSON.stringify(updates);
  for (const value of forbiddenValues.filter(Boolean)) {
    const encoded = /^\d{6}$/.test(value) ? JSON.stringify(value) : value;
    assert.equal(json.includes(encoded), false, `Delivery update leaked ${value}`);
  }
  for (const update of updates) {
    assert.match(update.id, /^[a-f0-9-]{36}$/);
    assert.equal(typeof update.title, 'string'); assert.equal(typeof update.body, 'string');
    assert.ok(update.etaMinutes === null || Number.isInteger(update.etaMinutes) && update.etaMinutes >= 1 && update.etaMinutes <= 2880);
  }
}

async function native(h, actor) {
  const credentials = ok(await h.client().send('/api/mobile/v1/auth/login', { method: 'POST',
    data: { email: actor.user.email, password: PASSWORD, deviceName: 'Kemmy update test phone' },
    headers: { Origin: null, Cookie: null, 'X-CSRF-Token': null } })).credentials;
  return (path, data, headers = {}) => h.client().send('/api/mobile/v1/delivery-updates' + path, {
    ...(data === undefined ? {} : { method: 'POST', data }),
    headers: { Origin: null, Cookie: null, 'X-CSRF-Token': null, Authorization: `Bearer ${credentials.accessToken}`,
      'Idempotency-Key': randomUUID(), ...headers },
  });
}

test('Kemmy food updates follow verified pickup, arrival and delivery once, and exclude private kitchen and recipient data', async t => {
  const f = await foodFixture(t, { persistent: true }); let order = f.order;
  assert.deepEqual((await inbox(f.customer)).updates, []);
  assert.equal((await f.h.client().send('/api/delivery-updates')).status, 401);
  assert.equal((await f.driver.post(`/api/eats/orders/${order.id}/pickup`,
    { expectedVersion: order.version, pin: f.pickupPin })).body.error.code, 'LOCATION_REQUIRED');
  assert.deepEqual((await inbox(f.customer)).updates, []);
  await f.driver.shareFoodLocation(order.id);
  const badPin = f.pickupPin === '000000' ? '111111' : '000000';
  assert.equal((await f.driver.post(`/api/eats/orders/${order.id}/pickup`,
    { expectedVersion: order.version, pin: badPin })).body.error.code, 'INVALID_PIN');
  assert.deepEqual((await inbox(f.customer)).updates, []);
  order = (await food(f.driver, `/orders/${order.id}`)).order;
  const pickupKey = randomUUID(), pickup = { expectedVersion: order.version, pin: f.pickupPin };
  ({ order } = await food(f.driver, `/orders/${order.id}/pickup`, pickup, pickupKey));
  assert.equal((await food(f.driver, `/orders/${order.id}/pickup`, pickup, pickupKey)).replayed, true);
  let list = await inbox(f.customer);
  assert.equal(list.updates.length, 1); assert.equal(list.unread, 1);
  assert.equal(list.updates[0].phase, 'picked_up'); assert.equal(list.updates[0].kind, 'food');
  assert.equal(list.updates[0].targetId, order.id); assert.match(list.updates[0].body, /picked up/i);
  const first = list.updates[0];
  assert.equal(ok(await f.customer.send(`/api/delivery-updates/food/${order.id}`)).update.id, first.id);
  for (const actor of [f.seller, f.driver, f.outsider]) {
    assert.deepEqual((await inbox(actor)).updates, []);
    assert.equal((await actor.post(`/api/delivery-updates/${first.id}/open`, {})).status, 404);
    assert.equal((await actor.send(`/api/delivery-updates/food/${order.id}`)).status, 404);
  }
  f.h.advance(30001);
  assert.equal((await f.driver.post(`/api/eats/orders/${order.id}/arrive`, { expectedVersion: order.version })).body.error.code, 'LOCATION_REQUIRED');
  assert.equal((await inbox(f.customer)).updates.length, 1);
  await f.driver.shareFoodLocation(order.id, { lat: 9.099123, lng: 7.493456 });
  const arrivalKey = randomUUID(), arrival = { expectedVersion: order.version };
  ({ order } = await food(f.driver, `/orders/${order.id}/arrive`, arrival, arrivalKey));
  assert.equal((await food(f.driver, `/orders/${order.id}/arrive`, arrival, arrivalKey)).replayed, true);
  list = await inbox(f.customer); assert.equal(list.updates.length, 2);
  assert.ok(list.updates.some(update => update.phase === 'arrived' && /arrived/i.test(update.body)));
  const pin = (await food(f.customer, `/orders/${order.id}`)).order.deliveryPin;
  assert.equal((await f.driver.post(`/api/eats/orders/${order.id}/deliver`,
    { expectedVersion: order.version, pin: pin === '000000' ? '111111' : '000000' })).body.error.code, 'INVALID_PIN');
  assert.equal((await inbox(f.customer)).updates.length, 2);
  order = (await food(f.driver, `/orders/${order.id}`)).order;
  const finishKey = randomUUID(), finish = { expectedVersion: order.version, pin };
  ({ order } = await food(f.driver, `/orders/${order.id}/deliver`, finish, finishKey));
  assert.equal((await food(f.driver, `/orders/${order.id}/deliver`, finish, finishKey)).replayed, true);
  assert.equal(order.status, 'delivered');
  list = await inbox(f.customer);
  assert.deepEqual(list.updates.map(update => update.phase).sort(), ['arrived', 'delivered', 'picked_up']);
  assertPrivateNotices(list.updates, [f.collectionPoint, '+2348012345678', 'Gift Recipient', f.customer.user.email,
    f.driver.user.email, f.pickupPin, pin]);
  await f.h.restart();
  assert.deepEqual((await inbox(f.customer)).updates.map(update => update.id), list.updates.map(update => update.id));
});

test('Kemmy food inbox is shared across authenticated web and native sessions, with authorized read marking only', async t => {
  const f = await foodFixture(t);
  await f.driver.shareFoodLocation(f.order.id);
  await food(f.driver, `/orders/${f.order.id}/pickup`, { expectedVersion: f.order.version, pin: f.pickupPin });
  const notice = (await inbox(f.customer)).updates[0], phone = await native(f.h, f.customer), stranger = await native(f.h, f.outsider);
  assert.deepEqual(ok(await phone('')).updates, (await inbox(f.customer)).updates);
  assert.equal(ok(await phone(`/food/${f.order.id}`)).update.id, notice.id);
  assert.deepEqual(ok(await stranger('')).updates, []);
  assert.equal((await stranger(`/${notice.id}/open`, {})).status, 404);
  assert.equal((await phone('', undefined, { Origin: f.h.base })).status, 403);
  assert.equal((await f.customer.send(`/api/delivery-updates/${notice.id}/open`, { method: 'POST', data: {},
    headers: { 'X-CSRF-Token': 'wrong', 'Idempotency-Key': randomUUID() } })).status, 403);
  assert.equal((await inbox(f.customer)).unread, 1);
  assert.deepEqual(ok(await phone(`/${notice.id}/open`, {})).target, { screen: 'food-order', id: f.order.id });
  const after = await inbox(f.customer);
  assert.equal(after.unread, 0); assert.equal(after.updates[0].readAt, f.h.now);
  assert.deepEqual(ok(await f.customer.post(`/api/delivery-updates/${notice.id}/open`, {})).target, { screen: 'food-order', id: f.order.id });
  assert.equal((await inbox(f.customer)).updates.length, 1);
});

test('Kemmy pickup estimate uses the courier GPS and saved recipient map point without exposing either location', async t => {
  const routes = [], mapProvider = { mode: 'community',
    describe: () => ({ enabled: true, mode: 'community', tiles: null }),
    route: async (from, to) => {
      routes.push({ from, to });
      return { source: 'osrm', distanceKind: 'road', distanceMeters: 12000, durationSeconds: 1234,
        coordinates: [[from.lng, from.lat], [to.lng, to.lat]] };
    } };
  const f = await foodFixture(t, { mapProvider });
  await f.driver.shareFoodLocation(f.order.id);
  await food(f.driver, `/orders/${f.order.id}/pickup`, { expectedVersion: f.order.version, pin: f.pickupPin });
  const worker = createApplication({ db: f.h.db, clock: () => f.h.now, mapProvider });
  await worker.deliveryUpdates.deliverPending();
  await worker.deliveryUpdates.stop();
  const notice = ok(await f.customer.send(`/api/delivery-updates/food/${f.order.id}`)).update;
  assert.equal(notice.etaMinutes, 21); assert.match(notice.body, /approximately 21 minutes/);
  assert.match(notice.note, /traffic|delays/i);
  assert.deepEqual(routes, [{ from: { lat: 9.08, lng: 7.4 }, to: { lat: 9.099123, lng: 7.493456 } }]);
  assertPrivateNotices([notice], [f.collectionPoint, '9.099123', '7.493456', '9.08', '7.4']);
});

test('Kemmy notice persistence failure rolls back food pickup and permits the same command to recover exactly once', async t => {
  const f = await foodFixture(t);
  await f.driver.shareFoodLocation(f.order.id);
  f.h.db.exec("CREATE TRIGGER reject_kemmy_notice BEFORE INSERT ON delivery_updates BEGIN SELECT RAISE(ABORT, 'notification fixture failure'); END");
  const key = randomUUID(), command = { expectedVersion: f.order.version, pin: f.pickupPin };
  try {
    const failure = await f.driver.post(`/api/eats/orders/${f.order.id}/pickup`, command, key);
    assert.equal(failure.status, 500);
    const order = (await food(f.driver, `/orders/${f.order.id}`)).order;
    assert.equal(order.status, 'assigned'); assert.equal(order.version, f.order.version);
    assert.deepEqual((await inbox(f.customer)).updates, []);
  } finally { f.h.db.exec('DROP TRIGGER reject_kemmy_notice'); }
  const success = await food(f.driver, `/orders/${f.order.id}/pickup`, command, key);
  assert.equal(success.order.status, 'picked_up'); assert.equal(success.replayed, false);
  assert.equal((await food(f.driver, `/orders/${f.order.id}/pickup`, command, key)).replayed, true);
  assert.equal((await inbox(f.customer)).updates.length, 1);
});

test('sanitized snapshots preserve Kemmy notices but remove temporary ETA coordinates and queued device tokens without changing the source', async t => {
  const f = await foodFixture(t, { persistent: true });
  await f.driver.shareFoodLocation(f.order.id, { lat: 9.081234, lng: 7.401234 });
  // Freeze automatic delivery workers before creating the pending snapshot
  // fixture; all remaining setup uses the application service directly.
  f.h.beginShutdown();
  const projectId = '00000000-0000-4000-8000-000000000001', token = 'ExpoPushToken[kemmy_snapshot_fixture_no_real_destination]';
  const pushProvider = { enabled: true, projectId, send: async () => ({ status: 'ok' }) };
  const app = createApplication({ db: f.h.db, clock: () => f.h.now, pushProvider });
  const { credentials } = await app.devices.issue(f.customer.user.id, 'Kemmy snapshot test phone');
  await app.notifications.register(f.customer.user.id, credentials.sessionId, { token, projectId });
  await app.eats.command(f.driver.user, 'pickup', f.order.id,
    { expectedVersion: f.order.version, pin: f.pickupPin }, randomUUID());
  f.h.db.prepare('UPDATE delivery_updates SET eta_next_at=?,eta_lease_until=? WHERE target_id=?')
    .run(f.h.now + 60000, f.h.now + 60000, f.order.id);
  const sourceNotice = f.h.db.prepare('SELECT * FROM delivery_updates WHERE target_id=?').get(f.order.id);
  const sourceJob = f.h.db.prepare('SELECT * FROM delivery_update_push_jobs WHERE update_id=?').get(sourceNotice.id);
  const sourceDevice = f.h.db.prepare('SELECT * FROM device_sessions WHERE id=?').get(credentials.sessionId);
  assert.equal(sourceNotice.eta_state, 'pending');
  assert.deepEqual(JSON.parse(sourceNotice.route_json), { from: { lat: 9.081234, lng: 7.401234 },
    to: { lat: 9.099123, lng: 7.493456 } });
  assert.equal(sourceJob.status, 'queued'); assert.equal(sourceJob.token, token);
  const destination = join(dirname(f.h.filename), 'kemmy-snapshot.sqlite');
  saveSnapshot(f.h.filename, destination, { now: f.h.now });
  const copy = new DatabaseSync(destination, { readOnly: true });
  try {
    assert.deepEqual({ ...copy.prepare('SELECT * FROM delivery_updates WHERE id=?').get(sourceNotice.id) },
      { ...sourceNotice, route_json: null, eta_state: 'done', eta_lease_until: 0 });
    assert.equal(copy.prepare('SELECT count(*) AS n FROM delivery_update_push_jobs').get().n, 0);
    assert.equal(copy.prepare('SELECT count(*) AS n FROM device_sessions').get().n, 0);
    assert.deepEqual(copy.prepare('PRAGMA foreign_key_check').all(), []);
  } finally { copy.close(); }
  const bytes = readFileSync(destination);
  assert.equal(bytes.includes(Buffer.from(token)), false);
  assert.equal(bytes.includes(Buffer.from('9.081234')), false, 'Transient courier latitude must not remain in unused snapshot pages.');
  assert.equal(bytes.includes(Buffer.from('7.401234')), false, 'Transient courier longitude must not remain in unused snapshot pages.');
  assert.deepEqual(f.h.db.prepare('SELECT * FROM delivery_updates WHERE id=?').get(sourceNotice.id), sourceNotice);
  assert.deepEqual(f.h.db.prepare('SELECT * FROM delivery_update_push_jobs WHERE id=?').get(sourceJob.id), sourceJob);
  assert.deepEqual(f.h.db.prepare('SELECT * FROM device_sessions WHERE id=?').get(credentials.sessionId), sourceDevice);
});

test('Kemmy parcel updates reach sender and accepted recipient, distinguish drop-off arrival, and disappear after grant revocation', async t => {
  const f = await parcelFixture(t);
  for (const actor of [f.customer, f.recipient, f.outsider, f.driver]) assert.deepEqual((await inbox(actor)).updates, []);
  const startKey = randomUUID(), start = { expectedVersion: f.ride.version, pickupPin: f.pickupPin };
  await f.step(f.driver, 'start', { pickupPin: f.pickupPin }, startKey);
  assert.equal(ok(await f.driver.post(`/api/rides/${f.ride.id}/start`, start, startKey)).replayed, true);
  const sender = (await inbox(f.customer)).updates, receiver = (await inbox(f.recipient)).updates;
  assert.equal(sender.length, 1); assert.equal(receiver.length, 1);
  for (const updates of [sender, receiver]) {
    assert.equal(updates[0].phase, 'picked_up'); assert.equal(updates[0].kind, 'parcel');
    assert.equal(updates[0].targetId, f.ride.id);
    assertPrivateNotices(updates, [f.customer.user.email, f.customer.user.id, f.driver.user.email,
      f.pickupPin, delivery.pickupInstructions, f.ride.pickup.name]);
  }
  assert.notEqual(sender[0].id, receiver[0].id);
  assert.deepEqual(ok(await f.customer.post(`/api/delivery-updates/${sender[0].id}/open`, {})).target,
    { screen: 'journey', id: f.ride.id });
  assert.deepEqual(ok(await f.recipient.post(`/api/delivery-updates/${receiver[0].id}/open`, {})).target,
    { screen: 'parcels', id: f.ride.id });
  assert.equal((await f.customer.post(`/api/delivery-updates/${receiver[0].id}/open`, {})).status, 404);
  const recipientPhone = await native(f.h, f.recipient);
  assert.equal(ok(await recipientPhone(`/parcel/${f.ride.id}`)).update.id, receiver[0].id);
  f.h.advance(30001);
  assert.equal((await f.driver.post(`/api/rides/${f.ride.id}/delivery_arrive`, { expectedVersion: f.ride.version })).body.error.code, 'TRIP_LOCATION_REQUIRED');
  assert.equal((await inbox(f.recipient)).updates.length, 1);
  await f.driver.shareTripLocation(f.ride.id);
  const arriveKey = randomUUID(), arrive = { expectedVersion: f.ride.version };
  await f.step(f.driver, 'delivery_arrive', {}, arriveKey);
  assert.equal(f.ride.status, 'in_progress', 'Drop-off arrival must not confirm handover.');
  assert.equal(ok(await f.driver.post(`/api/rides/${f.ride.id}/delivery_arrive`, arrive, arriveKey)).replayed, true);
  assert.deepEqual((await inbox(f.recipient)).updates.map(update => update.phase).sort(), ['arrived', 'picked_up']);
  const current = ok(await f.customer.send(`/api/parcels/${f.ride.id}/invitation`)).invitation.link;
  ok(await f.customer.post(`/api/parcels/${f.ride.id}/revoke`, { linkId: current.id, expectedVersion: current.version }));
  assert.deepEqual((await inbox(f.recipient)).updates, []);
  assert.equal((await inbox(f.recipient)).unread, 0);
  assert.deepEqual(ok(await recipientPhone('')).updates, []);
  assert.equal((await f.recipient.post(`/api/delivery-updates/${receiver[0].id}/open`, {})).status, 404);
  assert.equal((await recipientPhone(`/parcel/${f.ride.id}`)).status, 404);
  const pin = ok(await f.customer.send(`/api/rides/${f.ride.id}`)).ride.delivery.dropoffPin;
  await f.step(f.driver, 'complete', { deliveryPin: pin });
  assert.equal(f.ride.status, 'completed');
  assert.deepEqual((await inbox(f.customer)).updates.map(update => update.phase).sort(), ['arrived', 'delivered', 'picked_up']);
  assert.deepEqual((await inbox(f.recipient)).updates, []);
  assert.deepEqual((await inbox(f.outsider)).updates, []);
});
