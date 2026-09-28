import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { TEST_NOW, harness, participants, requestRide, PASSWORD } from './helpers.mjs';
import { distanceMeters } from '../../../packages/shared/src/locations.mjs';

const pickup = { lat: 9.081234, lng: 7.401234, name: 'Private test pickup' };
const destination = { lat: 9.1, lng: 7.45, name: 'Private test destination' };
const mapProvider = { mode: 'off', describe: () => ({ enabled: false }),
  route: async (a, b) => ({ distanceMeters: 7000, durationSeconds: 1200, coordinates: [[a.lng, a.lat], [b.lng, b.lat]] }) };
const gps = (now = TEST_NOW, extra = {}) => ({ lat: pickup.lat, lng: pickup.lng, accuracy: 10, capturedAt: now, ...extra });
async function setup(t, options = {}, count = 1) {
  const h = await harness(t, { mapProvider, ...options });
  return { h, ...await participants(h, count, { online: false }) };
}
async function routed(customer, point = pickup) {
  const result = await customer.post('/api/locations/quotes', { pickup: point, destination }); assert.equal(result.status, 201);
  const request = await customer.post('/api/rides', { quoteId: result.body.quote.id }); assert.equal(request.status, 201);
  return request.body.ride;
}
const list = async (driver) => (await driver.send('/api/rides')).body.available;
const claim = (driver, ride, key) => driver.post(`/api/rides/${ride.id}/claim`, { expectedVersion: ride.version }, key);

test('nationwide GPS eligibility keeps Lagos, Kano and Port Harcourt driver matching local, including after radius expansion', async (t) => {
  const provider = { ...mapProvider, route: async (a, b) => ({ distanceMeters: Math.ceil(distanceMeters(a, b) * 1.2), durationSeconds: 600,
    coordinates: [[a.lng, a.lat], [b.lng, b.lat]] }) };
  const { h, customer, drivers } = await setup(t, { mapProvider: provider }, 3);
  const cities = [{ lat: 6.5244, lng: 3.3792, name: 'Lagos' }, { lat: 12.0022, lng: 8.592, name: 'Kano' },
    { lat: 4.8156, lng: 7.0498, name: 'Port Harcourt' }];
  const requests = [];
  for (let i = 0; i < cities.length; i++) {
    const city = cities[i], rider = i === 0 ? customer : h.client();
    if (i !== 0) await rider.register(`national-customer-${i}`);
    const quoted = await rider.post('/api/locations/quotes', { pickup: city, destination: { ...city, lat: city.lat + 0.01, name: `${city.name} destination` } });
    assert.equal(quoted.status, 201, JSON.stringify(quoted.body));
    const created = await rider.post('/api/rides', { quoteId: quoted.body.quote.id });
    assert.equal(created.status, 201, JSON.stringify(created.body)); requests.push(created.body.ride);
    await drivers[i].online({ mode: 'gps', lat: city.lat, lng: city.lng });
  }
  for (let i = 0; i < drivers.length; i++) {
    assert.deepEqual((await list(drivers[i])).map((ride) => ride.id), [requests[i].id]);
    assert.equal((await claim(drivers[i], requests[(i + 1) % requests.length])).body.error.code, 'OUTSIDE_MATCH_AREA');
  }
  h.advance(60_000);
  for (let i = 0; i < drivers.length; i++) {
    await drivers[i].online({ mode: 'gps', lat: cities[i].lat, lng: cities[i].lng });
    assert.deepEqual((await list(drivers[i])).map((ride) => ride.id), [requests[i].id]);
  }
  const online = (await drivers[0].send('/api/availability')).body.availability;
  for (const point of [{ lat: 6.3703, lng: 2.3912 }, { lat: 10.591, lng: 14.3159 }]) {
    const result = await drivers[0].availability(`/api/availability/${online.id}/position`, { sequence: 2, position: gps(h.now, point) });
    assert.equal(result.status, 400); assert.equal(result.body.error.code, 'INVALID_LOCATION');
  }
  assert.deepEqual((await list(drivers[0])).map((ride) => ride.id), [requests[0].id], 'rejected foreign GPS cannot replace the last valid location');
});

