import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { harness, participants, PASSWORD, claimRide } from './helpers.mjs';
import { parseBooking, parsePreview, parsePlaces, parseBookingRide } from '../../../packages/shared/src/mobile-booking.mjs';

const sample = { pickupId: 'wuse-ii', destinationId: 'maitama' };
const points = { pickup: { lat: 9.0765, lng: 7.3986, name: 'Test pickup' }, destination: { lat: 9.09, lng: 7.45, name: 'Test destination' } };
function maps() {
  return { mode: 'community', tileOrigin: 'https://tile.openstreetmap.org',
    describe: () => ({ enabled: true, mode: 'community', searchHost: 'search.example.test', routeHost: 'route.example.test' }),
    search: async () => [points.pickup, { lat: 51, lng: 0, name: 'Outside Abuja' }],
    route: async (a, b) => ({ distanceMeters: 7000, durationSeconds: 1200, coordinates: [[a.lng, a.lat], [7.42, 9.08], [b.lng, b.lat]] }),
  };
}
async function send(h, path, { data, token, key = randomUUID(), headers = {} } = {}) {
  const response = await fetch(h.base + '/api/mobile/v1' + path, { method: data === undefined ? 'GET' : 'POST',
    headers: { 'Content-Type': 'application/json', 'Idempotency-Key': key, ...(token ? { Authorization: `Bearer ${token}` } : {}), ...headers },
    ...(data === undefined ? {} : { body: JSON.stringify(data) }) });
  return { status: response.status, body: await response.json() };
}
async function login(h, web) {
  const result = await send(h, '/auth/login', { data: { email: web.user.email, password: PASSWORD, deviceName: 'Booking phone' } });
  assert.equal(result.status, 200, JSON.stringify(result.body)); return result.body.credentials;
}
async function setup(t, options = {}) {
  const provider = maps(), h = await harness(t, { mapProvider: provider, ...options });
  const people = await participants(h), credentials = await login(h, people.customer);
  const mobile = (path, data, key) => send(h, path, { data, key, token: credentials.accessToken });
  return { h, provider, ...people, credentials, mobile };
}

test('native review creates nothing; submitted sample requests share web dispatch, survive retries/restart and expose safe driver details', async (t) => {
  const { h, mobile, customer, driver } = await setup(t, { persistent: true });
  const settings = parseBooking((await mobile('/booking')).body);
  assert.equal(settings.allowSample, true); assert.equal(settings.areas.length, 7); assert.equal(settings.blockedBy, null);
  const preview = parsePreview((await mobile('/booking/sample', sample)).body).preview;
  assert.equal(preview.kind, 'sample'); assert.equal(preview.suggestedFareKobo, 450000);
  assert.equal(h.db.prepare('SELECT count(*) AS n FROM rides').get().n, 0);
  const key = randomUUID();
  const outcomes = await Promise.all([mobile('/booking/requests', preview.request, key), mobile('/booking/requests', preview.request, key)]);
  for (const result of outcomes) { assert.equal(result.status, 200); parseBookingRide(result.body); }
  const ride = outcomes[0].body.ride;
  assert.equal(outcomes[1].body.ride.id, ride.id); assert.equal(ride.fareKobo, null); assert.equal(ride.status, 'requested');
  assert.equal((await mobile('/booking/requests', sample)).body.error.code, 'OPEN_REQUEST_EXISTS');
  assert.equal((await driver.send('/api/rides')).body.available[0].id, ride.id);
  const webRide = (await customer.send(`/api/rides/${ride.id}`)).body.ride;
  const claimed = await claimRide(driver, webRide);
  await h.restart();
  const replay = await mobile('/booking/requests', preview.request, key);
  assert.equal(replay.body.replayed, true); assert.equal(replay.body.ride.status, 'negotiating');
  assert.equal(replay.body.ride.driver.vehicle.plate, claimed.driver.vehicle.plate);
  assert.equal(replay.body.ride.driver.name, driver.user.name);
  for (const field of ['email','phone','documents','pickupPin','customerId','coordinates','accessHash']) assert.ok(!JSON.stringify(replay.body).includes(`"${field}"`), field);
  assert.equal(parseBooking((await mobile('/booking')).body).current[0].id, ride.id);
  assert.equal((await mobile('/activity?mode=customer')).body.current[0].id, ride.id);
});

