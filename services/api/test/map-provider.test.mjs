import test from 'node:test';
import assert from 'node:assert/strict';
import { createMapProvider } from '../src/infrastructure/map-provider.mjs';
import { NIGERIA_BOUNDS } from '../../../packages/shared/src/locations.mjs';
const bounds = NIGERIA_BOUNDS;
const places = { features: [{ geometry: { type: 'Point', coordinates: [7.4, 9.08] }, properties: { name: 'Wuse', city: 'Abuja' } }] };
test('Photon search encodes and bounds user text, deduplicates inflight work, caches and rate limits all accounts together', async () => {
  let now = 1000, resolve;
  const requests = [];
  const provider = createMapProvider({ env: {}, now: () => now, fetchImpl: (url, options) => {
    requests.push({ url, options }); return new Promise((yes) => { resolve = yes; });
  } });
  const first = provider.search('Wuse & cafe', bounds), second = provider.search('Wuse & cafe', bounds);
  resolve(Response.json(places));
  assert.deepEqual(await first, await second); assert.equal(requests.length, 1);
  await provider.search('Wuse & cafe', bounds); assert.equal(requests.length, 1);
  assert.equal(requests[0].url.searchParams.get('q'), 'Wuse & cafe');
  assert.equal(requests[0].url.searchParams.get('bbox'), `${bounds.west},${bounds.south},${bounds.east},${bounds.north}`);
  assert.equal(requests[0].url.searchParams.get('countrycode'), 'NG');
  assert.match(requests[0].options.headers['User-Agent'], /TaxiAi/); assert.equal(requests[0].options.redirect, 'error');
  await assert.rejects(provider.search('Maitama', bounds), { code: 'MAPS_BUSY' });
  now += 1100; const third = provider.search('Maitama', bounds); resolve(Response.json(places)); await third;
  assert.equal(requests.length, 2);
});
test('Nigeria search keeps nationwide results and rejects foreign country metadata before domain coordinate validation', async () => {
  const feature = (name, lat, lng, countrycode = 'NG') => ({ geometry: { type: 'Point', coordinates: [lng, lat] }, properties: { name, countrycode } });
  let searched;
  const provider = createMapProvider({ env: {}, fetchImpl: async (url) => {
    searched = url;
    return Response.json({ features: [feature('Lagos', 6.5244, 3.3792), feature('Kano', 12.0022, 8.592),
      feature('Port Harcourt', 4.8156, 7.0498), feature('Cotonou', 6.3703, 2.3912, 'BJ'),
      feature('Maroua', 10.591, 14.3159, 'CM'), feature('Wrong country label', 9.0765, 7.3986, 'CM')] });
  } });
  assert.deepEqual((await provider.search('town', bounds)).map((p) => p.name), ['Lagos', 'Kano', 'Port Harcourt']);
  assert.equal(searched.searchParams.get('countrycode'), 'NG');
  assert.equal(searched.searchParams.get('bbox'), `${bounds.west},${bounds.south},${bounds.east},${bounds.north}`);
});
test('OSRM uses car routes, bounded snapping and GeoJSON; upstream failures never become fictional road routes', async () => {
  let url;
  const provider = createMapProvider({ env: {}, fetchImpl: async (value) => { url = value; return Response.json({ code: 'Ok', routes: [{ distance: 5000, duration: 600,
    geometry: { type: 'LineString', coordinates: [[7.4, 9.08], [7.45, 9.1]] } }] }); } });
  const result = await provider.route({ lat: 9.08, lng: 7.4 }, { lat: 9.1, lng: 7.45 });
  assert.equal(result.distanceMeters, 5000); assert.equal(result.durationSeconds, 600);
  assert.match(url.pathname, /routed-car\/route\/v1\/driving\/7.4,9.08;7.45,9.1$/);
  assert.equal(url.searchParams.get('radiuses'), '250;250'); assert.equal(url.searchParams.get('geometries'), 'geojson');
  for (const fetchImpl of [async () => new Response('bad', { status: 503 }), async () => new Response('not-json'),
    async () => new Response('x'.repeat(1_000_001)), async () => { throw new Error('private upstream details'); }]) {
    await assert.rejects(createMapProvider({ env: {}, fetchImpl }).search('Wuse', bounds), (error) => error.code === 'MAPS_UNAVAILABLE' && !error.message.includes('private upstream'));
  }
  await assert.rejects(createMapProvider({ env: { TAXI_AI_MAPS_MODE: 'off' }, fetchImpl: () => { throw new Error('must not fetch'); } }).search('Wuse', bounds), { code: 'MAPS_UNAVAILABLE' });
  assert.throws(() => createMapProvider({ env: { TAXI_AI_SEARCH_URL: 'https://user:secret@example.test/api' } }));
  assert.throws(() => createMapProvider({ env: { TAXI_AI_TILE_URL: 'javascript:alert(1)' } }));
});
