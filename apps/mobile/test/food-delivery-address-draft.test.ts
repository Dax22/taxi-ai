import test from 'node:test';
import assert from 'node:assert/strict';
import { deliveryAddressDraft, editDeliveryAddressDraft, confirmDeliveryAddressDraft, savedDeliveryAddressDraft, staleDeliveryAddressDraft } from '../src/eats/delivery-address-draft.ts';
const home = { line: '10 Example Street', areaId: 'wuse-ii', point: { lat: 9.0765, lng: 7.3986 } };

test('native address edits retain the reviewed profile version through updates from another device', () => {
  assert.equal(staleDeliveryAddressDraft(deliveryAddressDraft(home, 7), 8), true);
  const selected = savedDeliveryAddressDraft(home, 7);
  const edited = editDeliveryAddressDraft(selected, { line: '11 Example Street' }, 8);
  assert.equal(edited.profileVersion, 7);
  assert.equal(staleDeliveryAddressDraft(edited, 8), true);
  assert.equal(edited.address.point, null);
  const explicitReselection = savedDeliveryAddressDraft({ ...home, line: 'A newly saved address' }, 8);
  assert.equal(staleDeliveryAddressDraft(explicitReselection, 8), false);
});

test('manual edits and a new map selection immediately remove an old pin without changing saved addresses', () => {
  const selected = savedDeliveryAddressDraft(home, 2);
  assert.notEqual(selected.address, home); assert.notEqual(selected.address.point, home.point);
  assert.equal(editDeliveryAddressDraft(selected, { areaId: 'garki' }, 2).address.point, null);
  assert.equal(editDeliveryAddressDraft(selected, {}, 2).address.point, null);
  assert.deepEqual(home.point, { lat: 9.0765, lng: 7.3986 });
  const confirmed = confirmDeliveryAddressDraft(selected, { ...home, point: { lat: 9.05, lng: 7.4 } }, 3);
  assert.equal(confirmed.profileVersion, 2); assert.equal(staleDeliveryAddressDraft(confirmed, 3), true);
});

test('a new manual draft captures its first edit version and an unavailable profile cannot silently replace a saved address', () => {
  const empty = deliveryAddressDraft({ line: '', areaId: '' }, null);
  const edited = editDeliveryAddressDraft(empty, { line: '10 Example Street' }, null);
  assert.equal(staleDeliveryAddressDraft(edited, 1), true);
  const discarded = deliveryAddressDraft({ line: '', areaId: '' }, 1);
  assert.equal(editDeliveryAddressDraft(discarded, home, 2).profileVersion, 2);
});
