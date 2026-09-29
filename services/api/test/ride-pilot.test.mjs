import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createRidePilotConfig } from '../../../packages/shared/src/ride-pilot.mjs';
import { harness, participants, PASSWORD } from './helpers.mjs';

const bounds = '9.0,7.35,9.2,7.5';
const config = (paused = false, area = bounds) => createRidePilotConfig({
  TAXI_AI_RIDES_PAUSED: String(paused), TAXI_AI_RIDE_PILOT_BOUNDS: area,
}, 'staging');
const pickup = { lat: 9.08, lng: 7.4, name: 'Test pickup' };
const destination = { lat: 9.1, lng: 7.45, name: 'Test destination' };
const parcel = { description: 'A small test parcel', weightKg: 2, recipientName: 'Test recipient' };
const provider = (geometry = (a, b) => [[a.lng, a.lat], [b.lng, b.lat]]) => ({ mode: 'off',
  describe: () => ({ enabled: false }),
  route: async (a, b) => ({ distanceMeters: 7000, durationSeconds: 1200, coordinates: geometry(a, b) }),
});
const preview = async (customer, data = {}) => {
  const result = await customer.post('/api/locations/quotes', { pickup, destination, ...data });
  assert.equal(result.status, 201, JSON.stringify(result.body));
  return result.body.quote;
};

test('hosted requests start paused; unpausing requires a valid approved rectangle', () => {
  assert.equal(createRidePilotConfig({}, 'staging').paused, true);
  assert.equal(createRidePilotConfig({}, 'local').paused, false);
  for (const value of ['yes', '1', 'TRUE', '']) assert.throws(() => createRidePilotConfig({ TAXI_AI_RIDES_PAUSED: value }, 'staging'));
  assert.throws(() => createRidePilotConfig({ TAXI_AI_RIDES_PAUSED: 'false' }, 'staging'), /BOUNDS/);
  for (const value of ['0,0,1,1', '9.2,7.4,9.0,7.5', '9.0,7.4,9.2', '9.0,7.4,9.2,7.5,extra', '9.0,7.4,9.2,NaN']) {
    assert.throws(() => config(false, value), value);
  }
  assert.ok(config().bounds);
});

