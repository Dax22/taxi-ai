import test from 'node:test';
import assert from 'node:assert/strict';
import { createDeliveryOperationsService } from '../src/modules/delivery-operations/service.mjs';
import { deliveryOperationState } from '../src/modules/delivery-operations/domain.mjs';
const rideId = '00000000-0000-4000-8000-000000000001';
function fixture() {
  let counter = 0, returned = 0;
  const events = [], ride = { id: rideId, customerId: 'sender', driverId: 'courier', version: 4, delivery: true, status: 'in_progress' };
  const service = createDeliveryOperationsService({
    repository: { events: async () => events, command: async (actor, key) => events.find(e => e.actorId === actor && e.commandKey === key),
      append: async row => events.push(row), evidence: async () => null },
    getAccount: async id => ({ id }), getTrip: async () => ride,
    isVerifiedRecipient: async id => id === 'recipient',
    closeReturn: async (user, id, version) => { assert.equal(user.id, 'sender'); assert.equal(id, rideId); assert.equal(version, ride.version); returned++; ride.status = 'cancelled'; },
    unitOfWork: async run => run(), tokens: { id: () => `event-${++counter}`, digest: value => value },
    audit: { record: async () => {} }, clock: () => 1000,
  });
  const act = async (userId, action, extra = {}, key = `fixture-command-${++counter}`) => service.command({ userId, rideId, key,
    data: { action, expectedVersion: events.length, ...extra } });
  return { service, events, act, returned: () => returned };
}
test('unrelated accounts cannot read or operate parcel exception records', async () => {
  const f = fixture();
  await assert.rejects(f.service.get('outsider', rideId), { code: 'NOT_FOUND' });
  await assert.rejects(f.act('outsider', 'request_return'), { code: 'NOT_FOUND' });
  assert.equal(f.events.length, 0);
});
test('only the sender can resolve a reported issue and unblock handover', async () => {
  const f = fixture(); await f.act('recipient', 'report', { reason: 'damaged_parcel', note: 'Outer wrapping damaged.' });
  await assert.rejects(f.service.requireHandover(rideId), { code: 'INVALID_TRIP_STATE' });
  await assert.rejects(f.act('courier', 'resolve', { note: 'Courier override.' }), { code: 'INVALID_TRIP_STATE' });
  assert.equal((await f.service.get('recipient', rideId)).operations.events[0].note, undefined);
  await f.act('sender', 'resolve', { note: 'Recipient and sender agree delivery may continue.' });
  await f.service.requireHandover(rideId);
});
test('return is sender-authorized and requires an explicit sender receipt statement', async () => {
  const f = fixture(); await f.act('courier', 'request_return');
  await assert.rejects(f.act('courier', 'authorize_return', { note: 'Not sender.' }), { code: 'INVALID_TRIP_STATE' });
  await f.act('sender', 'authorize_return', { note: 'Return the parcel to me.' });
  await assert.rejects(f.act('sender', 'confirm_return'), { code: 'INVALID_CONFIRMATION' });
  assert.equal(f.returned(), 0);
  const result = await f.act('sender', 'confirm_return', { confirmation: 'RECEIVED' });
  assert.equal(result.operations.state, 'returned'); assert.equal(f.returned(), 1);
  assert.equal(result.operations.evidence, null); assert.ok(Object.values(result.operations.can).every(v => !v));
});
test('same-key replay is harmless while changed payload and stale versions fail', async () => {
  const f = fixture(), key = 'fixture-idempotency-command';
  const request = { userId: 'courier', rideId, key, data: { action: 'report', expectedVersion: 0, reason: 'recipient_unavailable' } };
  await f.service.command(request);
  assert.equal((await f.service.command(request)).replayed, true);
  await assert.rejects(f.service.command({ ...request, data: { ...request.data, reason: 'damaged_parcel' } }), { code: 'KEY_REUSED' });
  await assert.rejects(f.service.command({ ...request, key: 'another-fixture-command' }), { code: 'STALE_VERSION' });
  assert.equal(f.events.length, 1);
});
test('the operation-state reducer never conflates a return with delivery', () => {
  const events = [{ kind: 'return_requested' }, { kind: 'return_authorized' }, { kind: 'return_received' }];
  assert.equal(deliveryOperationState(events, 'cancelled'), 'returned');
  assert.equal(deliveryOperationState([], 'completed'), 'delivered');
  assert.equal(deliveryOperationState([{ kind: 'recipient_unavailable' }], 'in_progress'), 'exception');
});
