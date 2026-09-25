import test from 'node:test';
import assert from 'node:assert/strict';
import { allocateDispatchOffers, boundedDispatchCandidates, DISPATCH_POLICY } from '../src/dispatch.mjs';

const now = 1_000_000;
const edge = (driverId, rideId, pickupEtaSeconds, ageMs = 0, distanceMeters = 1000) => ({
  driverId, rideId, pickupEtaSeconds, distanceMeters, createdAt: now - ageMs, expiresAt: now + 300_000 - ageMs,
});
const pairs = (offers) => offers.map((o) => `${o.driverId}:${o.rideId}`).sort();

test('batch minimizes total pickup cost instead of taking the locally nearest pairing', () => {
  const candidates = [edge('d1', 'r1', 120), edge('d1', 'r2', 180), edge('d2', 'r1', 240), edge('d2', 'r2', 720)];
  const greedy = allocateDispatchOffers(candidates, now);
  const batch = allocateDispatchOffers(candidates, now, { mode: 'batch' });
  assert.deepEqual(pairs(greedy), ['d1:r1', 'd2:r2']);
  assert.deepEqual(pairs(batch), ['d1:r2', 'd2:r1']);
  assert.equal(batch.reduce((sum, offer) => sum + offer.pickupEtaSeconds, 0), 7 * 60);
  assert.equal(batch[0].dispatch.algorithm, 'min_cost_max_flow');
});

test('batch maximizes the number of matches before minimizing their cost', () => {
  const candidates = [edge('d1', 'r1', 10), edge('d1', 'r2', 2000), edge('d2', 'r1', 2000)];
  assert.equal(allocateDispatchOffers(candidates, now).length, 1);
  assert.deepEqual(pairs(allocateDispatchOffers(candidates, now, { mode: 'batch' })), ['d1:r2', 'd2:r1']);
});

test('road estimates control ranking despite contradictory straight-line distances', () => {
  const offers = allocateDispatchOffers([edge('near', 'r1', 500, 0, 20), edge('fast', 'r1', 120, 0, 3000)], now);
  assert.deepEqual(pairs(offers), ['fast:r1']);
  assert.deepEqual(offers[0].dispatch.reasons, ['road_pickup_eta']);
  assert.equal(offers[0].dispatch.etaSource, 'road');
  assert.equal(offers[0].offerExpiresAt, now + 20_000);
});

test('fallbacks remain explicit and never publish a heuristic as a road ETA', () => {
  const candidates = [edge('road', 'r1', 200), edge('fallback', 'r1', null, 0, 10)];
  assert.deepEqual(pairs(allocateDispatchOffers(candidates, now)), ['road:r1']);
  const distance = allocateDispatchOffers([edge('d', 'r', null)], now)[0];
  const sample = allocateDispatchOffers([edge('d', 'r', null, 0, null)], now)[0];
  assert.equal(distance.pickupEtaSeconds, null);
  assert.equal(distance.dispatch.etaSource, 'distance_fallback');
  assert.equal(sample.pickupEtaSeconds, null);
  assert.deepEqual(sample.dispatch.reasons, ['sample_area']);
  assert.equal(sample.dispatch.etaSource, 'sample');
  for (const offer of [distance, sample]) {
    assert.equal(Object.hasOwn(offer, 'score'), false);
    assert.equal(Object.hasOwn(offer.dispatch, 'cost'), false);
  }
});

test('waiting credit and two-minute priority stop fresh nearby rides always winning', () => {
  const candidates = [edge('d', 'new', 30), edge('d', 'older', 600, 120_000)];
  for (const mode of ['sequential', 'batch']) {
    const chosen = allocateDispatchOffers(candidates, now, { mode });
    assert.deepEqual(pairs(chosen), ['d:older']);
    assert.deepEqual(chosen[0].dispatch.reasons, ['road_pickup_eta', 'waiting_priority']);
  }
  assert.deepEqual(pairs(allocateDispatchOffers([edge('d', 'new', 90), edge('d', 'waiting', 100, 30_000)], now)), ['d:waiting']);
});

test('expired, malformed and out-of-policy edges are excluded without mutation', () => {
  const good = edge('d', 'r', 30);
  const input = [null, { ...good, driverId: '' }, { ...good, rideId: 123 }, { ...good, createdAt: now + 1 },
    { ...good, expiresAt: now }, { ...good, pickupEtaSeconds: NaN }, { ...good, pickupEtaSeconds: Infinity },
    { ...good, pickupEtaSeconds: -1 }, { ...good, pickupEtaSeconds: undefined },
    { ...good, pickupEtaSeconds: DISPATCH_POLICY.maxPickupEtaSeconds + 1 },
    { ...good, distanceMeters: -1 }, { ...good, distanceMeters: Infinity },
    { ...good, distanceMeters: undefined }, { ...good, distanceMeters: DISPATCH_POLICY.maxDistanceMeters + 1 }, good];
  const before = structuredClone(input);
  assert.deepEqual(pairs(allocateDispatchOffers(input, now)), ['d:r']);
  assert.deepEqual(input, before);
  assert.throws(() => allocateDispatchOffers([], NaN), /server time/);
  assert.throws(() => allocateDispatchOffers([], Number.MAX_SAFE_INTEGER), /server time/);
  assert.throws(() => allocateDispatchOffers({}, now), /array/);
  assert.throws(() => allocateDispatchOffers([], now, { mode: 'invented' }), /mode/);
});

test('offer lifetime never extends the underlying request lifetime', () => {
  const result = allocateDispatchOffers([edge('d', 'r', 30, 299_999)], now);
  assert.equal(result[0].offerExpiresAt, now + 1);
});

