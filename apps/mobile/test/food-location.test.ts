import test from 'node:test';
import assert from 'node:assert/strict';
import { changeStoreLocation, storeDraft } from '../src/eats/store-draft.ts';
import { foodAreaId } from '../../../packages/shared/src/nigeria-areas.mjs';
import type { FoodStore } from '../../../packages/shared/src/eats.mjs';

const ikeja = foodAreaId('lagos', 'Ikeja'), yaba = foodAreaId('lagos', 'Yaba'), kano = foodAreaId('kano', 'Kano');
const store: FoodStore = { id: 'fixture-kitchen', version: 2, status: 'approved', isOpen: true, name: 'Test kitchen',
  cuisine: 'Nigerian', description: 'Test food', address: '', areaId: ikeja, sellerType: 'home_kitchen',
  prepMinutes: 25, minimumKobo: 0, deliveryFeeKobo: 150000, createdAt: 1000, updatedAt: 2000 };

test('native kitchen starts without an assumed town and limits initial coverage to the chosen town', () => {
  const initial = storeDraft(null, 'home_kitchen');
  assert.equal(initial.areaId, ''); assert.deepEqual(initial.deliveryAreaIds, []); assert.equal(initial.dispatchPoint, null);
  const chosen = changeStoreLocation(initial, ikeja);
  assert.equal(chosen.areaId, ikeja); assert.deepEqual(chosen.deliveryAreaIds, [ikeja]);
  const changed = changeStoreLocation(chosen, kano);
  assert.deepEqual(changed.deliveryAreaIds, [kano]);
  assert.deepEqual(changeStoreLocation(changed, '').deliveryAreaIds, []);
});

test('editing kitchen locality clears its private pickup point while preserving explicit coverage', () => {
  const draft = storeDraft({ ...store, deliveryAreaIds: [ikeja, yaba], dispatchPoint: { lat: 6.6, lng: 3.35 } });
  assert.deepEqual(changeStoreLocation(draft, ikeja).dispatchPoint, draft.dispatchPoint);
  const changed = changeStoreLocation(draft, kano);
  assert.equal(changed.dispatchPoint, null); assert.deepEqual(changed.deliveryAreaIds, [ikeja, yaba]);
  assert.equal(draft.areaId, ikeja); assert.notEqual(draft.deliveryAreaIds, store.deliveryAreaIds);
});

test('older kitchen records never infer countrywide delivery coverage from new geography', () => {
  assert.deepEqual(storeDraft(store).deliveryAreaIds, [ikeja]);
  assert.deepEqual(storeDraft({ ...store, areaId: 'wuse-ii' }).deliveryAreaIds,
    ['wuse-ii', 'maitama', 'garki', 'asokoro', 'jabi', 'gwarinpa', 'airport']);
  assert.deepEqual(storeDraft({ ...store, deliveryAreaIds: [] }).deliveryAreaIds, []);
});