test('pausing blocks only new passenger bookings across web and native; parcel and Eats remain available', async (t) => {
  const h = await harness(t, { mapProvider: provider(), ridePilot: config(true) });
  const { customer, admin } = await participants(h, 0);
  const quote = await preview(customer);
  assert.equal(JSON.stringify(quote).includes('ridePilotCoverage'), false);
  const booking = await customer.post('/api/rides', { quoteId: quote.id });
  assert.equal(booking.status, 409); assert.equal(booking.body.error.code, 'RIDES_PAUSED');

  const loggedIn = await fetch(h.base + '/api/mobile/v1/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: customer.user.email, password: PASSWORD, deviceName: 'Test phone' }) });
  assert.equal(loggedIn.status, 200);
  const token = (await loggedIn.json()).credentials.accessToken;
  const native = await fetch(h.base + '/api/mobile/v1/booking/requests', { method: 'POST', headers: {
    'Content-Type': 'application/json', Authorization: `Bearer ${token}`, 'Idempotency-Key': randomUUID(),
  }, body: JSON.stringify({ quoteId: quote.id }) });
  assert.equal(native.status, 409); assert.equal((await native.json()).error.code, 'RIDES_PAUSED');

  const delivery = await customer.post('/api/rides', { quoteId: quote.id, delivery: parcel });
  assert.equal(delivery.status, 201, JSON.stringify(delivery.body)); assert.equal(delivery.body.ride.service, 'delivery');

  const outsideCustomer = h.client(); await outsideCustomer.register('outside-courier');
  const outsideQuote = await preview(outsideCustomer, {
    pickup: { lat: 9.26, lng: 7.55, name: 'Outside pickup' },
    destination: { lat: 9.28, lng: 7.57, name: 'Outside destination' },
  });
  const outsideParcel = await outsideCustomer.post('/api/rides', { quoteId: outsideQuote.id, delivery: parcel });
  assert.equal(outsideParcel.status, 201, JSON.stringify(outsideParcel.body));

  const seller = h.client(); await seller.register('pilot-seller');
  const details = { name: 'Test kitchen', cuisine: 'Nigerian', description: 'Fictional seller.',
    address: '10 Fictional Road, Wuse II', areaId: 'wuse-ii', deliveryAreaIds: ['wuse-ii', 'maitama'],
    prepMinutes: 25, minimumKobo: 100_000, deliveryFeeKobo: 150_000 };
  let store = (await seller.post('/api/eats/stores', { details })).body.store;
  store = (await seller.post(`/api/eats/stores/${store.id}/menu`, { expectedVersion: store.version, itemId: null,
    item: { name: 'Jollof rice', description: 'Fictional test meal.', category: 'Meals', priceKobo: 250_000, available: true } })).body.store;
  const menu = (await seller.send('/api/eats/store')).body.menu;
  store = (await admin.post(`/api/eats/stores/${store.id}/review`, { expectedVersion: store.version,
    decision: 'approved', reason: 'Fictional seller reviewed for this regression.', reference: 'TEST-PILOT' })).body.store;
  store = (await seller.post(`/api/eats/stores/${store.id}/open`, { expectedVersion: store.version, isOpen: true })).body.store;
  const eatsQuote = await customer.post('/api/eats/quotes', { storeId: store.id, expectedVersion: store.version,
    items: [{ itemId: menu[0].id, quantity: 1 }], address: { line: '25 Fictional Close', areaId: 'maitama' }, instructions: 'Test only.' });
  assert.equal(eatsQuote.status, 200, JSON.stringify(eatsQuote.body));
  const eatsOrder = await customer.post('/api/eats/orders', { quoteId: eatsQuote.body.quote.id });
  assert.equal(eatsOrder.status, 200, JSON.stringify(eatsOrder.body));
  assert.equal(h.db.prepare('SELECT count(*) AS n FROM rides').get().n, 2);
});

test('full provider geometry controls coverage, even when display geometry is shortened; old quotes fail after area changes', async (t) => {
  // The outside point is removed by checkedRoute's display downsampling.
  const geometry = (a, b) => Array.from({ length: 1203 }, (_, i) =>
    i === 0 ? [a.lng, a.lat] : i === 1202 ? [b.lng, b.lat] : i === 3 ? [7.7, 9.08] : [7.41, 9.08]);
  const h = await harness(t, { persistent: true, mapProvider: provider(geometry), ridePilot: config() });
  const customer = h.client(); await customer.register('pilot-area');
  const quote = await preview(customer);
  assert.equal(quote.route.coordinates.some(([lng]) => lng === 7.7), false);
  assert.equal(JSON.stringify(quote).includes('ridePilotCoverage'), false);
  const outside = await customer.post('/api/rides', { quoteId: quote.id });
  assert.equal(outside.status, 409); assert.equal(outside.body.error.code, 'RIDE_PILOT_AREA');
  assert.equal(h.db.prepare('SELECT count(*) AS n FROM rides').get().n, 0);

  const clean = await preview(customer, { destination: { ...destination, name: 'Another destination' } });
  // The raw geometry is still outside; a new rectangle containing that route is required.
  await h.restart({ ridePilot: config(false, '9.0,7.35,9.2,7.8') });
  const oldArea = await customer.post('/api/rides', { quoteId: clean.id });
  assert.equal(oldArea.status, 409); assert.equal(oldArea.body.error.code, 'RIDE_PILOT_AREA');
  const refreshed = await preview(customer, { destination: { ...destination, name: 'New area destination' } });
  const created = await customer.post('/api/rides', { quoteId: refreshed.id });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  assert.equal(JSON.stringify(created.body).includes('ridePilotCoverage'), false);
});

test('a selected pickup outside the area stays blocked even if the provider snaps the road route inside', async (t) => {
  const snappedRoad = provider((a, b) => [[a.lng, 9.001], [b.lng, b.lat]]);
  const h = await harness(t, { mapProvider: snappedRoad, ridePilot: config(false, '9.0,7.35,9.2,7.5') });
  const customer = h.client(); await customer.register('pilot-snapped');
  const quote = await preview(customer, { pickup: { lat: 8.999, lng: 7.4, name: 'Just outside area' },
    destination: { lat: 9.01, lng: 7.41, name: 'Nearby destination' } });
  const blocked = await customer.post('/api/rides', { quoteId: quote.id });
  assert.equal(blocked.status, 409); assert.equal(blocked.body.error.code, 'RIDE_PILOT_AREA');
  assert.equal(h.db.prepare('SELECT count(*) AS n FROM rides').get().n, 0);
});

test('an operator pause after a request blocks a saved quote but permits an existing passenger trip to close', async (t) => {
  const h = await harness(t, { persistent: true, mapProvider: provider(), ridePilot: config() });
  const { customer, driver } = await participants(h);
  const existing = await preview(customer), later = await preview(customer, { destination: { ...destination, name: 'Later trip' } });
  const created = await customer.post('/api/rides', { quoteId: existing.id });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  await h.restart({ ridePilot: config(true) });
  const blocked = await customer.post('/api/rides', { quoteId: later.id });
  assert.equal(blocked.body.error.code, 'RIDES_PAUSED');
  const cancelled = await customer.post(`/api/rides/${created.body.ride.id}/cancel`, { expectedVersion: created.body.ride.version });
  assert.equal(cancelled.status, 200, JSON.stringify(cancelled.body)); assert.equal(cancelled.body.ride.status, 'cancelled');
  assert.equal((await driver.send('/api/availability')).status, 200);
});
