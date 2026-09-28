import test from 'node:test';
import assert from 'node:assert/strict';
import { createPickupEtaProvider } from '../src/infrastructure/pickup-eta.mjs';

const from = { lat: 9.08, lng: 7.4 }, to = { lat: 9.085, lng: 7.405 };
const route = (a = from, b = to) => ({ durationSeconds: 180.1, distanceMeters: 1200.4,
  coordinates: [[a.lng, a.lat], [b.lng, b.lat]] });
const pair = { from, to };

test('pickup ETA reuses the road provider, deduplicates and caches exact directed coordinates without exposing geometry', async () => {
  let at = 1000, calls = 0, resolve;
  const provider = createPickupEtaProvider({ now: () => at, mapProvider: { route: (a, b) => {
    calls += 1; assert.deepEqual(a, from); assert.deepEqual(b, to);
    return new Promise((yes) => { resolve = yes; });
  } } });
  const first = provider.estimate(pair), second = provider.estimate(pair);
  await Promise.resolve(); resolve(route());
  const eta = await first;
  assert.deepEqual(eta, { durationSeconds: 181, distanceMeters: 1201, source: 'road', trafficAware: false, estimatedAt: 1000 });
  assert.deepEqual(await second, eta); assert.equal(calls, 1);
  eta.durationSeconds = 999;
  at += 14_999;
  assert.equal((await provider.estimate(pair)).durationSeconds, 181); assert.equal(calls, 1);
  at += 1;
  const next = provider.estimate(pair); await Promise.resolve(); resolve(route());
  assert.equal((await next).estimatedAt, at); assert.equal(calls, 2);
});

test('pickup ETA bounds cache entries and treats reverse and moved positions as different routes', async () => {
  let calls = 0;
  const provider = createPickupEtaProvider({ maxCacheEntries: 2, mapProvider: { route: async (a, b) => { calls += 1; return route(a, b); } } });
  await provider.estimate(pair);
  await provider.estimate({ from: to, to: from });
  await provider.estimate({ from: { ...from, lat: from.lat + 0.00001 }, to });
  await provider.estimate(pair);
  assert.equal(calls, 4);
});

test('pickup ETA does not fabricate routes on disabled maps, provider errors, rate limits, or invalid positions', async () => {
  for (const mapProvider of [undefined, { mode: 'off', route: () => assert.fail('must not route') },
    { route: () => { throw new Error('MAPS_BUSY, including private upstream details'); } }, { route: async () => null }]) {
    assert.equal(await createPickupEtaProvider({ mapProvider }).estimate(pair), null);
  }
  const provider = createPickupEtaProvider({ mapProvider: { route: () => assert.fail('invalid points must not reach provider') } });
  for (const bad of [undefined, null, {}, { lat: NaN, lng: 7.4 }, { lat: 91, lng: 7.4 }, { lat: 9.08, lng: 181 }]) {
    assert.equal(await provider.estimate({ from: bad, to }), null);
  }
});

test('pickup ETA rejects unverified geometry, implausible metrics, and declared straight-line substitutes', async () => {
  const badRoutes = [
    { ...route(), source: 'direct' }, { ...route(), distanceKind: 'straight_line' },
    { ...route(), coordinates: undefined }, { ...route(), coordinates: [[7.4, 9.08]] },
    { ...route(), coordinates: [[7.4, 9.08], [180, 90]] },
    { ...route(), coordinates: [[7.4, 9.08], [NaN, 9.085]] },
    { ...route(), coordinates: [[7.4, 9.08, 0], [7.405, 9.085]] },
    { ...route(), durationSeconds: NaN }, { ...route(), durationSeconds: -1 },
    { ...route(), durationSeconds: 14_401 }, { ...route(), durationSeconds: 0 },
    { ...route(), durationSeconds: 1 }, { ...route(), distanceMeters: 120_001 },
    { ...route(), distanceMeters: -1 }, { ...route(), distanceMeters: 1 },
  ];
  for (const raw of badRoutes) assert.equal(await createPickupEtaProvider({ mapProvider: { route: async () => raw } }).estimate(pair), null);
  const samePoint = createPickupEtaProvider({ mapProvider: { route: async () => ({ ...route(from, from), durationSeconds: 0, distanceMeters: 0 }) } });
  assert.equal((await samePoint.estimate({ from, to: from })).durationSeconds, 0);
});

