import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createRidesService } from '../src/modules/rides/service.mjs';
import { harness, participants, claimRide, PASSWORD } from './helpers.mjs';
import { parseJourney } from '../../../packages/shared/src/mobile-journeys.mjs';

const ok = (response, status = 200) => {
  assert.equal(response.status, status, JSON.stringify(response.body)); return response.body;
};
const progress = (actor, ride, action, extra = {}, key) => actor.post(`/api/rides/${ride.id}/${action}`,
  { expectedVersion: ride.version, ...extra }, key);
const step = async (...args) => ok(await progress(...args)).ride;
async function booked(t, delivery = false) {
  const h = await harness(t), actors = await participants(h);
  let ride = ok(await actors.customer.post('/api/rides', {
    pickupId: 'wuse-ii', destinationId: 'maitama',
    ...(delivery ? { vehicleCategory: 'standard', delivery: {
      description: 'Sealed test parcel', weightKg: 2, recipientName: 'Test recipient',
    } } : {}),
  }), 201).ride;
  ride = await claimRide(actors.driver, ride);
  ride = await step(actors.driver, ride, 'offers', { amountKobo: 470000 });
  ride = await step(actors.customer, ride, 'accept', { offerId: ride.negotiation.currentOffer.id });
  ride = await step(actors.customer, ride, 'confirm');
  assert.equal(ride.status, 'booked');
  assert.equal(h.db.prepare('SELECT count(*) AS n FROM location_shares').get().n, 0,
    'Claiming, agreeing and confirming never create location consent');
  return { h, ...actors, ride };
}
function sharing(h, driver, rideId) {
  const headers = { 'X-Location-Client': randomUUID() };
  let share;
  const send = (path, data = {}) => driver.send(path, { method: 'POST', data,
    headers: { ...headers, 'Idempotency-Key': randomUUID() } });
  return {
    async start() { share = ok(await send(`/api/rides/${rideId}/location/start`)).share; },
    async fix() { share = ok(await send(`/api/location-shares/${share.id}/position`, {
      sequence: share.sequence + 1, lat: 9.08, lng: 7.4, accuracy: 12, capturedAt: h.now,
    })).share; },
    async stop() { ok(await send(`/api/location-shares/${share.id}/stop`)); },
  };
}
function required(response) {
  assert.equal(response.status, 409, JSON.stringify(response.body));
  assert.equal(response.body.error.code, 'TRIP_LOCATION_REQUIRED');
}

for (const delivery of [false, true]) test(`${delivery ? 'parcel' : 'ride'} progress requires fresh shared GPS, while replay and completion survive GPS loss`, async t => {
  const f = await booked(t, delivery), { h, customer, driver } = f;
  let ride = f.ride;
  const pickupPin = ride.trip.pickupPin, tracker = sharing(h, driver, ride.id), departureKey = randomUUID();
  required(await progress(driver, ride, 'depart', {}, departureKey));
  assert.equal(h.db.prepare('SELECT count(*) AS n FROM idempotency WHERE key=?').get(departureKey).n, 0);
  await tracker.start();
  required(await progress(driver, ride, 'depart', {}, departureKey));
  await tracker.fix();
  const before = ride;
  ride = await step(driver, ride, 'depart', {}, departureKey);
  h.advance(30_000);
  required(await progress(driver, ride, 'arrive'));
  assert.equal(ok(await customer.send(`/api/rides/${ride.id}`)).ride.version, ride.version);
  assert.equal(ok(await progress(driver, before, 'depart', {}, departureKey)).replayed, true);
  await tracker.fix();
  ride = await step(driver, ride, 'arrive');
  await tracker.stop();
  required(await progress(driver, ride, 'start', { pickupPin: pickupPin === '000000' ? '000001' : '000000' }));
  assert.equal(h.db.prepare('SELECT pin_failures FROM ride_trips WHERE ride_id=?').get(ride.id).pin_failures, 0,
    'A missing location must not consume a pickup PIN attempt');
  await tracker.start(); await tracker.fix();
  ride = await step(driver, ride, 'start', { pickupPin });
  const deliveryPin = delivery ? ok(await customer.send(`/api/rides/${ride.id}`)).ride.delivery.dropoffPin : undefined;
  h.advance(60_001);
  ride = await step(driver, ride, 'complete', delivery ? { deliveryPin } : {});
  assert.equal(ride.status, 'completed');
  assert.equal(ok(await customer.send(`/api/rides/${ride.id}/location`)).share, null);
});

