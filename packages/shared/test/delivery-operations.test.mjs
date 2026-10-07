import test from 'node:test';
import assert from 'node:assert/strict';
import { readDeliveryOperations } from '../src/delivery-operations.mjs';
const id = '00000000-0000-4000-8000-000000000001';
const eventId = '00000000-0000-4000-8000-000000000002';
const can = { report: false, requestReturn: false, authorizeReturn: false, confirmReturn: false, resolve: false };
const response = () => ({ operations: { rideId: id, version: 0, state: 'normal', events: [], evidence: null, can: { ...can, report: true } } });
test('delivery records are target-bound and reject excess private fields', () => {
  assert.equal(readDeliveryOperations(response(), id).rideId, id);
  assert.throws(() => readDeliveryOperations(response(), eventId));
  const body = response(); body.operations.accountPassword = 'forbidden-fixture';
  assert.throws(() => readDeliveryOperations(body, id));
});
test('returned parcels cannot claim delivered evidence or offer additional actions', () => {
  const body = response(); Object.assign(body.operations, { state: 'returned', can });
  assert.equal(readDeliveryOperations(body, id).state, 'returned');
  body.operations.can = { ...can, report: true }; assert.throws(() => readDeliveryOperations(body, id));
  body.operations.can = can;
  body.operations.evidence = { reference: 'PARCEL-00000000', verifiedAt: 1000, method: 'recipient_pin', locationRecorded: false };
  assert.throws(() => readDeliveryOperations(body, id));
});
test('the exception ledger requires contiguous versions and bounded notes', () => {
  const body = response(); body.operations.version = 1;
  body.operations.events = [{ id: eventId, kind: 'recipient_unavailable', label: 'Recipient unavailable', createdAt: 1000, version: 1 }];
  assert.equal(readDeliveryOperations(body, id).events.length, 1);
  body.operations.events[0].version = 2; assert.throws(() => readDeliveryOperations(body, id));
  body.operations.events[0].version = 1; body.operations.events[0].note = 'x'.repeat(501);
  assert.throws(() => readDeliveryOperations(body, id));
});
test('handover location carries an explicit time and accuracy and cannot leak a raw code', () => {
  const body = response(); Object.assign(body.operations, { state: 'delivered', can,
    evidence: { reference: 'PARCEL-00000000', verifiedAt: 1000, method: 'recipient_pin', locationRecorded: true,
      position: { lat: 9.08, lng: 7.4, accuracy: 10, capturedAt: 995 } } });
  assert.equal(readDeliveryOperations(body, id).evidence.position.accuracy, 10);
  body.operations.evidence.deliveryPin = 'invalid-field'; assert.throws(() => readDeliveryOperations(body, id));
});