test('equal-cost ties, duplicates and shuffled input produce deterministic disjoint pairs', () => {
  const candidates = [edge('d2', 'r2', 30), edge('d1', 'r2', 30), edge('d2', 'r1', 30), edge('d1', 'r1', 30)];
  const before = structuredClone(candidates);
  for (const mode of ['sequential', 'batch']) {
    const result = allocateDispatchOffers(candidates, now, { mode });
    assert.equal(result.length, 2);
    assert.equal(new Set(result.map((o) => o.driverId)).size, 2);
    assert.equal(new Set(result.map((o) => o.rideId)).size, 2);
    assert.deepEqual(allocateDispatchOffers([...candidates].reverse(), now, { mode }), result);
    assert.deepEqual(allocateDispatchOffers([...candidates, ...candidates].reverse(), now, { mode }), result);
  }
  assert.deepEqual(candidates, before);
});

test('candidate budgets retain oldest rides even when their IDs sort last', () => {
  const candidates = Array.from({ length: 50 }, (_, i) => edge(`d${i}`, `r${i}`, 30, i * 1000));
  for (const mode of ['sequential', 'batch']) {
    const result = allocateDispatchOffers(candidates, now, { mode });
    assert.equal(result.length, DISPATCH_POLICY.maxRides);
    assert.equal(result.every((o) => Number(o.rideId.slice(1)) >= 18), true);
  }
});

test('edge-budget pruning preserves match capacity in a dense 32-by-32 graph', () => {
  const candidates = [];
  for (let d = 0; d < 32; d += 1) for (let r = 0; r < 32; r += 1) candidates.push(edge(`d${d}`, `r${r}`, 30));
  for (const mode of ['sequential', 'batch']) {
    const result = allocateDispatchOffers(candidates, now, { mode });
    assert.equal(result.length, 32);
    assert.equal(new Set(result.map((o) => o.driverId)).size, 32);
    assert.equal(new Set(result.map((o) => o.rideId)).size, 32);
    assert.deepEqual(allocateDispatchOffers([...candidates].reverse(), now, { mode }), result);
  }
});

test('pre-routing bounds preserve dense graph capacity, oldest rides and candidate-only fields', () => {
  const candidates = [];
  for (let d = 0; d < 40; d += 1) for (let r = 0; r < 40; r += 1) {
    candidates.push({ ...edge(`d${d}`, `r${r}`, null, r * 1000), availabilityId: `lease${d}`, from: { lat: 9, lng: 7 } });
  }
  const before = structuredClone(candidates);
  const bounded = boundedDispatchCandidates(candidates, now);
  assert.equal(bounded.length, DISPATCH_POLICY.maxEdges);
  assert.equal(new Set(bounded.map((c) => c.driverId)).size, DISPATCH_POLICY.maxDrivers);
  assert.equal(new Set(bounded.map((c) => c.rideId)).size, DISPATCH_POLICY.maxRides);
  assert.equal(bounded.every((c) => Number(c.rideId.slice(1)) >= 8), true);
  assert.equal(bounded.every((c) => c.availabilityId && c.from && !c.dispatch), true);
  assert.equal(allocateDispatchOffers(bounded, now, { mode: 'batch' }).length, 32);
  assert.deepEqual(boundedDispatchCandidates([...candidates].reverse(), now), bounded);
  assert.deepEqual(candidates, before);
});

test('driver budget retains a later ride\'s only eligible driver alongside popular drivers', () => {
  const candidates = Array.from({ length: 40 }, (_, i) => edge(`popular-${i}`, 'old', 30, 130_000));
  candidates.push(edge('only-eligible-driver', 'later', 600));
  const bounded = boundedDispatchCandidates(candidates, now);
  assert.equal(new Set(bounded.map((c) => c.driverId)).size, DISPATCH_POLICY.maxDrivers);
  assert.ok(bounded.some((c) => c.driverId === 'only-eligible-driver'));
  const result = allocateDispatchOffers(bounded, now, { mode: 'batch' });
  assert.equal(result.length, 2);
  assert.ok(result.some((c) => c.rideId === 'later'));
});

test('batch agrees with exhaustive maximum-cardinality minimum-ETA matching on small graphs', () => {
  // An independent exhaustive oracle checks residual reassignment on sparse,
  // disconnected and tied 3-by-3 graphs, including unmatched drivers and rides.
  for (let mask = 1; mask < 512; mask += 1) {
    const candidates = [];
    for (let d = 0; d < 3; d += 1) for (let r = 0; r < 3; r += 1) {
      if (mask & (1 << (d * 3 + r))) candidates.push(edge(`d${d}`, `r${r}`, ((d + 2) * (r + 3) * 37) % 101));
    }
    let optimum = { count: 0, eta: Infinity };
    const visit = (d, rides, count, eta) => {
      if (d === 3) {
        if (count > optimum.count || count === optimum.count && eta < optimum.eta) optimum = { count, eta };
        return;
      }
      visit(d + 1, rides, count, eta);
      for (const candidate of candidates.filter((c) => c.driverId === `d${d}` && !rides.has(c.rideId))) {
        visit(d + 1, new Set([...rides, candidate.rideId]), count + 1, eta + candidate.pickupEtaSeconds);
      }
    };
    visit(0, new Set(), 0, 0);
    const result = allocateDispatchOffers(candidates, now, { mode: 'batch' });
    assert.equal(result.length, optimum.count, `cardinality for graph ${mask}`);
    assert.equal(result.reduce((sum, o) => sum + o.pickupEtaSeconds, 0), optimum.eta, `cost for graph ${mask}`);
  }
});