test('stopped tracking does not block either participant from cancelling a pre-pickup trip', async t => {
  for (const cancelBy of ['customer', 'driver']) {
    const f = await booked(t), tracker = sharing(f.h, f.driver, f.ride.id);
    await tracker.start(); await tracker.fix();
    const ride = await step(f.driver, f.ride, 'depart');
    await tracker.stop();
    required(await progress(f.driver, ride, 'arrive'));
    assert.equal((await step(f[cancelBy], ride, 'cancel')).status, 'cancelled');
  }
});

test('fresh coordinates from a revoked browser sharing session cannot unlock progress after signing in again', async t => {
  const { h, customer, driver, ride } = await booked(t), tracker = sharing(h, driver, ride.id);
  await tracker.start(); await tracker.fix();
  const email = driver.user.email;
  ok(await driver.post('/api/auth/logout'));
  ok(await driver.post('/api/auth/login', { email, password: PASSWORD }));
  required(await progress(driver, ride, 'depart'));
  assert.equal(ok(await customer.send(`/api/rides/${ride.id}`)).ride.status, 'booked');
  await driver.shareTripLocation(ride.id);
  assert.equal((await step(driver, ride, 'depart')).status, 'on_way');
});

test('native journey progress uses the same GPS gate and revoked device locations cannot unlock browser progress', async t => {
  const { h, driver, ride: bookedRide } = await booked(t), clientId = randomUUID();
  let token, ride = bookedRide;
  const native = async (path, data) => {
    const response = await fetch(`${h.base}/api/mobile/v1${path}`, { method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Idempotency-Key': randomUUID(),
        ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(data) });
    return { status: response.status, body: await response.json() };
  };
  const { credentials } = ok(await native('/auth/login', {
    email: driver.user.email, password: PASSWORD, deviceName: 'Required location fixture',
  }));
  token = credentials.accessToken;
  required(await native(`/journeys/${ride.id}/depart`, { expectedVersion: ride.version }));
  const { share } = ok(await native(`/tracking/rides/${ride.id}/start?clientId=${clientId}`, {}));
  required(await native(`/journeys/${ride.id}/depart`, { expectedVersion: ride.version }));
  ok(await native(`/tracking/shares/${share.id}/position?clientId=${clientId}`,
    { sequence: 1, lat: 9.08, lng: 7.4, accuracy: 10, capturedAt: h.now }));
  ride = ok(await native(`/journeys/${ride.id}/depart`, { expectedVersion: ride.version })).ride;
  assert.equal(ride.status, 'on_way');
  ok(await driver.post(`/api/account/devices/${credentials.sessionId}/revoke`, {}));
  required(await progress(driver, ride, 'arrive'));
  await driver.shareTripLocation(ride.id);
  assert.equal((await step(driver, ride, 'arrive')).status, 'arrived');
});

test('ride service fails closed when its required tracking port is omitted', async () => {
  const ride = { id: randomUUID(), customerId: 'customer', driverId: 'driver', status: 'agreed', version: 3 };
  const service = createRidesService({
    repository: { find: () => ride, findTrip: () => ({ status: 'booked' }), findCommand: () => null },
    getAccount: () => ({ id: 'driver', role: 'driver', capabilities: ['customer', 'driver'], driver: { status: 'approved' } }),
    unitOfWork: action => action(), tokens: { digest: value => value }, clock: () => 1000,
  });
  await assert.rejects(service.mutate({ userId: 'driver', id: ride.id, action: 'depart', key: randomUUID(),
    data: { expectedVersion: ride.version } }), { code: 'TRIP_LOCATION_REQUIRED' });
});