test('ranked API requests balance waiting and distance while preserving private projections and explicit claiming', async (t) => {
  const { h, customer, driver } = await setup(t);
  const waiting = await routed(customer, { ...pickup, lat: 9.09 });
  h.advance(180_000);
  const newer = h.client(); await newer.register('new-ranking-customer');
  const near = await routed(newer, { ...pickup, lat: 9.0802 });
  await driver.online({ mode: 'gps', lat: 9.08, lng: pickup.lng });
  const available = await list(driver);
  assert.deepEqual(available.map((r) => r.id), [waiting.id, near.id]);
  assert.deepEqual(available.map((r) => r.recommendation.rank), [1, 2]);
  assert.equal(available[0].recommendation.policyVersion, 'proximity-wait-v1');
  assert.ok(available[0].recommendation.reasons.includes('waiting_longer'));
  for (const forbidden of ['distanceMeters', 'score', 'customerId', 'position', 'Private test pickup']) assert.ok(!JSON.stringify(available).includes(forbidden));
  assert.equal((await customer.send(`/api/rides/${waiting.id}`)).body.ride.status, 'requested');
  assert.equal((await claim(driver, near)).status, 200, 'driver can explicitly choose a lower ranked request');
  assert.deepEqual(await list(driver), [], 'a claimed driver cannot keep receiving work');
});

test('availability starts offline and requires approval, session, CSRF, window and explicit valid mode', async (t) => {
  const { h, customer, admin, driver } = await setup(t);
  const ride = await requestRide(customer);
  assert.equal((await driver.send('/api/availability')).body.availability, null);
  assert.deepEqual(await list(driver), []);
  assert.equal((await claim(driver, ride)).body.error.code, 'DRIVER_OFFLINE');
  for (const actor of [customer, admin]) assert.equal((await actor.availability('/api/availability/online', { mode: 'sample', areaId: 'wuse-ii' })).status, 403);
  assert.equal((await h.client().send('/api/availability')).status, 401);
  const pending = h.client(); await pending.register('pending', 'driver');
  assert.equal((await pending.availability('/api/availability/online', { mode: 'sample', areaId: 'wuse-ii' })).status, 403);
  const data = { mode: 'sample', areaId: 'wuse-ii' };
  assert.equal((await driver.post('/api/availability/online', data)).status, 400, 'window required');
  assert.equal((await driver.send('/api/availability/online', { method: 'POST', data,
    headers: { 'X-Availability-Client': randomUUID(), 'Idempotency-Key': randomUUID(), 'X-CSRF-Token': 'wrong' } })).status, 403);
  for (const value of [{ mode: 'other' }, { ...data, areaId: 'unknown' }, { ...data, driverId: customer.user.id }]) {
    assert.equal((await driver.availability('/api/availability/online', value)).status, 400);
  }
  const online = await driver.online(); assert.equal(online.online, true);
  assert.deepEqual((await list(driver)).map((row) => row.id), [ride.id]);
  assert.equal((await driver.availability('/api/availability/online', data)).body.error.code, 'AVAILABILITY_BUSY');
});

test('sample matching stays in the selected sample area and never stands in for GPS matching', async (t) => {
  const { h, customer, driver } = await setup(t);
  const sample = await requestRide(customer);
  await driver.online({ mode: 'sample', areaId: 'jabi' }); assert.deepEqual(await list(driver), []);
  assert.equal((await claim(driver, sample)).body.error.code, 'OUTSIDE_MATCH_AREA');
  await driver.online({ mode: 'sample', areaId: 'wuse-ii' }); assert.equal((await list(driver))[0].approximateDistanceKm, null);
  const other = h.client(); await other.register('routed-customer'); const route = await routed(other);
  assert.deepEqual((await list(driver)).map((row) => row.id), [sample.id]);
  assert.equal((await claim(driver, route)).body.error.code, 'OUTSIDE_MATCH_AREA');
  await driver.online({ mode: 'gps' });
  assert.deepEqual((await list(driver)).map((row) => row.id), [route.id]);
  assert.equal((await claim(driver, sample)).body.error.code, 'OUTSIDE_MATCH_AREA');
});

