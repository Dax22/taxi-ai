import test from 'node:test';
import assert from 'node:assert/strict';
import { createRidesService } from '../src/modules/rides/service.mjs';

const now = 1_000_000;
const ride = (i) => ({ id: `r${i}`, customerId: `c${i}`, pickupId: 'area', status: 'requested',
  createdAt: now - 10_000 + i, requestExpiresAt: now + 300_000, vehicleCategory: 'standard', version: 1 });
const driver = (id) => ({ id, capabilities: ['customer', 'driver'], driver: {
  status: 'approved', eligibility: { eligible: true }, vehicle: { category: 'standard' } } });

test('candidate discovery skips exhausted rides before budgeting and caches per-cycle driver checks', () => {
  const rides = Array.from({ length: 75 }, (_, i) => ride(i));
  const accounts = new Map([['busy', driver('busy')], ['d1', driver('d1')], ['unapproved', driver('unapproved')]]);
  accounts.get('unapproved').driver.status = 'pending';
  const reads = { account: {}, availability: {}, route: {} };
  const count = (kind, id) => { reads[kind][id] = (reads[kind][id] ?? 0) + 1; };
  const service = createRidesService({
    repository: { listAvailable: () => rides, find: (id) => rides.find((r) => r.id === id),
      hasNegotiation: () => false, hasCustomerWork: () => false },
    deliveries: { matches: () => true },
    getAccount: (id) => { count('account', id); return accounts.get(id); },
    availableDriverIds: () => [...accounts.keys()],
    availabilityFor: (id) => { count('availability', id); return { id: `lease:${id}`, mode: 'sample', areaId: 'area' }; },
    routeForRide: (id) => { count('route', id); return null; },
  });
  const candidates = service.dispatchCandidates(now, { excludeDriverIds: new Set(['busy']),
    excludeRideIds: new Set(['r40']), attempted: (rideId) => Number(rideId.slice(1)) < 40 });
  assert.equal(candidates.length, 32);
  assert.equal(candidates[0].rideId, 'r41');
  assert.equal(candidates.at(-1).rideId, 'r72');
  assert.deepEqual(reads.account, { d1: 1, unapproved: 1 });
  assert.deepEqual(reads.availability, { d1: 1 });
  assert.ok(Object.values(reads.route).every((n) => n === 1));
  assert.equal(reads.route.r40, undefined, 'a pending ride is skipped before route loading');
  assert.equal(reads.route.r73, undefined, 'discovery stops once32 eligible rides are collected');
  accounts.get('d1').driver.eligibility.eligible = false;
  assert.equal(service.dispatchCandidateFor('r41', 'd1', now), null, 'commit revalidation never reuses the discovery cache');
});

test('discovery isolates GPS/sample modes and caps neighbours after eligibility', () => {
  const rides = [ride(0), ride(1)];
  const ids = ['sample', ...Array.from({ length: 40 }, (_, i) => `gps${i}`), 'far'];
  const service = createRidesService({
    repository: { listAvailable: () => rides, hasNegotiation: () => false, hasCustomerWork: () => false },
    deliveries: { matches: () => true }, getAccount: driver, availableDriverIds: () => ids,
    availabilityFor: (id) => id === 'sample' ? { id: 'sample-lease', mode: 'sample', areaId: 'area' }
      : { id: `lease:${id}`, mode: 'gps', position: { lat: id === 'far' ? 10 : 9 + Number(id.slice(3)) * 0.0001, lng: 7 } },
    routeForRide: (id) => id === 'r0' ? { pickup: { lat: 9, lng: 7 } } : null,
  });
  const candidates = service.dispatchCandidates(now);
  const gps = candidates.filter((c) => c.rideId === 'r0'), sample = candidates.filter((c) => c.rideId === 'r1');
  assert.equal(gps.length, 32);
  assert.ok(gps.every((c) => c.driverId.startsWith('gps') && c.from && c.to));
  assert.equal(gps.at(-1).driverId, 'gps31');
  assert.equal(sample.length, 1);
  assert.equal(sample[0].driverId, 'sample');
  assert.equal(sample[0].distanceMeters, null);
  assert.equal(sample[0].from, null);
  assert.deepEqual(service.dispatchCandidates(now, { minimumAgeMs: 20_000 }), []);
});
