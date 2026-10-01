import test from 'node:test';
import assert from 'node:assert/strict';
import { readFoodTracking, readFoodTrackingResult } from '../src/food-tracking.mjs';
const id = n => `00000000-0000-4000-a000-${String(n).padStart(12,'0')}`;
const share = { id: id(2), orderId: id(1), active: true, owned: false, sequence: 1, startedAt: 1000, updatedAt: 1000, stale: false,
  position: { lat: 9.08, lng: 7.49, accuracy: 10, capturedAt: 1000 } };
const response = { orderId: id(1), isCourier: false, canShare: false, required: false, share, serverNow: 1000 };
test('food tracking rejects another order, impossible positions and secret session bindings', () => {
  assert.equal(readFoodTracking(response, id(1)), response);
  assert.throws(() => readFoodTracking(response, id(3)));
  assert.throws(() => readFoodTracking({ ...response, canShare: true }, id(1)));
  for (const change of [{ orderId: id(3) }, { active: false }, { position: { ...share.position, lat: 41.88, lng: -87.63 } }, { token: 'private' }, { sessionHash: 'private' }]) {
    assert.throws(() => readFoodTracking({ ...response, share: { ...share, ...change } }, id(1)));
  }
});
test('food stop confirmations must clear location and match the requested share', () => {
  const stopped = { share: { ...share, active: false, position: null, updatedAt: null }, replayed: false, serverNow: 1000 };
  assert.equal(readFoodTrackingResult(stopped, { shareId: id(2), stopped: true }), stopped);
  assert.throws(() => readFoodTrackingResult(stopped, { shareId: id(3) }));
  assert.throws(() => readFoodTrackingResult({ ...stopped, share }, { stopped: true }));
});
