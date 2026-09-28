import test from 'node:test';
import assert from 'node:assert/strict';
import { createAvailabilityService } from '../src/modules/availability/service.mjs';
import { createLocationsService } from '../src/modules/locations/service.mjs';

const now = 1_000_000;
const user = { id: 'driver', capabilities: ['customer', 'driver'], driver: { status: 'approved', eligibility: { eligible: true } } };
const input = { userId: user.id, sessionToken: 'session', clientId: '00000000-0000-0000-0000-000000000000' };
const gps = { lat: 9.08, lng: 7.4, accuracy: 10, capturedAt: now };
const lease = (id = 'lease') => ({ id, driverId: user.id, active: 1, mode: 'gps', sequence: 1, sessionHash: 'session',
  clientHash: input.clientId, startedAt: now, seenAt: now, positionJson: JSON.stringify(gps) });
const share = (id = 'share') => ({ ...lease(id), rideId: 'ride' });
const noGlobalRead = () => { throw new Error('A request must not scan other users'); };
const options = { getAccount: async () => user, sessionOwner: async () => user.id, unitOfWork: (run) => run(),
  tokens: { digest: (value) => value }, audit: { record() {} }, clock: () => now };

test('availability GET and GPS heartbeat do not scan any other driver', async () => {
  let row = lease();
  const service = createAvailabilityService({ ...options, isBusy: () => false, repository: {
    current: () => row, find: () => row, activePage: noGlobalRead, expired: noGlobalRead,
    update(id, sequence, position, seenAt) { row = { ...row, sequence, positionJson: JSON.stringify(position), seenAt }; },
  } });
  assert.equal((await service.get(input)).availability.online, true);
  assert.equal((await service.update(input, row.id, { sequence: 2, position: gps })).availability.sequence, 2);
});

test('availability request validation clears an expired lease before rejecting a heartbeat', async () => {
  let row = { ...lease(), seenAt: now - 60_000 }, stopped = false;
  const service = createAvailabilityService({ ...options, isBusy: () => false, repository: {
    current: () => row.active ? row : null, find: () => row, activePage: noGlobalRead, expired: noGlobalRead,
    stop() { row = { ...row, active: 0, positionJson: null }; stopped = true; },
  } });
  await assert.rejects(async () => service.update(input, row.id, { sequence: 2, position: gps }), { code: 'AVAILABILITY_CLOSED' });
  assert.equal(stopped, true);
  assert.equal(row.positionJson, null);
});

test('availability maintenance advances beyond a full page of valid leases to find revoked sessions', async () => {
  const first = Array.from({ length: 200 }, (_, n) => lease(String(n).padStart(3, '0')));
  const revoked = { ...lease('zzz'), sessionHash: 'revoked' }, cursors = [], stopped = [];
  const service = createAvailabilityService({ ...options, isBusy: () => false,
    sessionOwner: (session) => session === 'revoked' ? null : user.id, repository: {
      expired: () => [], activePage: (cursor) => { cursors.push(cursor); return cursor ? [revoked] : first; },
      stop: (id) => stopped.push(id),
    } });
  await service.sweep(); assert.deepEqual(stopped, []);
  await service.sweep(); assert.deepEqual(stopped, ['zzz']);
  assert.deepEqual(cursors, ['', '199']);
});

test('nearby candidates filter bounding-box corners and expired or revoked eligibility without exposing coordinates', async () => {
  let query;
  const outsideCircle = { ...lease('corner'), positionJson: JSON.stringify({ ...gps, lat: gps.lat + .044, lng: gps.lng + .044 }) };
  const revoked = { ...lease('revoked'), sessionHash: 'revoked' };
  const service = createAvailabilityService({ ...options, isBusy: () => false,
    sessionOwner: (session) => session === 'revoked' ? null : user.id, repository: {
      nearby: (args) => { query = args; return [lease('inside'), outsideCircle, revoked]; },
    } });
  const result = await service.nearbyDriverIds({ mode: 'gps', position: gps, radiusMeters: 5000, limit: 3 });
  assert.deepEqual(result, { driverIds: ['driver'], nextCursor: 'revoked', scanned: 3 });
  assert.ok(query.bounds.minLat < gps.lat && query.bounds.maxLat > gps.lat);
  assert.equal(query.now, now);
  assert.equal(JSON.stringify(result).includes('position'), false);
});

test('trip tracking and GPS updates validate only the authorized share', async () => {
  let row = share();
  const service = createLocationsService({ ...options, provider: {}, getRideContext: () => ({ status: 'booked', driverId: user.id }), repository: {
    currentShare: () => row, share: () => row, activePage: noGlobalRead, expired: noGlobalRead, pruneQuotes: noGlobalRead,
    update(id, sequence, value, seenAt) { row = { ...row, sequence, positionJson: JSON.stringify(value), seenAt }; },
  } });
  assert.equal((await service.tracking(input, 'ride')).share.active, true);
  const result = await service.update(input, row.id, { ...gps, sequence: 2 });
  assert.equal(result.share.sequence, 2);
});

test('trip share maintenance rotates past healthy shares and bounds quote pruning to worker runs', async () => {
  const first = Array.from({ length: 200 }, (_, n) => share(String(n).padStart(3, '0')));
  const revoked = { ...share('zzz'), sessionHash: 'revoked' }, cursors = [], stopped = [];
  let pruneRuns = 0;
  const service = createLocationsService({ ...options, provider: {}, getRideContext: () => ({ status: 'booked', driverId: user.id }),
    sessionOwner: (session) => session === 'revoked' ? null : user.id, repository: {
      expired: () => [], activePage: (cursor) => { cursors.push(cursor); return cursor ? [revoked] : first; },
      stop: (id) => stopped.push(id), pruneQuotes: () => { pruneRuns++; },
    } });
  await service.sweep(); assert.deepEqual(stopped, []);
  await service.sweep(); assert.deepEqual(stopped, ['zzz']);
  assert.deepEqual(cursors, ['', '199']);
  assert.equal(pruneRuns, 2);
});
