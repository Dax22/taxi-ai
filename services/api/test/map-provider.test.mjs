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
test('OSRM pickup table uses configured routing origin and shared rate limit, and never accepts fallback-speed cells', async () => {
  let now = 1000;
  const calls = [], pairs = [
    { from: { lat: 9.08, lng: 7.4 }, to: { lat: 9.085, lng: 7.405 } },
    { from: { lat: 9.081, lng: 7.401 }, to: { lat: 9.086, lng: 7.406 } },
    { from: { lat: 9.082, lng: 7.402 }, to: { lat: 9.087, lng: 7.407 } },
  ];
  const provider = createMapProvider({ now: () => now, env: { TAXI_AI_ROUTING_URL: 'https://maps.example.test/routed-car/route/v1/driving/' },
    fetchImpl: async (url) => {
      calls.push(url);
      return Response.json({ code: 'Ok', durations: [[180, 220, 300], [160, null, 400], [170, 210, 300]],
        distances: [[1200, 1400, 2000], [1100, null, 2400], [1150, 1300, 1800]], fallback_speed_cells: [[2, 2]],
        sources: pairs.map(({ from }) => ({ location: [from.lng, from.lat] })),
        destinations: pairs.map(({ to }) => ({ location: [to.lng, to.lat] })) });
    } });
  const results = await provider.pickupEstimates(pairs);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].origin, 'https://maps.example.test');
  assert.match(calls[0].pathname, /^\/routed-car\/table\/v1\/driving\//);
  assert.equal(calls[0].searchParams.get('sources'), '0;2;4');
  assert.equal(calls[0].searchParams.get('destinations'), '1;3;5');
  assert.equal(calls[0].searchParams.get('annotations'), 'duration,distance');
  assert.equal(calls[0].searchParams.get('radiuses'), '250;250;250;250;250;250');
  assert.equal(calls[0].searchParams.has('fallback_speed'), false);
  assert.deepEqual(results, [{ durationSeconds: 180, distanceMeters: 1200, source: 'osrm-table',
    snappedFrom: [7.4, 9.08], snappedTo: [7.405, 9.085] }, null, null]);
  assert.deepEqual(await provider.pickupEstimates(pairs), results); assert.equal(calls.length, 1);
  await assert.rejects(provider.route(pairs[0].from, pairs[0].to), { code: 'MAPS_BUSY' });
  now += 15_000; await provider.pickupEstimates(pairs); assert.equal(calls.length, 2);
});
test('OSRM pickup table bounds work and rejects unsupported endpoints or malformed tables', async () => {
  let calls = 0;
  const pair = { from: { lat: 9.08, lng: 7.4 }, to: { lat: 9.085, lng: 7.405 } };
  const provider = createMapProvider({ fetchImpl: async () => { calls += 1; return Response.json({ code: 'Ok' }); } });
  for (const pairs of [[], Array(17).fill(pair), [{ ...pair, from: { lat: NaN, lng: 7.4 } }]]) {
    await assert.rejects(provider.pickupEstimates(pairs), { code: 'INVALID_ROUTE' });
  }
  assert.equal(calls, 0);
  await assert.rejects(provider.pickupEstimates([pair]), { code: 'MAPS_UNAVAILABLE' });
  await assert.rejects(createMapProvider({ env: { TAXI_AI_ROUTING_URL: 'https://maps.example.test/custom/' },
    fetchImpl: () => assert.fail('unsupported table URL must not be queried') }).pickupEstimates([pair]), { code: 'MAPS_UNAVAILABLE' });
});

test('compact pickup tables preserve directed pair order across shared endpoints and duplicate pairs', async () => {
  const a = { lat: 9.08, lng: 7.4 }, b = { lat: 9.081, lng: 7.401 }, c = { lat: 9.085, lng: 7.405 };
  const nearA = { ...a, lat: a.lat + 0.00000001 };
  const pairs = [{ from: a, to: c }, { from: b, to: a }, { from: a, to: a },
    { from: b, to: c }, { from: { ...a }, to: { ...c } }, { from: nearA, to: c }];
  let request;
  const provider = createMapProvider({ env: {}, compactPickupTables: true, fetchImpl: async (url) => {
    request = url;
    return Response.json({ code: 'Ok', durations: [[10, 11], [20, 21], [30, 31]], distances: [[100, 110], [200, 210], [300, 310]],
      sources: [a, b, nearA].map((p) => ({ location: [p.lng, p.lat] })),
      destinations: [c, a].map((p) => ({ location: [p.lng, p.lat] })) });
  } });
  const result = await provider.pickupEstimates(pairs);
  assert.equal(request.pathname.split('/').at(-1), [a, c, b, nearA].map((p) => `${p.lng},${p.lat}`).join(';'));
  assert.equal(request.searchParams.get('sources'), '0;2;3');
  assert.equal(request.searchParams.get('destinations'), '1;0');
  assert.equal(request.searchParams.get('radiuses'), '250;250;250;250');
  assert.deepEqual(result.map((r) => r.durationSeconds), [10, 21, 11, 20, 10, 30]);
  assert.deepEqual(result.map((r) => r.distanceMeters), [100, 210, 110, 200, 100, 300]);
  for (const [index, pair] of pairs.entries()) {
    assert.deepEqual(result[index].snappedFrom, [pair.from.lng, pair.from.lat]);
    assert.deepEqual(result[index].snappedTo, [pair.to.lng, pair.to.lat]);
  }
  result[0].snappedFrom[0] = 0;
  assert.equal(result[4].snappedFrom[0], a.lng);
  assert.throws(() => createMapProvider({ compactPickupTables: 'true' }), /must be a boolean/);
});

