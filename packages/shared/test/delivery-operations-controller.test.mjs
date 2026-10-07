import test from 'node:test';
import assert from 'node:assert/strict';
import { createDeliveryOperationsController } from '../src/delivery-operations-controller.mjs';
const id = '00000000-0000-4000-8000-000000000001', otherId = '00000000-0000-4000-8000-000000000002';
function fixture() {
  let now = 1000, owner = 'sender', lost = false, keys = 0, server;
  const writes = [], can = { report: true, requestReturn: true, authorizeReturn: false, confirmReturn: false, resolve: false };
  server = { rideId: id, version: 0, state: 'normal', events: [], evidence: null, can };
  const ports = { now: () => now, makeKey: () => `fixture-command-${++keys}`, verify: async value => value === owner,
    read: async () => ({ operations: structuredClone(server) }),
    write: async (target, data, key) => {
      writes.push({ target, data: structuredClone(data), key });
      if (!server.version) server = { ...server, version: 1, state: 'exception', can: { ...can, report: false, resolve: true },
        events: [{ id: otherId, kind: 'recipient_unavailable', label: 'Recipient unavailable', version: 1, createdAt: now }] };
      if (lost) { lost = false; throw new Error('Fixture response interrupted'); }
      return { operations: structuredClone(server) };
    },
  };
  const controller = createDeliveryOperationsController(ports); controller.context('sender', id);
  return { controller, ports, writes, advance: ms => { now += ms; }, changeOwner: () => { owner = 'different-account'; }, lose: () => { lost = true; }, wrongTarget: () => { server.rideId = otherId; } };
}
test('interrupted confirmation retries the original command and key rather than another action', async () => {
  const f = fixture(); await f.controller.refresh(); f.lose();
  await f.controller.command('report', { reason: 'recipient_unavailable', note: 'Fixture instruction.' });
  assert.equal(f.controller.snapshot().uncertain, true); assert.equal(f.controller.snapshot().data, null);
  await f.controller.command('request_return'); assert.equal(f.writes.length, 1);
  await f.controller.retry(); assert.deepEqual(f.writes[0], f.writes[1]);
  assert.equal(f.controller.snapshot().uncertain, false); assert.equal(f.controller.snapshot().data.version, 1);
});
test('a changed account erases private data and cannot execute a cached action', async () => {
  const f = fixture(); await f.controller.refresh(); f.changeOwner();
  await f.controller.command('report', { reason: 'recipient_unavailable' });
  assert.equal(f.writes.length, 0); assert.equal(f.controller.snapshot().data, null);
  assert.equal(f.controller.snapshot().busy, false);
});
test('old action permissions and mismatched target responses do not enable commands', async () => {
  const f = fixture(); await f.controller.refresh(); f.advance(30000); f.controller.tick();
  await f.controller.command('report', { reason: 'recipient_unavailable' }); assert.equal(f.writes.length, 0);
  f.wrongTarget(); await f.controller.refresh(); assert.equal(f.controller.snapshot().data, null);
});
test('closing a screen discards a late read without populating another account', async () => {
  let release;
  const controller = createDeliveryOperationsController({ verify: async () => true, makeKey: () => 'fixture-command',
    read: async () => new Promise(resolve => { release = resolve; }), write: async () => { throw new Error('No writes expected'); } });
  controller.context('sender', id); const reading = controller.refresh(); await new Promise(resolve => setImmediate(resolve));
  controller.close(); release({ operations: {} }); await reading;
  assert.equal(controller.snapshot().data, null); assert.equal(controller.snapshot().loading, false);
});
test('permission projection disables unavailable operations before transport', async () => {
  const f = fixture(); await f.controller.refresh();
  await f.controller.command('authorize_return', { note: 'Not yet available.' });
  await f.controller.command('confirm_return', { confirmation: 'RECEIVED' });
  assert.equal(f.writes.length, 0);
});