test('GPS matching expands from five to ten kilometres at one minute, with fresh eligibility checked on claim', async (t) => {
  const { h, customer, drivers } = await setup(t, {}, 3);
  const ride = await routed(customer);
  const [near, wider, outside] = drivers;
  const choices = [{ mode: 'gps', lat: 9.10 }, { mode: 'gps', lat: 9.14 }, { mode: 'gps', lat: 9.19 }];
  for (let i = 0; i < drivers.length; i++) await drivers[i].online(choices[i]);
  assert.equal((await list(near)).length, 1); assert.deepEqual(await list(wider), []); assert.deepEqual(await list(outside), []);
  assert.equal((await claim(wider, ride)).body.error.code, 'OUTSIDE_MATCH_AREA');
  h.advance(59999); await wider.online(choices[1]);
  assert.deepEqual(await list(wider), []);
  h.advance(1);
  const available = await list(wider); assert.equal(available.length, 1); assert.equal(available[0].approximateDistanceKm, 7);
  await outside.online(choices[2]); assert.deepEqual(await list(outside), []);
  const serialized = JSON.stringify(available);
  for (const value of ['Private test', String(pickup.lat), 'coordinates', 'customerId', 'position', '@example.test']) assert.ok(!serialized.includes(value), value);
  assert.equal((await wider.send(`/api/rides/${ride.id}`)).status, 404);
  const matched = await claim(wider, ride); assert.equal(matched.status, 200); assert.equal(matched.body.ride.negotiation.agreement, null);
  assert.equal((await wider.send('/api/availability')).body.availability, null);
  assert.equal(h.db.prepare('SELECT position_json FROM driver_availability WHERE driver_id = ? AND reason = ?').get(wider.user.id, 'claimed').position_json, null);
});

test('claim races and a failing retry write never double-match or partially consume availability', async (t) => {
  const { h, customer, drivers } = await setup(t, {}, 2);
  for (const driver of drivers) await driver.online();
  const ride = await requestRide(customer), key = randomUUID();
  const before = h.db.prepare('SELECT count(*) AS n FROM audit_events').get().n;
  h.db.exec("CREATE TRIGGER fail_claim BEFORE INSERT ON idempotency BEGIN SELECT RAISE(ABORT, 'claim fault'); END");
  assert.equal((await claim(drivers[0], ride, key)).status, 500);
  assert.equal((await drivers[0].send('/api/availability')).body.availability.online, true);
  assert.equal((await customer.send(`/api/rides/${ride.id}`)).body.ride.status, 'requested');
  assert.equal(h.db.prepare('SELECT count(*) AS n FROM audit_events').get().n, before);
  h.db.exec('DROP TRIGGER fail_claim');
  const results = await Promise.all(drivers.map((driver, i) => claim(driver, ride, i === 0 ? key : randomUUID())));
  assert.deepEqual(results.map((result) => result.status).sort(), [200, 409]);
  const winner = drivers[results.findIndex((result) => result.status === 200)];
  const other = drivers.find((driver) => driver !== winner);
  assert.equal(h.db.prepare('SELECT count(*) AS n FROM driver_availability WHERE active = 1').get().n, 1);
  assert.equal((await winner.availability('/api/availability/online', { mode: 'sample', areaId: 'wuse-ii' })).body.error.code, 'DRIVER_BUSY');
  assert.equal((await other.send(`/api/rides/${ride.id}/chat`)).status, 404);
  assert.equal((await other.send(`/api/rides/${ride.id}`)).status, 404);
});

test('availability binds updates to the initiating session/window; any window of that driver may stop it', async (t) => {
  const { h, driver, drivers } = await setup(t, {}, 2);
  const key = randomUUID(), data = { mode: 'gps', position: gps() };
  const start = await driver.availability('/api/availability/online', data, key); assert.equal(start.status, 200);
  const id = start.body.availability.id;
  assert.equal((await driver.availability('/api/availability/online', data, key)).body.replayed, true);
  const exposed = JSON.stringify(start.body);
  for (const text of ['position', 'sessionHash', 'clientHash', String(pickup.lat)]) assert.ok(!exposed.includes(text), text);
  const otherWindow = randomUUID();
  assert.equal((await driver.send(`/api/availability/${id}/position`, { method: 'POST', data: { sequence: 2, position: gps() },
    headers: { 'X-Availability-Client': otherWindow } })).body.error.code, 'AVAILABILITY_WINDOW');
  assert.equal((await drivers[1].availability(`/api/availability/${id}/offline`)).status, 404);
  const stop = await driver.send(`/api/availability/${id}/offline`, { method: 'POST', data: {},
    headers: { 'X-Availability-Client': otherWindow, 'Idempotency-Key': randomUUID() } });
  assert.equal(stop.status, 200); assert.equal(stop.body.availability.online, false);
  h.advance(30000);
  const replay = await driver.availability('/api/availability/online', data, key);
  assert.equal(replay.status, 200, 'an old completed command can be replayed even after its fix ages out');
  assert.equal(replay.body.availability.online, false, 'replay never reactivates a stopped lease');
  assert.equal((await driver.availability(`/api/availability/${id}/position`, { sequence: 2, position: gps((TEST_NOW + 30_000)) })).body.error.code, 'AVAILABILITY_CLOSED');
  const stored = h.db.prepare('SELECT * FROM driver_availability WHERE id = ?').get(id);
  for (const field of ['session_hash', 'client_hash', 'position_json', 'area_id']) assert.equal(stored[field], null);
});

