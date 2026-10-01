import test from 'node:test';
import assert from 'node:assert/strict';
import { freshWorkLocation, workLocationBlocks, workLocationRequired } from '../src/journeys/work-location.ts';
import { showFoodOrderTracking } from '../src/eats/order-tracking.ts';
import type { FoodOrder } from '../../../packages/shared/src/eats.mjs';

const active = { now: 100_000, stale: false, uncertain: false,
  data: { required: true, share: { active: true, owned: false, stale: false, position: { capturedAt: 99_000 } } } };

test('required ride and food progression needs recent location, including a valid share from another device', () => {
  assert.equal(workLocationRequired(active), true); assert.equal(freshWorkLocation(active), true);
  for (const action of ['depart', 'arrive', 'start', 'delivery_arrive']) assert.equal(workLocationBlocks('ride', action, active), false);
  for (const action of ['pickup', 'arrive']) assert.equal(workLocationBlocks('food', action, active), false);
  const stale = { ...active, now: 129_000 };
  assert.equal(freshWorkLocation({ ...active, now: 128_999 }), true);
  for (const action of ['depart', 'arrive', 'start', 'delivery_arrive']) assert.equal(workLocationBlocks('ride', action, stale), true);
  for (const action of ['pickup', 'arrive']) assert.equal(workLocationBlocks('food', action, stale), true);
});

test('location loss never blocks completion, cancellation, code handover or safety actions', () => {
  const missing = { ...active, stale: true, uncertain: true, data: { required: true, share: null } };
  for (const kind of ['ride', 'food'] as const) for (const action of ['complete', 'deliver', 'cancel', 'complete_pickup', 'safety'])
    assert.equal(workLocationBlocks(kind, action, missing), false);
  assert.equal(workLocationBlocks('food', 'claim', missing), false);
  assert.equal(workLocationBlocks('ride', 'confirm', missing), false);
});

test('stale snapshots, stopped sharing, uncertain mutations and implausible timestamps cannot enable progression', () => {
  assert.equal(freshWorkLocation({ ...active, stale: true }), false);
  assert.equal(freshWorkLocation({ ...active, uncertain: true }), false);
  for (const share of [{ ...active.data.share, active: false }, { ...active.data.share, stale: true }, { ...active.data.share, position: null }])
    assert.equal(freshWorkLocation({ ...active, data: { required: true, share } }), false);
  assert.equal(freshWorkLocation({ ...active, now: 90_000 }), false);
  assert.equal(freshWorkLocation({ ...active, now: NaN }), false);
  assert.equal(workLocationBlocks('ride', 'depart', { ...active, data: { share: null } }), false);
  assert.equal(workLocationBlocks('food', 'pickup', { ...active, data: { required: false, share: null } }), false);
});

test('food tracking is shown only to the buyer or assigned courier during an active delivery', () => {
  const courier = { id: 'courier', name: 'Courier', vehicle: {} } as FoodOrder['courier'];
  const order = { fulfillment: 'delivery' as const, role: 'customer' as const, status: 'assigned' as const, courier };
  assert.equal(showFoodOrderTracking(order), true);
  assert.equal(showFoodOrderTracking({ ...order, role: 'courier', status: 'picked_up' }), true);
  assert.equal(showFoodOrderTracking({ ...order, status: 'arrived' }), true);
  for (const status of ['placed', 'ready', 'delivered', 'cancelled', 'rejected'] as const) assert.equal(showFoodOrderTracking({ ...order, status }), false);
  assert.equal(showFoodOrderTracking({ ...order, courier: null }), false);
  assert.equal(showFoodOrderTracking({ ...order, fulfillment: 'pickup' }), false);
  assert.equal(showFoodOrderTracking({ ...order, role: 'store' }), false);
});
