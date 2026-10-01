import test from 'node:test';
import assert from 'node:assert/strict';
import { readDeliveryUpdate, readDeliveryUpdates, readDeliveryUpdateTarget } from '../src/delivery-updates.mjs';
const id = '00000000-0000-4000-8000-000000000001', targetId = '00000000-0000-4000-8000-000000000002';
const update = { id, kind: 'food', targetId, phase: 'picked_up', title: 'Kemmy · Food picked up',
  body: 'Your food has been picked up. Delivery takes approximately 15 minutes.', note: 'Road-route estimate; traffic may change it.',
  etaMinutes: 15, createdAt: 1000, readAt: null };

test('delivery notices bind to the exact requested target and strip untrusted extras', () => {
  assert.deepEqual(readDeliveryUpdate({ update: { ...update, url: 'https://untrusted.test' } }, { kind: 'food', targetId }), { update });
  assert.deepEqual(readDeliveryUpdate({ update: null }, { kind: 'parcel', targetId }), { update: null });
  for (const changed of [{ ...update, targetId: id }, { ...update, kind: 'parcel' }, { ...update, phase: 'fake' },
    { ...update, etaMinutes: -1 }, { ...update, etaMinutes: 1.5 }, { ...update, phase: 'arrived' },
    { ...update, readAt: 500 }, { ...update, title: '' }, { ...update, body: 'x'.repeat(1001) }]) {
    assert.throws(() => readDeliveryUpdate({ update: changed }, { kind: 'food', targetId }));
  }
});
test('delivery inbox rejects duplicate IDs, unbounded pages and malformed cursors', () => {
  assert.equal(readDeliveryUpdates({ updates: [update], unread: 1, nextBefore: id }).updates.length, 1);
  for (const changed of [{ updates: [update, update] }, { unread: -1 }, { nextBefore: 45 }, { updates: Array(51).fill(update) }]) {
    assert.throws(() => readDeliveryUpdates({ updates: [update], unread: 1, nextBefore: null, ...changed }));
  }
});
test('delivery open validates a server-authorized screen and ID instead of a raw URL', () => {
  for (const screen of ['food-order', 'journey', 'parcels']) assert.deepEqual(readDeliveryUpdateTarget({ target: { screen, id, url: 'evil' } }), { target: { screen, id } });
  for (const target of [{ screen: 'https://evil.test', id }, { screen: 'journey', id: '../logout' }]) assert.throws(() => readDeliveryUpdateTarget({ target }));
});