test('GPS accuracy, bounds, clocks, monotonic fixes and retries cannot keep stale availability online', async (t) => {
  const { h, driver } = await setup(t);
  for (const extra of [{ lat: '9.08' }, { lat: 0 }, { accuracy: 201 }, { capturedAt: (TEST_NOW - 30_000) }, { capturedAt: (TEST_NOW + 5_001) }]) {
    assert.equal((await driver.availability('/api/availability/online', { mode: 'gps', position: gps(TEST_NOW, extra) })).status, 400);
  }
  const online = await driver.online({ mode: 'gps' }), path = `/api/availability/${online.id}/position`;
  h.advance(10000);
  const data = { sequence: 2, position: gps((TEST_NOW + 10_000)) };
  assert.equal((await driver.availability(path, data)).status, 200);
  assert.equal((await driver.availability(path, { ...data, position: gps((TEST_NOW + 10_000), { lng: 7.41 }) })).body.error.code, 'STALE_LOCATION');
  assert.equal((await driver.availability(path, { sequence: 3, position: gps((TEST_NOW + 9_999)) })).body.error.code, 'STALE_LOCATION');
  h.advance(10000);
  const retry = await driver.availability(path, data); assert.equal(retry.body.replayed, true);
  assert.equal(retry.body.availability.updatedAt, (TEST_NOW + 10_000), 'retry does not renew the lease');
  h.advance(20000);
  assert.equal((await driver.send('/api/availability')).body.availability, null, 'fix expires at the exact 30-second deadline');
  assert.equal(h.db.prepare('SELECT position_json FROM driver_availability WHERE id = ?').get(online.id).position_json, null);
});

test('logout, revoked approval and a missing heartbeat remove matching eligibility across restart', async (t) => {
  const { h, driver, customer } = await setup(t, { persistent: true });
  await requestRide(customer); const online = await driver.online();
  await h.restart(); assert.equal((await list(driver)).length, 1, 'only a still-live lease survives an immediate restart');
  h.advance(60000); assert.deepEqual(await list(driver), []);
  assert.equal((await driver.send('/api/availability')).body.availability, null);
  const email = driver.user.email; await driver.online(); await driver.post('/api/auth/logout');
  await driver.post('/api/auth/login', { email, password: PASSWORD });
  assert.deepEqual(await list(driver), []);
  assert.equal((await driver.send('/api/availability')).body.availability, null);
  await driver.online(); h.db.prepare("UPDATE drivers SET status = 'rejected' WHERE user_id = ?").run(driver.user.id);
  assert.deepEqual(await list(driver), []);
  assert.equal((await driver.send('/api/availability')).body.availability, null);
  assert.equal(h.db.prepare('SELECT count(*) AS n FROM driver_availability WHERE active = 1').get().n, 0);
  assert.equal((await driver.availability(`/api/availability/${online.id}/offline`)).status, 200, 'revoked drivers can still clear their own state');
});

test('unclaimed requests expire at five minutes, free the customer, and keep retry/history semantics across restart', async (t) => {
  const { h, customer, driver } = await setup(t, { persistent: true });
  const key = randomUUID(), data = { pickupId: 'wuse-ii', destinationId: 'maitama' };
  const ride = (await customer.post('/api/rides', data, key)).body.ride;
  assert.equal(ride.matching.expiresAt, TEST_NOW + 300_000);
  h.advance(299999); await driver.online(); assert.equal((await list(driver)).length, 1);
  await h.restart(); h.advance(1);
  assert.equal((await claim(driver, ride)).body.error.code, 'REQUEST_UNAVAILABLE');
  const expired = (await customer.send(`/api/rides/${ride.id}`)).body.ride;
  assert.equal(expired.status, 'expired'); assert.equal(expired.negotiation, null); assert.equal(expired.version, 1);
  assert.equal((await customer.post('/api/rides', data, key)).body.ride.status, 'expired');
  assert.equal((await customer.send('/api/rides/history')).body.rides[0].id, ride.id);
  assert.equal(h.db.prepare("SELECT count(*) AS n FROM audit_events WHERE kind = 'ride.request_expired'").get().n, 1);
  assert.equal(h.db.prepare('SELECT count(*) AS n FROM fare_events').get().n, 0);
  const next = await requestRide(customer); assert.notEqual(next.id, ride.id);
  assert.equal((await claim(driver, next)).status, 200);
});