test('parcel destination arrival requires fresh shared GPS and assigned driver, replays once, and keeps PIN handover separate', async t => {
  const { h, customer, driver, ride: bookedRide } = await booked(t, true);
  const outsider = h.client(); await outsider.register('arrival-outsider', 'driver');
  let ride = bookedRide;
  assert.equal(ride.delivery.arrivedAt, null);
  assert.equal((await progress(driver, ride, 'delivery_arrive')).body.error.code, 'INVALID_TRIP_STATE');
  const pickupPin = ride.trip.pickupPin;
  await driver.shareTripLocation(ride.id);
  ride = await step(driver, ride, 'depart'); ride = await step(driver, ride, 'arrive');
  const pickupArrivedAt = ride.trip.arrivedAt;
  ride = await step(driver, ride, 'start', { pickupPin });
  const deliveryPin = ok(await customer.send(`/api/rides/${ride.id}`)).ride.delivery.dropoffPin;
  assert.equal((await progress(customer, ride, 'delivery_arrive')).status, 403);
  assert.equal((await progress(outsider, ride, 'delivery_arrive')).status, 404);
  h.advance(30_001);
  const key = randomUUID(), before = ride;
  required(await progress(driver, ride, 'delivery_arrive', {}, key));
  assert.equal(h.db.prepare('SELECT arrived_at FROM delivery_orders WHERE ride_id=?').get(ride.id).arrived_at, null);
  assert.equal(h.db.prepare('SELECT count(*) AS n FROM idempotency WHERE key=?').get(key).n, 0);
  await driver.shareTripLocation(ride.id);
  ride = await step(driver, ride, 'delivery_arrive', {}, key);
  const arrivedAt = h.now;
  assert.equal(ride.version, before.version + 1);
  assert.equal(ride.status, 'in_progress'); assert.equal(ride.trip.completedAt, null);
  assert.equal(ride.delivery.arrivedAt, arrivedAt); assert.equal(ride.trip.arrivedAt, pickupArrivedAt);
  assert.equal(ride.delivery.dropoffPin, undefined);
  assert.equal(ok(await customer.send(`/api/rides/${ride.id}`)).ride.delivery.dropoffPin, deliveryPin);
  assert.equal(h.db.prepare('SELECT count(*) AS n FROM payments WHERE ride_id=?').get(ride.id).n, 0);
  assert.equal((await progress(driver, ride, 'delivery_arrive')).body.error.code, 'INVALID_TRIP_STATE');
  h.advance(60_001);
  const replay = ok(await progress(driver, before, 'delivery_arrive', {}, key));
  assert.equal(replay.replayed, true); assert.equal(replay.ride.delivery.arrivedAt, arrivedAt);
  assert.equal(h.db.prepare("SELECT count(*) AS n FROM audit_events WHERE subject_id=? AND kind='delivery.arrived'").get(ride.id).n, 1);
  assert.equal((await progress(driver, ride, 'complete', { deliveryPin: deliveryPin === '000000' ? '111111' : '000000' })).body.error.code, 'INVALID_DELIVERY_PIN');
  ride = await step(driver, ride, 'complete', { deliveryPin });
  assert.equal(ride.status, 'completed'); assert.equal(ride.delivery.arrivedAt, arrivedAt);
});

