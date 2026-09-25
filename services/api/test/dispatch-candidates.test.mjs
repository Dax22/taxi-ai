import test from 'node:test';
import assert from 'node:assert/strict';
import { createRidesService } from '../src/modules/rides/service.mjs';

const now = 1_000_000;
const ride = (i) => ({ id: `r${i}`, customerId: `c${i}`, pickupId: 'area', status: 'requested',
  createdAt: now - 10_000 + i, requestExpiresAt: now + 300_000, vehicleCategory: 'standard', version: 1 });
const driver = (id) => ({ id, capabilities: ['customer', 'driver'], driver: {
  status: 'approved', eligibility: { eligible: true }, vehicle: { category: 'standard' } } });

test('candidate discovery skips exhausted rides before budgeting and caches per-cycle driver checks', async () => {
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
  const candidates = await service.dispatchCandidates(now, { excludeDriverIds: new Set(['busy']),
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
  assert.equal(await service.dispatchCandidateFor('r41', 'd1', now), null, 'commit revalidation never reuses the discovery cache');
});

test('discovery isolates GPS/sample modes and caps neighbours after eligibility', async () => {
  const rides = [ride(0), ride(1)];
  const ids = ['sample', ...Array.from({ length: 40 }, (_, i) => `gps${i}`), 'far'];
  const service = createRidesService({
    repository: { listAvailable: () => rides, hasNegotiation: () => false, hasCustomerWork: () => false },
    deliveries: { matches: () => true }, getAccount: driver, availableDriverIds: () => ids,
    availabilityFor: (id) => id === 'sample' ? { id: 'sample-lease', mode: 'sample', areaId: 'area' }
      : { id: `lease:${id}`, mode: 'gps', position: { lat: id === 'far' ? 10 : 9 + Number(id.slice(3)) * 0.0001, lng: 7 } },
    routeForRide: (id) => id === 'r0' ? { pickup: { lat: 9, lng: 7 } } : null,
  });
  const candidates = await service.dispatchCandidates(now);
  const gps = candidates.filter((c) => c.rideId === 'r0'), sample = candidates.filter((c) => c.rideId === 'r1');
  assert.equal(gps.length, 32);
  assert.ok(gps.every((c) => c.driverId.startsWith('gps') && c.from && c.to));
  assert.equal(gps.at(-1).driverId, 'gps31');
  assert.equal(sample.length, 1);
  assert.equal(sample[0].driverId, 'sample');
  assert.equal(sample[0].distanceMeters, null);
  assert.equal(sample[0].from, null);
  assert.deepEqual(await service.dispatchCandidates(now, { minimumAgeMs: 20_000 }), []);
});

test('regional discovery rotates past a full exhausted ride page without scanning all drivers', async () => {
  const rides = Array.from({ length: 201 }, (_, n) => ({ ...ride(n), dispatchRegion: 'sample:area' }));
  const queries = [];
  const service = createRidesService({
    repository: { listAvailable: ({ region, after, limit }) => {
      queries.push({ region, after, limit });
      return rides.filter((row) => !after || row.createdAt > after.createdAt).slice(0, limit);
    }, hasNegotiation: () => false, hasCustomerWork: () => false },
    deliveries: { matches: () => true }, getAccount: driver,
    availableDriverIds: () => { throw new Error('Global driver enumeration must not be used'); },
    nearbyDriverIds: () => ({ driverIds: ['d1'], nextCursor: null, scanned: 1 }),
    availabilityFor: () => ({ id: 'lease', mode: 'sample', areaId: 'area' }), routeForRide: () => null,
  });
  const parameters = { region: 'sample:area', attempted: (rideId) => rideId !== 'r200' };
  assert.deepEqual(await service.dispatchCandidates(now, parameters), []);
  const candidates = await service.dispatchCandidates(now, parameters);
  assert.equal(candidates[0].rideId, 'r200');
  assert.equal(candidates[0].region, 'sample:area');
  assert.equal(queries[0].region, 'sample:area');
  assert.equal(queries[0].limit, 200);
  assert.equal(queries[1].after.id, 'r199');
});

test('local driver cursor advances beyond exhausted candidates in a dense pickup area', async () => {
  const afterIds = [];
  const service = createRidesService({
    repository: { listAvailable: () => [ride(0)], hasNegotiation: () => false, hasCustomerWork: () => false },
    deliveries: { matches: () => true }, getAccount: driver,
    nearbyDriverIds: ({ afterId }) => { afterIds.push(afterId); return afterId
      ? { driverIds: ['new-driver'], nextCursor: null, scanned: 1 }
      : { driverIds: Array.from({ length: 200 }, (_, n) => `tried-${n}`), nextCursor: 'lease-199', scanned: 200 }; },
    availabilityFor: () => ({ id: 'lease', mode: 'sample', areaId: 'area' }), routeForRide: () => null,
  });
  const parameters = { region: 'sample:area', attempted: (rideId, driverId) => driverId.startsWith('tried-') };
  assert.deepEqual(await service.dispatchCandidates(now, parameters), []);
  assert.equal((await service.dispatchCandidates(now, parameters))[0].driverId, 'new-driver');
  assert.deepEqual(afterIds, ['', 'lease-199']);
});