test('the matching deadline never expires a claimed negotiation, accepted fare or booking', async (t) => {
  const { h, customer, driver } = await setup(t); await driver.online();
  let ride = (await claim(driver, await requestRide(customer))).body.ride;
  h.advance(300000);
  assert.equal((await customer.send(`/api/rides/${ride.id}`)).body.ride.status, 'negotiating');
  ride = (await driver.post(`/api/rides/${ride.id}/offers`, { expectedVersion: ride.version, amountKobo: 470000 })).body.ride;
  ride = (await customer.post(`/api/rides/${ride.id}/accept`, { expectedVersion: ride.version, offerId: ride.negotiation.currentOffer.id })).body.ride;
  const agreement = ride.negotiation.agreement;
  h.advance(300000); assert.equal((await customer.send(`/api/rides/${ride.id}`)).body.ride.status, 'agreed');
  ride = (await customer.post(`/api/rides/${ride.id}/confirm`, { expectedVersion: ride.version })).body.ride;
  h.advance(300000); const saved = (await customer.send(`/api/rides/${ride.id}`)).body.ride;
  assert.equal(saved.status, 'booked'); assert.deepEqual(saved.negotiation.agreement, agreement);
});

test('failure while saving availability rolls back the location, audit and retry key together', async (t) => {
  const { h, driver } = await setup(t); const key = randomUUID(), data = { mode: 'gps', position: gps() };
  const before = h.db.prepare('SELECT count(*) AS n FROM audit_events').get().n;
  h.db.exec("CREATE TRIGGER fail_availability BEFORE INSERT ON availability_commands BEGIN SELECT RAISE(ABORT, 'private fault'); END");
  assert.equal((await driver.availability('/api/availability/online', data, key)).status, 500);
  assert.equal(h.db.prepare('SELECT count(*) AS n FROM driver_availability').get().n, 0);
  assert.equal(h.db.prepare('SELECT count(*) AS n FROM audit_events').get().n, before);
  h.db.exec('DROP TRIGGER fail_availability');
  assert.equal((await driver.availability('/api/availability/online', data, key)).status, 200);
});

test('candidate filtering precedes the result limit and orders eligible pickups by distance', async (t) => {
  const { h, driver } = await setup(t); await driver.online({ mode: 'gps', lat: pickup.lat, lng: pickup.lng });
  // Database fixtures avoid registration/rate-limit noise while exercising the real list API.
  const make = (index, lat) => {
    const userId = randomUUID(), id = randomUUID(), quoteId = randomUUID();
    h.db.prepare('INSERT INTO users (id,email,name,password_hash,role,created_at) VALUES (?,?,?,?,?,?)')
      .run(userId, `fixture-${index}@example.test`, 'Fixture customer', 'unused-test-hash', 'customer', TEST_NOW - 1000 + index);
    h.db.prepare(`INSERT INTO rides (id,customer_id,pickup_id,destination_id,suggested_fare_kobo,created_at,updated_at,request_expires_at)
      VALUES (?,?,?,?,?,?,?,?)`).run(id, userId, `point:${index}`, 'destination', 450000, TEST_NOW - 1000 + index, TEST_NOW - 1000 + index, TEST_NOW + 299000 + index);
    h.db.prepare('INSERT INTO location_quotes (id,customer_id,created_at,expires_at,route_json,ride_id) VALUES (?,?,?,?,?,?)')
      .run(quoteId, userId, TEST_NOW - 1000 + index, TEST_NOW + 899000 + index, JSON.stringify({ pickup: { lat, lng: pickup.lng, name: 'Private place' }, destination }), id);
    return id;
  };
  for (let i = 0; i < 51; i++) make(i, 9.22);
  const farther = make(51, 9.11), nearest = make(52, 9.082);
  assert.deepEqual((await list(driver)).map((ride) => ride.id), [nearest, farther]);
});
