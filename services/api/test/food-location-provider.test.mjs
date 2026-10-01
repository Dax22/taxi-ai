import test from 'node:test';
import assert from 'node:assert/strict';
import { createFoodLocationProvider as createProvider } from '../src/infrastructure/food-location-provider.mjs';
import { insideNigeria, distanceMeters } from '../../../packages/shared/src/locations.mjs';
import { NIGERIAN_STATES, foodAreaId } from '../../../packages/shared/src/nigeria-areas.mjs';

const createFoodLocationProvider = (options) => createProvider({ insideNigeria, distanceMeters, foodAreaId, states: NIGERIAN_STATES, ...options });

const point = { lat: 9.08, lng: 7.4 };
const empty = (pin = point) => ({ point: pin, line: '', areaId: null, attribution: '' });
const feature = (properties = {}, location = point) => ({ type: 'Feature', geometry: { type: 'Point', coordinates: [location.lng, location.lat] },
  properties: { countrycode: 'NG', state: 'Federal Capital Territory', district: 'Wuse II', city: 'Abuja',
    street: 'Adetokunbo Ademola Crescent', housenumber: '12', ...properties } });
const response = (...features) => Response.json({ type: 'FeatureCollection', features });

test('food reverse lookup runs only when invoked, uses Photon reverse parameters and preserves the requested pin', async () => {
  const calls = [];
  const provider = createFoodLocationProvider({ env: {}, fetchImpl: async (url, options) => {
    calls.push({ url, options }); return response(feature({}, { lat: 9.0801, lng: 7.4001 }));
  } });
  assert.equal(calls.length, 0);
  const result = await provider.resolveDeliveryLocation({ lat: 9.08000001, lng: 7.40000001 });
  assert.equal(calls.length, 1); assert.equal(calls[0].url.origin, 'https://photon.komoot.io');
  assert.equal(calls[0].url.pathname, '/reverse');
  assert.deepEqual(Object.fromEntries(calls[0].url.searchParams), { lat: '9.08', lon: '7.4', radius: '0.2', limit: '5', lang: 'en' });
  assert.equal(calls[0].options.redirect, 'error'); assert.equal(calls[0].options.headers.Authorization, undefined);
  assert.deepEqual(result, { point, line: '12 Adetokunbo Ademola Crescent, Wuse II, Abuja, Federal Capital Territory',
    areaId: 'wuse-ii', attribution: '© OpenStreetMap contributors · Photon' });
  assert.equal(Object.hasOwn(result, 'home'), false);
});

test('reverse suggestions resolve actual provider state and locality without substituting a capital or nearby POI', async () => {
  for (const [properties, areaId, line] of [
    [{ state: 'Lagos State', district: 'Ikeja', city: 'Lagos' }, 'ng:lagos:ikeja', 'Ikeja, Lagos'],
    [{ state: 'Rivers', district: undefined, city: 'Port Harcourt' }, 'ng:rivers:port%20harcourt', 'Port Harcourt, Rivers'],
    [{ state: 'Ogun', district: undefined, city: undefined, locality: 'Sagamu' }, 'ng:ogun:sagamu', 'Sagamu, Ogun'],
    [{ state: 'Oyo', district: undefined, city: undefined }, null, 'Oyo'],
    [{ state: 'Unknown State', district: 'Ikeja', city: undefined }, null, 'Ikeja, Unknown State'],
  ]) {
    const provider = createFoodLocationProvider({ env: {}, fetchImpl: async () => response(feature({
      ...properties, street: undefined, housenumber: '99', name: 'Nearby private residence',
    })) });
    const result = await provider.resolveDeliveryLocation(point);
    assert.equal(result.areaId, areaId); assert.equal(result.line, line);
    assert.doesNotMatch(result.line, /Nearby private residence|99|Ibadan/);
  }
});

test('reverse lookup returns manual-entry defaults when disabled or dedicated reverse service is absent', async () => {
  for (const env of [{ TAXI_AI_MAPS_MODE: 'off' }, { TAXI_AI_MAPS_MODE: 'dedicated' },
    { TAXI_AI_MAPS_MODE: 'dedicated', TAXI_AI_REVERSE_URL: '' }]) {
    const provider = createFoodLocationProvider({ env, fetchImpl: () => assert.fail('manual entry must not contact a provider') });
    assert.equal(provider.enabled, false); assert.deepEqual(await provider.resolveDeliveryLocation(point), empty());
  }
});

test('dedicated reverse lookup uses only its configured origin and bearer credential', async () => {
  const provider = createFoodLocationProvider({ env: { TAXI_AI_MAPS_MODE: 'dedicated',
    TAXI_AI_REVERSE_URL: 'https://maps.example.test/photon/reverse', TAXI_AI_MAPS_API_KEY: 'dedicated-secret' },
  fetchImpl: async (url, options) => {
    assert.equal(url.origin, 'https://maps.example.test'); assert.equal(url.pathname, '/photon/reverse');
    assert.equal(options.headers.Authorization, 'Bearer dedicated-secret'); return response(feature());
  } });
  assert.equal((await provider.resolveDeliveryLocation(point)).areaId, 'wuse-ii');
  for (const value of ['https://photon.komoot.io/reverse', 'https://other.openstreetmap.org/reverse']) {
    assert.throws(() => createFoodLocationProvider({ env: { TAXI_AI_MAPS_MODE: 'dedicated', TAXI_AI_REVERSE_URL: value } }), /community/);
  }
});