test('pickup ETA suppresses repeated provider failures until the short failure cache expires', async () => {
  let calls = 0, at = 1000;
  const provider = createPickupEtaProvider({ now: () => at, mapProvider: { route: async () => { calls += 1; throw new Error('unavailable'); } } });
  assert.equal(await provider.estimate(pair), null);
  at += 1499; assert.equal(await provider.estimate(pair), null); assert.equal(calls, 1);
  at += 1; assert.equal(await provider.estimate(pair), null); assert.equal(calls, 2);
});

test('pickup ETA bounds concurrency and returns promptly on timeout while retaining the upstream slot', async () => {
  let resolve, calls = 0;
  const provider = createPickupEtaProvider({ maxConcurrent: 1, timeoutMs: 15, mapProvider: { route: () => {
    calls += 1; return new Promise((yes) => { resolve = yes; });
  } } });
  const first = provider.estimate(pair);
  assert.equal(await provider.estimate({ from: to, to: from }), null);
  assert.equal(await first, null);
  assert.equal(await provider.estimate({ from: to, to: from }), null);
  assert.equal(calls, 1);
  resolve(route()); await new Promise((yes) => setImmediate(yes));
  const next = provider.estimate({ from: to, to: from });
  await Promise.resolve(); assert.equal(calls, 2); resolve(route(to, from));
  assert.equal((await next).source, 'road');
});

test('pickup ETA validates resource limits at startup', () => {
  for (const options of [{ maxConcurrent: 0 }, { maxConcurrent: 9 }, { maxCacheEntries: 0 }, { maxCacheEntries: 1025 },
    { timeoutMs: 0 }, { timeoutMs: 8001 }, { cacheMs: 60_001 }, { failureCacheMs: 10_001 }]) {
    assert.throws(() => createPickupEtaProvider(options), /pickup ETA limits/);
  }
});

const tableRow = ({ from: a, to: b }) => ({ durationSeconds: 180, distanceMeters: 1200, source: 'osrm-table',
  snappedFrom: [a.lng, a.lat], snappedTo: [b.lng, b.lat] });
test('pickup ETA batches uncached pairs, preserves individual failures and shares cache with single estimates', async () => {
  let resolve, calls = 0;
  const reverse = { from: to, to: from };
  const provider = createPickupEtaProvider({ mapProvider: { route: () => assert.fail('cached estimate should not route'),
    pickupEstimates: (pairs) => {
      calls += 1; assert.deepEqual(pairs, [pair, reverse]);
      return new Promise((yes) => { resolve = yes; });
    } } });
  const batch = provider.estimateMany([pair, reverse, pair, { from: null, to }]);
  const single = provider.estimate(pair);
  await Promise.resolve(); resolve([tableRow(pair), null]);
  const results = await batch;
  assert.equal(calls, 1); assert.equal(results[0].source, 'road');
  assert.equal(results[1], null); assert.deepEqual(results[2], results[0]); assert.equal(results[3], null);
  assert.deepEqual(await single, results[0]);
  assert.deepEqual(await provider.estimateMany([pair, reverse]), results.slice(0, 2));
  assert.equal(calls, 1);
});

test('pickup ETA limits new matrix pairs and rejects invalid snapped endpoints individually', async () => {
  const pairs = Array.from({ length: 20 }, (_, i) => ({ from: { ...from, lat: from.lat + i * 0.00001 }, to }));
  const provider = createPickupEtaProvider({ mapProvider: { pickupEstimates: async (selected) => {
    assert.equal(selected.length, 16);
    return selected.map((item, i) => i === 1 ? { ...tableRow(item), snappedTo: [180, 90] } : tableRow(item));
  } } });
  const result = await provider.estimateMany(pairs);
  assert.equal(result.length, 20);
  assert.equal(result.filter(Boolean).length, 15);
  assert.equal(result[1], null); assert.deepEqual(result.slice(16), [null, null, null, null]);
});

test('pickup ETA matrix failure and timeout return null for all affected pairs without leaking provider errors', async () => {
  const reverse = { from: to, to: from };
  for (const pickupEstimates of [() => { throw new Error('private provider response'); }, () => new Promise(() => {})]) {
    const provider = createPickupEtaProvider({ timeoutMs: 10, mapProvider: { pickupEstimates } });
    assert.deepEqual(await provider.estimateMany([pair, reverse]), [null, null]);
  }
});
