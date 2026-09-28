import test from 'node:test';
import assert from 'node:assert/strict';
import { readTracking, readTrackingResult } from '../src/tracking/contracts.ts';
const rideId = '00000000-0000-4000-8000-000000000001';
const shareId = '00000000-0000-4000-8000-000000000002';
const share = { id: shareId, rideId, active: true, owned: true, sequence: 1, startedAt: 1000, updatedAt: 2000, stale: false,
  position: { lat: 9.07, lng: 7.4, accuracy: 20, capturedAt: 2000 } };
const body = { apiVersion: 1, serverNow: 2000, rideId, isDriver: true, canShare: true, share };

test('location readers reject another trip, incomplete success and a stop that is still active', () => {
  assert.equal(readTracking(body, rideId).share?.position?.lat, 9.07);
  assert.throws(() => readTracking(body, shareId));
  assert.throws(() => readTracking({ ...body, share: { ...share, rideId: shareId } }, rideId));
  assert.throws(() => readTracking({ ...body, isDriver: false }, rideId));
  assert.throws(() => readTrackingResult({ apiVersion: 1, serverNow: 2000, replayed: false }, { rideId }));
  assert.throws(() => readTrackingResult({ ...body, replayed: false }, { shareId, stopped: true }));
  assert.throws(() => readTrackingResult({ ...body, replayed: false }, { shareId: rideId }));
});
test('invalid or uncleared locations cannot be presented as confirmed sharing state', () => {
  for (const position of [{ ...share.position, lat: Infinity }, { ...share.position, accuracy: null }, { ...share.position, capturedAt: -1 }])
    assert.throws(() => readTracking({ ...body, share: { ...share, position } }, rideId));
  assert.throws(() => readTracking({ ...body, share: { ...share, active: false } }, rideId));
  assert.throws(() => readTracking({ ...body, share: { ...share, updatedAt: null } }, rideId));
  assert.equal(readTrackingResult({ ...body, replayed: false, share: { ...share, active: false, owned: false, position: null, updatedAt: null } }, { shareId, stopped: true }).share.position, null);
});