test('reverse configuration rejects unsafe endpoints, credentials and unbounded resource limits', () => {
  for (const value of ['http://maps.example.test/reverse', 'file:///tmp/address', 'https://user:secret@maps.example.test/reverse',
    'https://maps.example.test/reverse?fixed=1', 'https://maps.example.test/reverse#fragment']) {
    assert.throws(() => createFoodLocationProvider({ env: { TAXI_AI_REVERSE_URL: value } }));
  }
  for (const options of [{ timeoutMs: 0 }, { timeoutMs: 8001 }, { maxConcurrent: 0 }, { maxConcurrent: 9 }]) {
    assert.throws(() => createFoodLocationProvider({ env: {}, ...options }), /supported limits/);
  }
  for (const env of [{ TAXI_AI_MAPS_MODE: 'unknown' }, { TAXI_AI_MAPS_API_KEY: 'secret' },
    { TAXI_AI_MAPS_MODE: 'dedicated', TAXI_AI_MAPS_API_KEY: 'secret\nheader' }]) {
    assert.throws(() => createFoodLocationProvider({ env }));
  }
  assert.equal(createFoodLocationProvider({ env: { TAXI_AI_MAPS_MODE: 'dedicated', TAXI_AI_REVERSE_URL: 'http://127.0.0.1:2322/reverse' } }).enabled, true);
});

test('reverse lookup rejects outside-Nigeria or invalid points before contacting any provider', async () => {
  const provider = createFoodLocationProvider({ env: {}, fetchImpl: () => assert.fail('invalid input must not be sent') });
  for (const value of [undefined, null, [], {}, { lat: '9.08', lng: 7.4 }, { lat: NaN, lng: 7.4 },
    { lat: 41.8781, lng: -87.6298 }, { lat: 6.37, lng: 2.39 }]) {
    await assert.rejects(provider.resolveDeliveryLocation(value), { code: 'INVALID_LOCATION' });
  }
});

test('reverse lookup does not treat foreign, distant or malformed provider results as a delivery address', async () => {
  const invalidFeatures = [feature({ countrycode: 'US' }), feature({ countrycode: undefined }),
    feature({}, { lat: 9.09, lng: 7.41 }), { ...feature(), geometry: { type: 'Point', coordinates: ['7.4', 9.08] } },
    { ...feature(), geometry: { type: 'LineString', coordinates: [[7.4, 9.08], [7.401, 9.081]] } },
    feature({ state: '<script>bad()</script>', district: '\u0000bad', city: '\u202ebad', street: '<img src=x>', housenumber: '9' })];
  for (const bad of invalidFeatures) {
    const provider = createFoodLocationProvider({ env: {}, fetchImpl: async () => response(bad) });
    assert.deepEqual(await provider.resolveDeliveryLocation(point), empty());
  }
});

test('reverse lookup chooses the closest valid suggestion but never replaces the user pin with a provider point', async () => {
  const provider = createFoodLocationProvider({ env: {}, fetchImpl: async () => response(
    feature({ district: 'Maitama' }, { lat: 9.081, lng: 7.4 }),
    feature({ district: 'Garki' }, { lat: 9.0801, lng: 7.4 }),
    feature({ district: 'Wrong', countrycode: 'BJ' }),
  ) });
  const result = await provider.resolveDeliveryLocation(point);
  assert.equal(result.areaId, 'garki'); assert.deepEqual(result.point, point);
});

test('reverse provider errors, invalid JSON, oversize bodies and empty results preserve manual entry', async () => {
  for (const fetchImpl of [async () => { throw new Error('private upstream credentials'); },
    async () => new Response('denied', { status: 403 }), async () => new Response('not json'),
    async () => new Response('x'.repeat(128_001)), async () => Response.json({ type: 'Point', features: [feature()] }),
    async () => Response.json({ features: {} }), async () => response()]) {
    const provider = createFoodLocationProvider({ env: {}, fetchImpl });
    assert.deepEqual(await provider.resolveDeliveryLocation(point), empty());
  }
});

test('reverse lookup has an independent rate limit and does not cache coordinates or address suggestions', async () => {
  let now = 0, calls = 0;
  const provider = createFoodLocationProvider({ env: {}, now: () => now, fetchImpl: async () => {
    calls += 1; return response(feature({ housenumber: String(calls) }));
  } });
  assert.match((await provider.resolveDeliveryLocation(point)).line, /^1 /);
  now = 1099; assert.deepEqual(await provider.resolveDeliveryLocation(point), empty()); assert.equal(calls, 1);
  now = 1100; assert.match((await provider.resolveDeliveryLocation(point)).line, /^2 /); assert.equal(calls, 2);
});

test('reverse lookup returns promptly on timeout and retains the bounded slot for an unresponsive adapter', async () => {
  let now = 0, calls = 0, release, signal;
  const provider = createFoodLocationProvider({ env: {}, timeoutMs: 10, maxConcurrent: 1, now: () => now,
    fetchImpl: async (_url, options) => {
      calls += 1; signal = options.signal;
      return await new Promise((resolve) => { release = resolve; });
    } });
  assert.deepEqual(await provider.resolveDeliveryLocation(point), empty()); assert.equal(signal.aborted, true);
  now = 1100; assert.deepEqual(await provider.resolveDeliveryLocation(point), empty()); assert.equal(calls, 1);
  release(response(feature())); await new Promise((resolve) => setImmediate(resolve));
  const next = provider.resolveDeliveryLocation(point); await Promise.resolve();
  release(response(feature())); assert.equal((await next).areaId, 'wuse-ii'); assert.equal(calls, 2);
});