test('native quotes use server pricing and ownership, reject forged input and expire exactly at the server deadline', async (t) => {
  const { h, mobile, customer } = await setup(t);
  const places = parsePlaces((await mobile('/booking/search', { query: 'Wuse' })).body);
  assert.equal(places.places.length, 1); assert.equal(places.places[0].lat, points.pickup.lat);
  for (const data of [{ ...points, fare: 1 }, { ...points, destination: points.pickup }, { ...points, pickup: { ...points.pickup, lat: '9' } },
    { ...points, destination: { ...points.destination, lng: 1 } }]) assert.equal((await mobile('/booking/quotes', data)).status, 400);
  const key = randomUUID(), preview = parsePreview((await mobile('/booking/quotes', points, key)).body).preview;
  assert.equal(preview.suggestedFareKobo, 250000); assert.equal(preview.route.coordinates.length, 3);
  assert.deepEqual(preview.route.pricing, { baseKobo: 50000, distanceKobo: 140000, timeKobo: 60000, minimumKobo: 100000, incrementKobo: 5000 });
  assert.deepEqual((await mobile('/booking/quotes', points, key)).body.preview, preview);
  assert.equal((await mobile('/booking/quotes', { ...points, pickup: { ...points.pickup, name: 'Changed' } }, key)).body.error.code, 'KEY_REUSED');
  assert.equal((await mobile('/booking/requests', { ...preview.request, amountKobo: 1 })).status, 400);
  const other = h.client(); await other.register('outsider');
  const outsider = await login(h, other);
  assert.equal((await send(h, '/booking/requests', { token: outsider.accessToken, data: preview.request })).status, 404);
  h.advance(preview.expiresAt - h.now);
  // Renew the expired access credential independently; the route's server deadline is unchanged.
  const renewed = await login(h, customer);
  assert.equal((await send(h, '/booking/requests', { token: renewed.accessToken, data: preview.request })).body.error.code, 'QUOTE_EXPIRED');
  assert.equal(h.db.prepare('SELECT count(*) AS n FROM rides').get().n, 0);
});

test('native route consumption and retry records roll back together; the same request is recoverable after expiry and restart', async (t) => {
  const { h, mobile } = await setup(t, { persistent: true });
  const preview = parsePreview((await mobile('/booking/quotes', points)).body).preview, key = randomUUID();
  h.db.exec("CREATE TRIGGER fail_booking_command BEFORE INSERT ON idempotency BEGIN SELECT RAISE(ABORT, 'fault'); END");
  assert.equal((await mobile('/booking/requests', preview.request, key)).status, 500);
  assert.equal(h.db.prepare('SELECT ride_id FROM location_quotes WHERE id=?').get(preview.request.quoteId).ride_id, null);
  h.db.exec('DROP TRIGGER fail_booking_command');
  const created = (await mobile('/booking/requests', preview.request, key)).body.ride;
  await h.restart(); h.advance(5 * 60_000);
  const replay = await mobile('/booking/requests', preview.request, key);
  assert.equal(replay.body.replayed, true); assert.equal(replay.body.ride.id, created.id); assert.equal(replay.body.ride.status, 'expired');
  assert.equal((await mobile('/booking/requests', preview.request)).body.error.code, 'QUOTE_USED');
  assert.equal(h.db.prepare('SELECT count(*) AS n FROM rides').get().n, 1);
});

test('native cancellation is customer-owned, versioned, idempotent and reflected in web history', async (t) => {
  const { h, mobile, customer, driver } = await setup(t);
  const ride = (await mobile('/booking/requests', sample)).body.ride;
  await claimRide(driver, (await customer.send(`/api/rides/${ride.id}`)).body.ride);
  const latest = parseBookingRide((await mobile(`/booking/requests/${ride.id}`)).body).ride;
  const cancel = `/booking/requests/${ride.id}/cancel`;
  assert.equal((await mobile(cancel, { expectedVersion: ride.version })).body.error.code, 'STALE_VERSION');
  const worker = await login(h, driver);
  assert.equal((await send(h, `/booking/requests/${ride.id}`, { token: worker.accessToken })).status, 404);
  assert.equal((await send(h, cancel, { token: worker.accessToken, data: { expectedVersion: latest.version } })).status, 404);
  const other = h.client(); await other.register('another'); const outsider = await login(h, other);
  assert.equal((await send(h, cancel, { token: outsider.accessToken, data: { expectedVersion: latest.version } })).status, 404);
  const key = randomUUID(), data = { expectedVersion: latest.version, reason: 'plans_changed' };
  const cancelled = parseBookingRide((await mobile(cancel, data, key)).body).ride;
  assert.equal(cancelled.status, 'cancelled'); assert.equal(cancelled.canCancel, false);
  assert.equal((await mobile(cancel, data, key)).body.replayed, true);
  assert.equal((await mobile('/booking')).body.current.length, 0);
  assert.equal((await customer.send('/api/rides/history?mode=customer')).body.rides[0].id, ride.id);
});