test('recipient arrival cannot be applied to a passenger ride or create parcel state', async t => {
  const { h, driver, ride: bookedRide } = await booked(t);
  const pickupPin = bookedRide.trip.pickupPin;
  await driver.shareTripLocation(bookedRide.id);
  let ride = await step(driver, bookedRide, 'depart'); ride = await step(driver, ride, 'arrive');
  ride = await step(driver, ride, 'start', { pickupPin });
  assert.equal((await progress(driver, ride, 'delivery_arrive')).body.error.code, 'INVALID_TRIP_STATE');
  assert.equal(ok(await driver.send(`/api/rides/${ride.id}`)).ride.version, ride.version);
  assert.equal(h.db.prepare('SELECT count(*) AS n FROM delivery_orders').get().n, 0);
  assert.equal(h.db.prepare("SELECT count(*) AS n FROM audit_events WHERE kind='delivery.arrived'").get().n, 0);
});

test('native parcel arrival action and timestamp match the browser lifecycle without exposing the recipient PIN', async t => {
  const { h, customer, driver, ride: bookedRide } = await booked(t, true);
  let token;
  const native = async (path, data, key = randomUUID()) => {
    const response = await fetch(`${h.base}/api/mobile/v1${path}`, { method: data === undefined ? 'GET' : 'POST',
      headers: { 'Content-Type': 'application/json', 'Idempotency-Key': key, ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      ...(data === undefined ? {} : { body: JSON.stringify(data) }) });
    return { status: response.status, body: await response.json() };
  };
  token = ok(await native('/auth/login', { email: driver.user.email, password: PASSWORD, deviceName: 'Parcel arrival fixture' })).credentials.accessToken;
  assert.equal(parseJourney(ok(await native(`/journeys/${bookedRide.id}`))).ride.allowedActions.includes('delivery_arrive'), false);
  const pickupPin = bookedRide.trip.pickupPin;
  await driver.shareTripLocation(bookedRide.id);
  let ride = await step(driver, bookedRide, 'depart'); ride = await step(driver, ride, 'arrive');
  ride = await step(driver, ride, 'start', { pickupPin });
  const projection = parseJourney(ok(await native(`/journeys/${ride.id}`))).ride;
  assert.equal(projection.delivery.arrivedAt, null);
  assert.equal(projection.allowedActions.includes('delivery_arrive'), true);
  assert.equal(projection.allowedActions.includes('complete'), true, 'Legacy PIN completion remains available.');
  const arrived = parseJourney(ok(await native(`/journeys/${ride.id}/delivery_arrive`, { expectedVersion: ride.version }))).ride;
  assert.equal(arrived.delivery.arrivedAt, h.now); assert.equal(arrived.delivery.dropoffPin, undefined);
  assert.equal(arrived.status, 'in_progress'); assert.equal(arrived.allowedActions.includes('delivery_arrive'), false);
  assert.equal(ok(await customer.send(`/api/rides/${ride.id}`)).ride.delivery.arrivedAt, arrived.delivery.arrivedAt);
});

test('recipient arrival timestamp, version and retry key roll back together when its audit write fails', async t => {
  const { h, driver, ride: bookedRide } = await booked(t, true);
  const pickupPin = bookedRide.trip.pickupPin;
  await driver.shareTripLocation(bookedRide.id);
  let ride = await step(driver, bookedRide, 'depart'); ride = await step(driver, ride, 'arrive');
  ride = await step(driver, ride, 'start', { pickupPin });
  const key = randomUUID();
  h.db.exec("CREATE TRIGGER fail_arrival BEFORE INSERT ON audit_events WHEN NEW.kind='delivery.arrived' BEGIN SELECT RAISE(ABORT,'test rollback'); END;");
  assert.equal((await progress(driver, ride, 'delivery_arrive', {}, key)).status, 500);
  assert.equal(h.db.prepare('SELECT arrived_at FROM delivery_orders WHERE ride_id=?').get(ride.id).arrived_at, null);
  assert.equal(ok(await driver.send(`/api/rides/${ride.id}`)).ride.version, ride.version);
  assert.equal(h.db.prepare('SELECT count(*) AS n FROM idempotency WHERE key=?').get(key).n, 0);
  h.db.exec('DROP TRIGGER fail_arrival');
  assert.equal((await step(driver, ride, 'delivery_arrive', {}, key)).delivery.arrivedAt, h.now);
});
