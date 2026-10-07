import test from 'node:test';
import assert from 'node:assert/strict';
import { createRidePilotConfig } from '../../../packages/shared/src/ride-pilot.mjs';
import { harness, participants } from './helpers.mjs';

const env = { TAXI_AI_RIDES_PAUSED: 'false', TAXI_AI_RIDE_COVERAGE: 'nigeria' };
const route = points => points.map(p => [p.lng, p.lat]);
const abuja = { lat: 9.08, lng: 7.4, name: 'Test pickup' };
const end = { lat: 9.1, lng: 7.45, name: 'Test destination' };

test('nationwide operation is explicit; default hosted coverage remains paused and missing coverage fails closed', () => {
  assert.equal(createRidePilotConfig({}, 'staging').paused, true);
  assert.throws(() => createRidePilotConfig({ TAXI_AI_RIDES_PAUSED: 'false' }, 'staging'), /BOUNDS/);
  assert.throws(() => createRidePilotConfig({ ...env, TAXI_AI_RIDE_COVERAGE: 'world' }, 'staging'));
  assert.throws(() => createRidePilotConfig({ ...env, TAXI_AI_RIDE_PILOT_BOUNDS: '9,7.35,9.2,7.5' }, 'staging'));
  assert.deepEqual(createRidePilotConfig(env, 'staging').describe(), { paused: false, coverage: 'nigeria' });
});

test('Nigeria coverage validates both endpoints and every raw route point; stale pilot quotes are rejected', () => {
  const cfg = createRidePilotConfig(env, 'staging');
  for (const city of [{ lat: 6.5244, lng: 3.3792 }, { lat: 12.0022, lng: 8.592 }, { lat: 4.8156, lng: 7.0498 }]) {
    const points = [city, { lat: city.lat + 0.005, lng: city.lng + 0.005 }];
    assert.equal(cfg.allows({ ridePilotCoverage: cfg.coverage(route(points), points) }), true);
  }
  const points = [abuja, end], foreign = { lat: 6.3703, lng: 2.3912 };
  assert.equal(cfg.coverage(route([abuja, foreign, end]), points).allowed, false);
  assert.equal(cfg.coverage(route(points), [foreign, end]).allowed, false);
  assert.equal(cfg.coverage([], points).allowed, false);
  assert.equal(cfg.coverage([[7.4, Number.NaN], [7.45, 9.1]], points).allowed, false);
  assert.equal(cfg.allows({}), false);
  const pilot = createRidePilotConfig({ TAXI_AI_RIDES_PAUSED: 'false', TAXI_AI_RIDE_PILOT_BOUNDS: '9,7.35,9.2,7.5' }, 'staging');
  assert.equal(cfg.allows({ ridePilotCoverage: pilot.coverage(route(points), points) }), false);
});

test('authenticated clients receive pause status; valid nationwide requests do not invent a driver', async t => {
  const cfg = createRidePilotConfig(env, 'staging');
  const mapProvider = { mode: 'off', describe: () => ({ enabled: false }),
    route: async (a,b) => ({ distanceMeters: 7000, durationSeconds: 1200, coordinates: route([a,b]) }) };
  const h = await harness(t, { ridePilot: cfg, mapProvider });
  const { customer } = await participants(h, 0);
  assert.equal((await h.client().send('/api/rides')).status, 401);
  const status = await customer.send('/api/rides');
  assert.deepEqual(status.body.matchingSettings.passengerRides, { paused: false, coverage: 'nigeria' });
  const quoted = await customer.post('/api/locations/quotes', { pickup: abuja, destination: end });
  assert.equal(quoted.status, 201);
  const requested = await customer.post('/api/rides', { quoteId: quoted.body.quote.id });
  assert.equal(requested.status, 201, JSON.stringify(requested.body));
  assert.equal(requested.body.ride.status, 'requested');
  assert.equal(requested.body.ride.driver, null);
  assert.equal(h.db.prepare('SELECT COUNT(*) AS n FROM drivers').get().n, 0);
});