test('native booking does not accept browser cookies/origins and rechecks device revocation after provider I/O', async (t) => {
  const { h, mobile, customer, credentials, provider } = await setup(t);
  assert.equal((await send(h, '/booking', { headers: { Cookie: customer.cookie } })).status, 401);
  assert.equal((await send(h, '/booking', { token: credentials.accessToken, headers: { Origin: h.base } })).status, 403);
  assert.equal((await send(h, '/booking/requests', { token: credentials.accessToken, data: sample, key: '' })).status, 400);
  assert.equal((await mobile('/booking/sample', { ...sample, fare: 1 })).status, 400);
  assert.equal((await mobile('/booking/sample', { pickupId: 'wuse-ii', destinationId: 'wuse-ii' })).status, 400);
  assert.equal((await mobile('/booking/requests', { quoteId: 'x'.repeat(5000) })).status, 413);
  for (const kind of ['search','route']) {
    const device = await login(h, customer);
    let finish, started;
    const began = new Promise((resolve) => { started = resolve; });
    const previous = provider[kind]; provider[kind] = (...args) => new Promise((resolve) => { finish = async () => resolve(await previous(...args)); started(); });
    const pending = send(h, kind === 'search' ? '/booking/search' : '/booking/quotes', { token: device.accessToken, data: kind === 'search' ? { query: 'Wuse' } : points });
    await began; await customer.post(`/api/account/devices/${device.sessionId}/revoke`); await finish();
    assert.equal((await pending).status, 401);
    provider[kind] = previous;
  }
  assert.equal(h.db.prepare('SELECT count(*) AS n FROM location_quotes').get().n, 0);
});

test('driver work and online availability block personal native requests without granting staff or driver actions', async (t) => {
  const { h, mobile, customer, driver } = await setup(t);
  const worker = await login(h, driver), sendWorker = (path, data) => send(h, path, { token: worker.accessToken, data });
  assert.equal(parseBooking((await sendWorker('/booking')).body).blockedBy, 'online');
  assert.equal((await sendWorker('/booking/requests', sample)).body.error.code, 'DRIVER_ONLINE');
  const ride = (await mobile('/booking/requests', sample)).body.ride;
  await claimRide(driver, (await customer.send(`/api/rides/${ride.id}`)).body.ride);
  assert.equal((await sendWorker('/booking')).body.blockedBy, 'work');
  assert.equal((await sendWorker('/booking/requests', sample)).body.error.code, 'DRIVER_BUSY');
  assert.equal((await mobile(`/booking/requests/${ride.id}/accept`, { expectedVersion: 1 })).status, 404);
});

test('native category requests retain parcel data in web journeys and parse direct delivery quotes', async (t) => {
  const { mobile, customer } = await setup(t);
  for (const vehicleCategory of ['suv', 'van', 'truck', 'motorcycle']) {
    const delivery = vehicleCategory === 'suv' ? undefined : { description: 'Test parcel', weightKg: 2, recipientName: 'Test recipient' };
    const preview = parsePreview((await mobile('/booking/sample', { ...sample, vehicleCategory })).body).preview;
    assert.equal(preview.vehicleCategory, vehicleCategory); assert.equal(preview.request.vehicleCategory, vehicleCategory);
    const response = await mobile('/booking/requests', { ...preview.request, ...(delivery ? { delivery } : {}) });
    assert.equal(response.status, 200, JSON.stringify(response.body));
    const ride = parseBookingRide(response.body).ride;
    assert.equal(ride.vehicleCategory, vehicleCategory); assert.equal(ride.delivery?.recipientName, delivery?.recipientName);
    const saved = (await customer.send(`/api/rides/${ride.id}`)).body.ride;
    assert.equal(saved.vehicleCategory, vehicleCategory); assert.equal(saved.delivery?.weightKg, delivery?.weightKg);
    assert.equal((await mobile(`/booking/requests/${ride.id}/cancel`, { expectedVersion: ride.version })).status, 200);
    const direct = parsePreview((await mobile('/booking/quotes', { ...points, vehicleCategory })).body).preview;
    assert.equal(direct.vehicleCategory, vehicleCategory);
    assert.equal(direct.route.durationSeconds === null, Boolean(delivery));
    assert.equal(direct.route.distanceKind, delivery ? 'straight_line' : 'road');
  }
});
