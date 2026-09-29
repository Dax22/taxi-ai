import test from 'node:test';
import assert from 'node:assert/strict';
import { createMapProvider } from '../src/infrastructure/map-provider.mjs';

const env = { TAXI_AI_MAPS_MODE: 'dedicated', TAXI_AI_SEARCH_URL: 'https://search.example.test/api/',
  TAXI_AI_ROUTING_URL: 'https://router.example.test/route/v1/driving/', TAXI_AI_TILE_URL: 'https://tiles.example.test/{z}/{x}/{y}.png' };
const bounds = { west: 2, south: 4, east: 15, north: 14 };

test('dedicated routing requires explicit endpoints and cannot raise community quotas', () => {
  assert.throws(() => createMapProvider({ env: { TAXI_AI_MAPS_MODE: 'dedicated' } }));
  assert.throws(() => createMapProvider({ env: { TAXI_AI_MAPS_REQUESTS_PER_SECOND: '20' } }));
  assert.throws(() => createMapProvider({ env: { ...env, TAXI_AI_ROUTING_URL: 'https://router.project-osrm.org/route/v1/driving/' } }));
  assert.throws(() => createMapProvider({ env: { ...env, TAXI_AI_MAPS_API_KEY: 'secret\r\nHeader: injection' } }));
  assert.equal(createMapProvider({ env }).maxPickupPairs, 64);
});

test('dedicated requests enforce shared per-process rate and concurrency budgets without leaking credentials', async () => {
  let at = 1000;
  const requests = [];
  const provider = createMapProvider({ env: { ...env, TAXI_AI_MAPS_REQUESTS_PER_SECOND: '3', TAXI_AI_MAPS_MAX_CONCURRENT: '2', TAXI_AI_MAPS_API_KEY: 'test-key' },
    now: () => at, fetchImpl: (url, options) => new Promise((resolve) => requests.push({ url, options, resolve })) });
  const first = provider.search('one', bounds), second = provider.search('two', bounds);
  assert.equal(requests.length, 2);
  await assert.rejects(provider.search('three', bounds), { code: 'MAPS_BUSY' });
  requests[0].resolve(Response.json({ features: [] })); await first;
  const third = provider.search('three', bounds);
  requests[1].resolve(Response.json({ features: [] })); requests[2].resolve(Response.json({ features: [] })); await Promise.all([second, third]);
  await assert.rejects(provider.search('four', bounds), { code: 'MAPS_BUSY' });
  assert.equal(requests[0].options.headers.Authorization, 'Bearer test-key');
  assert.equal(JSON.stringify(provider.describe()).includes('test-key'), false);
  at += 1000;
  const fourth = provider.search('four', bounds); requests[3].resolve(Response.json({ features: [] })); await fourth;
});
