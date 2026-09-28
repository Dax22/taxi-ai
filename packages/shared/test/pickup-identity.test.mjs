import test from 'node:test';
import assert from 'node:assert/strict';
import { arrivalNotice, vehicleMismatchReport } from '../src/pickup-identity.mjs';

test('pickup details use vehicle fields, preserve custom colours, and never infer paint from artwork', () => {
  const value = arrivalNotice({ name: 'Tunde', vehicle: { make: 'Toyota', model: 'Corolla', colour: 'Blue and white', plate: 'test-123', category: 'standard' } });
  assert.equal(value.title, 'Driver has arrived');
  for (const expected of ['Tunde', 'Toyota Corolla', 'Standard', 'Blue and white', 'TEST-123']) assert.ok(value.body.includes(expected));
  const legacy = arrivalNotice({ name: 'Driver', vehicle: { model: 'Van', plate: 'TEST', category: 'van' } });
  assert.match(legacy.body, /Colour not recorded/); assert.doesNotMatch(legacy.body, /White/);
  assert.equal(arrivalNotice(null), null);
  const hidden = arrivalNotice({ name: 'Driver\u202e\nName', vehicle: { model: 'Car', plate: 'TEST' } });
  assert.doesNotMatch(hidden.body, /[\u202e\n]/u);
});

test('mismatch reports preserve observations within the existing review bounds without automatic recipients', () => {
  assert.deepEqual(vehicleMismatchReport('Red SUV, plate TEST-999'), { kind: 'unsafe_behaviour', note: 'Vehicle mismatch: Red SUV, plate TEST-999', contactIds: [] });
  assert.ok(vehicleMismatchReport('x'.repeat(480)).note.length <= 500);
  assert.throws(() => vehicleMismatchReport('x'.repeat(481)));
  assert.match(vehicleMismatchReport().note, /^Vehicle mismatch:/);
});
