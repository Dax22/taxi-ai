import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createApplication } from '../src/application.mjs';
import { TEST_NOW, harness, participants, claimRide } from './helpers.mjs';
import { NIGERIA_BOUNDS, distanceMeters } from '../../../packages/shared/src/locations.mjs';
import { checkedRoute, MAX_ROUTE_METERS, MAX_ROUTE_SECONDS, position } from '../src/modules/locations/domain.mjs';

const points = { pickup: { lat: 9.0765, lng: 7.3986, name: 'Pickup test landmark' }, destination: { lat: 9.09, lng: 7.45, name: 'Destination test landmark' } };
function maps() {
  return { mode: 'community', tileOrigin: 'https://tile.openstreetmap.org',
    describe: () => ({ enabled: true, mode: 'community', tiles: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png' }),
    search: async () => [points.pickup, { lat: 51, lng: 0, name: 'Outside' }],
    route: async (a, b) => ({ distanceMeters: 7000, durationSeconds: 1200, coordinates: [[a.lng, a.lat], [7.42, 9.08], [b.lng, b.lat]] }),
  };
}
async function setup(t, options = {}) { const provider = maps(); const h = await harness(t, { ...options, mapProvider: provider }); const people = await participants(h);
  await people.driver.online({ mode: 'gps', lat: points.pickup.lat, lng: points.pickup.lng });
  return { h, provider, ...people }; }
async function quote(customer, commandKey) {
  const result = await customer.post('/api/locations/quotes', points, commandKey);
  assert.ok([200, 201].includes(result.status), JSON.stringify(result.body)); return result.body.quote;
}
async function routed(customer) {
  const preview = await quote(customer);
  const response = await customer.post('/api/rides', { quoteId: preview.id });
  assert.equal(response.status, 201, JSON.stringify(response.body)); return response.body.ride;
}
async function change(client, ride, action, extra = {}, commandKey) {
  const result = await client.post(`/api/rides/${ride.id}/${action}`, { expectedVersion: ride.version, ...extra }, commandKey);
  assert.equal(result.status, 200, JSON.stringify(result.body)); return result.body.ride;
}
async function booked(customer, driver) {
  let ride = await claimRide(driver, await routed(customer));
  ride = await change(driver, ride, 'offers', { amountKobo: 470000 });
  ride = await change(customer, ride, 'accept', { offerId: ride.negotiation.currentOffer.id });
  return (await change(customer, ride, 'confirm'));
}
function windowFor(client) {
  const clientId = randomUUID();
  return { get: (url) => client.send(url, { headers: { 'X-Location-Client': clientId } }),
    post: (url, data = {}, key = randomUUID()) => client.send(url, { method: 'POST', data,
      headers: { 'X-Location-Client': clientId, 'Idempotency-Key': key } }) };
}
const fix = (extra = {}) => ({ sequence: 1, lat: 9.0765, lng: 7.3986, accuracy: 12, capturedAt: TEST_NOW, ...extra });

test('address search is authenticated and bounded; route pricing and exact locations remain server-owned and participant-scoped', async (t) => {
  const { h, customer, driver, admin } = await setup(t);
  assert.equal((await h.client().post('/api/locations/search', { query: 'Wuse' })).status, 401);
  assert.equal((await admin.post('/api/locations/search', { query: 'Wuse' })).status, 403);
  const search = await customer.post('/api/locations/search', { query: 'Wuse' });
  assert.equal(search.body.places.length, 1); assert.equal(search.body.places[0].lat, points.pickup.lat);
  assert.equal((await customer.post('/api/locations/search', { query: 'Wu', provider: 'http://bad' })).status, 400);
  assert.equal((await driver.post('/api/locations/quotes', points)).status, 201);
  const preview = await quote(customer);
  assert.equal(preview.route.distanceMeters, 7000); assert.equal(preview.route.durationSeconds, 1200);
  assert.equal(preview.route.suggestedFareKobo, 250000); assert.equal(preview.route.trafficAware, false);
  assert.equal(preview.route.pricing.illustrative, true);
  assert.equal((await customer.post('/api/rides', { quoteId: preview.id, suggestedFareKobo: 100 })).status, 400);
  let ride = (await customer.post('/api/rides', { quoteId: preview.id })).body.ride;
  const available = (await driver.send('/api/rides')).body.available[0];
  const serialized = JSON.stringify(available);
  for (const value of [points.pickup.name, String(points.pickup.lat), 'coordinates', 'routeJson', 'customerId']) assert.ok(!serialized.includes(value), value);
  ride = await claimRide(driver, ride);
  assert.deepEqual(ride.route, preview.route); assert.equal(ride.negotiation.agreement, null);
  assert.equal((await admin.send(`/api/rides/${ride.id}/location`)).status, 403);
});

test('quote inputs reject forged metrics, invalid coordinates and same points; expired or stolen quotes cannot create rides', async (t) => {
  const { h, customer, provider } = await setup(t);
  for (const data of [null, { ...points, distanceMeters: 1 }, { ...points, pickup: { ...points.pickup, lat: '9.1' } },
    { ...points, destination: points.pickup }, { ...points, destination: { ...points.destination, lat: 6.3703, lng: 2.3912 } }]) {
    assert.equal((await customer.post('/api/locations/quotes', data)).status, 400);
  }
  const preview = await quote(customer);
  const outsider = h.client(); await outsider.register('outside');
  assert.equal((await outsider.post('/api/rides', { quoteId: preview.id })).status, 404);
  h.advance(15 * 60_000);
  assert.equal((await customer.post('/api/rides', { quoteId: preview.id })).body.error.code, 'QUOTE_EXPIRED');
  provider.route = async () => ({ distanceMeters: 1, durationSeconds: 1, coordinates: [] });
  assert.equal((await customer.post('/api/locations/quotes', points)).status, 503);
  assert.equal(h.db.prepare('SELECT count(*) AS n FROM rides').get().n, 0);
});

test('national search and quotes accept Lagos, Kano and Port Harcourt while rejecting foreign points inside the bounding rectangle', async (t) => {
  const { customer, provider } = await setup(t);
  const cities = [
    { lat: 6.5244, lng: 3.3792, name: 'Lagos test pickup' },
    { lat: 12.0022, lng: 8.592, name: 'Kano test pickup' },
    { lat: 4.8156, lng: 7.0498, name: 'Port Harcourt test pickup' },
  ];
  const foreign = [{ lat: 6.3703, lng: 2.3912, name: 'Cotonou' }, { lat: 10.591, lng: 14.3159, name: 'Maroua' }];
  let searchBounds;
  provider.search = async (query, bounds) => { searchBounds = bounds; return [...cities, ...foreign]; };
  provider.route = async (a, b) => ({ distanceMeters: Math.ceil(distanceMeters(a, b) * 1.2), durationSeconds: 1200,
    coordinates: [[a.lng, a.lat], [b.lng, b.lat]] });
  assert.deepEqual((await customer.send('/api/locations')).body.settings.bounds, NIGERIA_BOUNDS);
  assert.deepEqual((await customer.post('/api/locations/search', { query: 'town' })).body.places.map((p) => p.name), cities.map((p) => p.name));
  assert.deepEqual(searchBounds, NIGERIA_BOUNDS);
  for (const pickup of cities) {
    const result = await customer.post('/api/locations/quotes', { pickup, destination: { ...pickup, lat: pickup.lat + 0.01, name: 'Nearby destination' } });
    assert.equal(result.status, 201, JSON.stringify(result.body));
    assert.equal(result.body.quote.route.pricing.policy, 'nigeria-preview-v1');
    assert.equal(result.body.quote.route.pricing.illustrative, true);
  }
  for (const pickup of foreign) {
    const result = await customer.post('/api/locations/quotes', { pickup, destination: cities[0] });
    assert.equal(result.status, 400); assert.equal(result.body.error.code, 'INVALID_LOCATION');
  }
});

test('national road previews allow interstate distances with bounded duration and reject routes that leave Nigeria', () => {
  const endpoints = { pickup: { lat: 6.5244, lng: 3.3792, name: 'Lagos' }, destination: points.pickup, vehicleCategory: 'standard' };
  const coordinates = [[3.3792, 6.5244], [3.947, 7.3775], [6.7333, 7.8], [points.pickup.lng, points.pickup.lat]];
  const route = { distanceMeters: 750_000, durationSeconds: 9 * 60 * 60, coordinates };
  const preview = checkedRoute(route, endpoints);
  assert.equal(preview.distanceMeters, 750_000); assert.equal(preview.durationSeconds, 9 * 60 * 60);
  assert.equal(preview.pricing.policy, 'nigeria-preview-v1');
  for (const extra of [{ distanceMeters: MAX_ROUTE_METERS + 1 }, { durationSeconds: MAX_ROUTE_SECONDS + 1 }]) {
    assert.throws(() => checkedRoute({ ...route, ...extra }, endpoints), { code: 'INVALID_ROUTE' });
  }
  assert.throws(() => checkedRoute({ ...route, coordinates: [coordinates[0], [2.3912, 6.3703], coordinates.at(-1)] }, endpoints), { code: 'INVALID_ROUTE' });
});

test('shared trip GPS accepts nationwide locations but retains national bounds, accuracy and freshness checks', () => {
  for (const point of [{ lat: 6.5244, lng: 3.3792 }, { lat: 12.0022, lng: 8.592 }, { lat: 4.8156, lng: 7.0498 }]) {
    assert.deepEqual(position(fix(point), TEST_NOW), { ...point, accuracy: 12, capturedAt: TEST_NOW });
    for (const extra of [{ accuracy: 201 }, { capturedAt: TEST_NOW - 30_000 }]) {
      assert.throws(() => position(fix({ ...point, ...extra }), TEST_NOW), { code: 'INVALID_LOCATION' });
    }
  }
  for (const point of [{ lat: 6.3703, lng: 2.3912 }, { lat: 10.591, lng: 14.3159 }]) {
    assert.throws(() => position(fix(point), TEST_NOW), { code: 'INVALID_LOCATION' });
  }
});

test('quote retries, ride consumption and their rollback remain consistent through restart', async (t) => {
  const { h, customer, driver } = await setup(t, { persistent: true });
  const quoteKey = randomUUID();
  const [first, second] = await Promise.all([(quote(customer, quoteKey)), (quote(customer, quoteKey))]);
  assert.equal(first.id, second.id);
  assert.equal((await customer.post('/api/locations/quotes', { ...points, pickup: { ...points.pickup, name: 'Different place' } }, quoteKey)).body.error.code, 'KEY_REUSED');
  const rideKey = randomUUID();
  h.db.exec("CREATE TRIGGER fail_location_ride BEFORE INSERT ON idempotency BEGIN SELECT RAISE(ABORT, 'fault'); END");
  assert.equal((await customer.post('/api/rides', { quoteId: first.id }, rideKey)).status, 500);
  assert.equal(h.db.prepare('SELECT ride_id FROM location_quotes WHERE id = ?').get(first.id).ride_id, null);
  h.db.exec('DROP TRIGGER fail_location_ride');
  const created = await customer.post('/api/rides', { quoteId: first.id }, rideKey);
  let ride = await claimRide(driver, created.body.ride);
  ride = await change(driver, ride, 'offers', { amountKobo: 470000 });
  ride = await change(customer, ride, 'accept', { offerId: ride.negotiation.currentOffer.id });
  await h.restart(); h.advance(16 * 60_000);
  const replay = await customer.post('/api/rides', { quoteId: first.id }, rideKey);
  assert.equal(replay.body.replayed, true); assert.equal(replay.body.ride.id, ride.id);
  assert.equal(replay.body.ride.negotiation.agreement.amountKobo, 470000);
  assert.deepEqual(replay.body.ride.route, first.route);
  assert.equal((await customer.post('/api/rides', { quoteId: first.id })).body.error.code, 'QUOTE_USED');
});

test('location sharing requires a booking, driver approval, session/CSRF and the owning window for position updates', async (t) => {
  const { h, customer, driver } = await setup(t);
  let ride = await claimRide(driver, await routed(customer));
  const one = windowFor(driver), two = windowFor(driver), rider = windowFor(customer);
  assert.equal((await one.post(`/api/rides/${ride.id}/location/start`)).body.error.code, 'LOCATION_CLOSED');
  ride = await change(driver, ride, 'offers', { amountKobo: 470000 });
  ride = await change(customer, ride, 'accept', { offerId: ride.negotiation.currentOffer.id });
  ride = await change(customer, ride, 'confirm');
  assert.equal((await rider.post(`/api/rides/${ride.id}/location/start`)).status, 403);
  const races = await Promise.all([one, two].map((window) => window.post(`/api/rides/${ride.id}/location/start`)));
  assert.deepEqual(races.map((r) => r.status).sort(), [200, 409]);
  const owner = races[0].status === 200 ? one : two, other = owner === one ? two : one;
  const share = races.find((r) => r.status === 200).body.share;
  assert.equal((await other.post(`/api/location-shares/${share.id}/position`, fix())).body.error.code, 'LOCATION_WINDOW');
  assert.equal((await rider.post(`/api/location-shares/${share.id}/position`, fix())).status, 403);
  assert.equal((await driver.send(`/api/location-shares/${share.id}/position`, { method: 'POST', data: fix(), headers: { 'X-CSRF-Token': 'bad' } })).status, 403);
  assert.equal((await owner.post(`/api/location-shares/${share.id}/position`, fix())).status, 200);
  const read = (await rider.get(`/api/rides/${ride.id}/location`)).body.share;
  assert.equal(read.position.lat, points.pickup.lat); assert.equal(read.owned, false);
  assert.ok(!JSON.stringify(read).includes('Hash'));
  const outsider = h.client(); await outsider.register('unrelated');
  assert.equal((await outsider.send(`/api/rides/${ride.id}/location`)).status, 404);
  await other.post(`/api/location-shares/${share.id}/stop`);
  assert.equal((await rider.get(`/api/rides/${ride.id}/location`)).body.share, null);
  assert.equal((await owner.post(`/api/location-shares/${share.id}/position`, fix({ sequence: 2 }))).body.error.code, 'LOCATION_CLOSED');
});

test('out-of-order GPS cannot overwrite newer fixes; freshness and lease deadlines use server time', async (t) => {
  const { h, customer, driver } = await setup(t, { persistent: true });
  const ride = await booked(customer, driver), owner = windowFor(driver), rider = windowFor(customer);
  const share = (await owner.post(`/api/rides/${ride.id}/location/start`)).body.share;
  for (const invalid of [{ accuracy: 500 }, { capturedAt: (TEST_NOW - 30_000) }, { capturedAt: (TEST_NOW + 5_001) }, { lat: 41 }, { sequence: 0 }, { sequence: '1' }]) {
    assert.equal((await owner.post(`/api/location-shares/${share.id}/position`, fix(invalid))).status, 400);
  }
  await owner.post(`/api/location-shares/${share.id}/position`, fix({ sequence: 2 }));
  await owner.post(`/api/location-shares/${share.id}/position`, fix({ sequence: 1, lng: 7.42 }));
  assert.equal((await rider.get(`/api/rides/${ride.id}/location`)).body.share.position.lng, points.pickup.lng);
  assert.equal((await owner.post(`/api/location-shares/${share.id}/position`, fix({ sequence: 2, lng: 7.42 }))).body.error.code, 'STALE_LOCATION');
  await h.restart(); h.advance(29_999);
  assert.equal((await rider.get(`/api/rides/${ride.id}/location`)).body.share.stale, false);
  h.advance(1); assert.equal((await rider.get(`/api/rides/${ride.id}/location`)).body.share.stale, true);
  h.advance(30_000); assert.equal((await rider.get(`/api/rides/${ride.id}/location`)).body.share, null);
  assert.equal(h.db.prepare('SELECT position_json FROM location_shares WHERE id = ?').get(share.id).position_json, null);
});

test('trip cancellation clears sharing atomically; old start retries and revoked sessions cannot revive it', async (t) => {
  const { h, customer, driver } = await setup(t);
  const ride = await booked(customer, driver), owner = windowFor(driver), key = randomUUID();
  const share = (await owner.post(`/api/rides/${ride.id}/location/start`, {}, key)).body.share;
  await owner.post(`/api/location-shares/${share.id}/position`, fix());
  h.db.exec("CREATE TRIGGER fail_trip_location BEFORE INSERT ON idempotency BEGIN SELECT RAISE(ABORT, 'fault'); END");
  const cancelKey = randomUUID();
  assert.equal((await customer.post(`/api/rides/${ride.id}/cancel`, { expectedVersion: ride.version }, cancelKey)).status, 500);
  assert.equal((await owner.get(`/api/rides/${ride.id}/location`)).body.share.active, true);
  h.db.exec('DROP TRIGGER fail_trip_location');
  await change(customer, ride, 'cancel', {}, cancelKey);
  assert.equal((await owner.get(`/api/rides/${ride.id}/location`)).body.share, null);
  assert.equal((await owner.post(`/api/rides/${ride.id}/location/start`, {}, key)).body.share.active, false);
  const next = await booked(customer, driver);
  const latest = (await owner.post(`/api/rides/${next.id}/location/start`)).body.share;
  await owner.post(`/api/location-shares/${latest.id}/position`, fix());
  await driver.post('/api/auth/logout');
  assert.equal((await customer.send(`/api/rides/${next.id}/location`)).body.share, null);
  const row = h.db.prepare('SELECT position_json, session_hash, client_hash FROM location_shares WHERE id = ?').get(latest.id);
  assert.ok(Object.values(row).every((v) => v === null));
});

test('provider delays cannot save quotes after logout and a failed quote-command write rolls back the quote and audit', async (t) => {
  const { h, customer, provider } = await setup(t);
  h.db.exec("CREATE TRIGGER fail_quote BEFORE INSERT ON location_quote_commands BEGIN SELECT RAISE(ABORT, 'fault'); END");
  assert.equal((await customer.post('/api/locations/quotes', points)).status, 500);
  assert.equal(h.db.prepare('SELECT count(*) AS n FROM location_quotes').get().n, 0);
  assert.equal(h.db.prepare("SELECT count(*) AS n FROM audit_events WHERE kind = 'location.quote'").get().n, 0);
  h.db.exec('DROP TRIGGER fail_quote');
  let resolve, entered;
  const waiting = new Promise((yes) => { entered = yes; });
  provider.route = () => { entered(); return new Promise((yes) => { resolve = yes; }); };
  const pending = customer.post('/api/locations/quotes', points); await waiting;
  await customer.post('/api/auth/logout');
  resolve(await maps().route(points.pickup, points.destination));
  assert.equal((await pending).status, 401);
  assert.equal(h.db.prepare('SELECT count(*) AS n FROM location_quotes').get().n, 0);
});

test('trip completion and approval revocation clear GPS; unused expired quotes and retry keys are pruned', async (t) => {
  const { h, customer, driver } = await setup(t);
  const unused = await quote(customer);
  let ride = await booked(customer, driver);
  const pin = ride.trip.pickupPin, owner = windowFor(driver);
  const share = (await owner.post(`/api/rides/${ride.id}/location/start`)).body.share;
  await owner.post(`/api/location-shares/${share.id}/position`, fix());
  for (const action of ['depart', 'arrive', 'start', 'complete']) {
    ride = await change(driver, ride, action, action === 'start' ? { pickupPin: pin } : {});
    const current = (await customer.send(`/api/rides/${ride.id}/location`)).body.share;
    assert.equal(Boolean(current?.active), action !== 'complete');
  }
  assert.equal(h.db.prepare('SELECT position_json FROM location_shares WHERE id = ?').get(share.id).position_json, null);
  assert.ok((await customer.send(`/api/rides/${ride.id}`)).body.ride.route, 'completed journeys retain their planned route');
  const next = await booked(customer, driver);
  const second = (await owner.post(`/api/rides/${next.id}/location/start`)).body.share;
  await owner.post(`/api/location-shares/${second.id}/position`, fix());
  h.db.prepare("UPDATE drivers SET status = 'rejected' WHERE user_id = ?").run(driver.user.id);
  assert.equal((await customer.send(`/api/rides/${next.id}/location`)).body.share, null);
  h.advance(75 * 60_000 + 1);
  await customer.send(`/api/rides/${next.id}/location`);
  assert.ok(h.db.prepare('SELECT id FROM location_quotes WHERE id = ?').get(unused.id), 'participant tracking does not perform global quote cleanup');
  await createApplication({ db: h.db, clock: () => h.now }).locations.sweep();
  assert.equal(h.db.prepare('SELECT id FROM location_quotes WHERE id = ?').get(unused.id), undefined);
  assert.equal(h.db.prepare('SELECT count(*) AS n FROM location_quote_commands WHERE quote_id = ?').get(unused.id).n, 0);
  assert.equal(h.db.prepare('SELECT count(*) AS n FROM location_quotes WHERE ride_id IS NOT NULL').get().n, 2);
});
