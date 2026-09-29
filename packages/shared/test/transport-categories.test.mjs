import test from 'node:test';
import assert from 'node:assert/strict';
import { categoryFare, transportCategory, deliveryDetails, validPayload, vehicleMatches, parcelLoadLimit, supportsParcelCategory } from '../src/transport-categories.mjs';

test('preview categories use bounded integer fares, real category IDs and explicit delivery weights', () => {
  assert.equal(categoryFare(450000, 'suv'), 675000);
  assert.equal(categoryFare(450000, 'motorcycle'), 315000);
  for (const id of ['constructor', '__proto__', null, {}, 'sedan']) assert.equal(transportCategory(id), null);
  assert.equal(vehicleMatches({}, 'standard'), true); assert.equal(vehicleMatches({}, 'suv'), false);
  assert.equal(vehicleMatches({ category: 'van', payloadKg: 10 }, 'van', 10), true);
  assert.equal(vehicleMatches({ category: 'van', payloadKg: 10 }, 'van', 10.001), false);
  assert.equal(vehicleMatches({ category: 'truck', payloadKg: 200 }, 'van', 10), false);
  assert.equal(validPayload('motorcycle', 1.001), true);
  for (const weight of [0, -1, '2', NaN, Infinity, 20.001, 0.0001]) assert.equal(validPayload('motorcycle', weight), false);
  const parcel = { description: ' Test parcel ', weightKg: 1.001, recipientName: ' Test recipient ' };
  assert.deepEqual(deliveryDetails('motorcycle', parcel), { description: 'Test parcel', weightKg: 1.001, recipientName: 'Test recipient', pickupInstructions: '', dropoffInstructions: '' });
  assert.throws(() => deliveryDetails('suv', parcel)); assert.throws(() => categoryFare(Number.MAX_SAFE_INTEGER, 'truck'));
});

test('approved standard cars can carry bounded parcels while passenger bookings remain unchanged', () => {
  const parcel = { description: 'Sealed box', weightKg: 30, recipientName: 'Recipient' };
  assert.equal(deliveryDetails('standard'), null);
  assert.equal(deliveryDetails('standard', parcel).weightKg, 30);
  assert.equal(parcelLoadLimit('standard'), 30);
  assert.equal(supportsParcelCategory('standard'), true);
  assert.equal(supportsParcelCategory('suv'), false);
  assert.equal(vehicleMatches({ category: 'standard' }, 'standard', 30), true);
  assert.equal(vehicleMatches({ category: 'standard' }, 'standard'), true);
  for (const weightKg of [0, -1, NaN, Infinity, '2', 30.001, 0.0001]) {
    assert.throws(() => deliveryDetails('standard', { ...parcel, weightKg }));
    assert.equal(vehicleMatches({ category: 'standard' }, 'standard', weightKg), false);
  }
  assert.equal(vehicleMatches({ category: 'motorcycle', payloadKg: 20 }, 'standard', 2), false);
});