test('compact pickup table requests 32 cells for 32 drivers sharing one pickup while retaining pair budgets', async () => {
  const to = { lat: 9.085, lng: 7.405 };
  const pairs = Array.from({ length: 32 }, (_, i) => ({ from: { lat: 9.08 + i * 0.00001, lng: 7.4 }, to }));
  let calls = 0;
  const provider = createMapProvider({ compactPickupTables: true, env: { TAXI_AI_MAPS_MODE: 'dedicated',
    TAXI_AI_SEARCH_URL: 'https://maps.example.test/search/', TAXI_AI_ROUTING_URL: 'https://maps.example.test/route/v1/driving/',
    TAXI_AI_TILE_URL: 'https://tiles.example.test/{z}/{x}/{y}.png' }, fetchImpl: async (url) => {
    calls += 1;
    const points = url.pathname.split('/').at(-1).split(';');
    const sources = url.searchParams.get('sources').split(';'), destinations = url.searchParams.get('destinations').split(';');
    assert.equal(points.length, 33); assert.equal(sources.length, 32); assert.deepEqual(destinations, ['1']);
    assert.equal(sources.length * destinations.length, 32);
    return Response.json({ code: 'Ok', durations: pairs.map((_, i) => [180 + i]), distances: pairs.map(() => [1200]),
      sources: pairs.map(({ from }) => ({ location: [from.lng, from.lat] })), destinations: [{ location: [to.lng, to.lat] }] });
  } });
  assert.deepEqual((await provider.pickupEstimates(pairs)).map((r) => r.durationSeconds), pairs.map((_, i) => 180 + i));
  await assert.rejects(provider.pickupEstimates(Array(65).fill(pairs[0])), { code: 'INVALID_ROUTE' });
  assert.equal(calls, 1);
});

test('compact pickup tables use matrix positions for null routes and fallback cells, not global coordinate indices', async () => {
  const a = { lat: 9.08, lng: 7.4 }, b = { lat: 9.081, lng: 7.401 }, c = { lat: 9.085, lng: 7.405 };
  const pairs = [{ from: a, to: c }, { from: b, to: a }, { from: a, to: a }, { from: b, to: c }];
  const provider = createMapProvider({ env: {}, compactPickupTables: true, fetchImpl: async () => Response.json({
    code: 'Ok', durations: [[10, null], [20, 21]], distances: [[100, null], [200, 210]], fallback_speed_cells: [[1, 0]],
    sources: [a, b].map((p) => ({ location: [p.lng, p.lat] })), destinations: [c, a].map((p) => ({ location: [p.lng, p.lat] })),
  }) });
  const result = await provider.pickupEstimates(pairs);
  assert.deepEqual(result.map((r) => r?.durationSeconds ?? null), [10, 21, null, null]);
});

test('compact pickup tables reject malformed dimensions and fallback metadata, and never coerce invalid metrics', async () => {
  const from = { lat: 9.08, lng: 7.4 }, to = { lat: 9.085, lng: 7.405 }, pair = { from, to };
  const table = { code: 'Ok', durations: [[180]], distances: [[1200]],
    sources: [{ location: [from.lng, from.lat] }], destinations: [{ location: [to.lng, to.lat] }] };
  const provider = (patch) => createMapProvider({ env: {}, compactPickupTables: true,
    fetchImpl: async () => Response.json({ ...table, ...patch }) });
  for (const patch of [{ durations: [] }, { durations: [{ 0: 180 }] }, { durations: [[180, 1]] },
    { distances: [[1200], [1200]] }, { sources: [] }, { destinations: [] }, { fallback_speed_cells: {} },
    { fallback_speed_cells: [[0, 1]] }, { fallback_speed_cells: [[0.5, 0]] }, { fallback_speed_cells: [[0, 0, 0]] }]) {
    await assert.rejects(provider(patch).pickupEstimates([pair]), { code: 'MAPS_UNAVAILABLE' });
  }
  for (const patch of [{ durations: [[null]] }, { durations: [['180']] }, { durations: [[-1]] },
    { distances: [[null]] }, { distances: [['1200']] }, { distances: [[-1]] },
    { sources: [{ location: [7.4, 91] }] }, { destinations: [{ location: [7.405, 9.085, 0] }] },
    { fallback_speed_cells: [[0, 0]] }]) {
    assert.deepEqual(await provider(patch).pickupEstimates([pair]), [null]);
  }
});

test('compact coincident pickup endpoints retain a valid two-location request and zero road metrics', async () => {
  const point = { lat: 9.08, lng: 7.4 };
  const provider = createMapProvider({ env: {}, compactPickupTables: true, fetchImpl: async (url) => {
    assert.equal(url.pathname.split('/').at(-1), '7.4,9.08;7.4,9.08');
    assert.equal(url.searchParams.get('sources'), '0'); assert.equal(url.searchParams.get('destinations'), '0');
    return Response.json({ code: 'Ok', durations: [[0]], distances: [[0]],
      sources: [{ location: [7.4, 9.08] }], destinations: [{ location: [7.4, 9.08] }] });
  } });
  const result = await provider.pickupEstimates([{ from: point, to: point }, { from: point, to: point }]);
  assert.deepEqual(result.map((r) => [r.durationSeconds, r.distanceMeters]), [[0, 0], [0, 0]]);
});
