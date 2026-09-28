import test from 'node:test';
import assert from 'node:assert/strict';
import { setImmediate as settle } from 'node:timers/promises';
import { FamilyController } from '../src/family/controller.ts';
import { familyLocationStatus } from '../src/family/location.ts';
import { familyDeliveryLabel } from '../src/family/delivery.ts';
import { familyCheckInState } from '../src/family/check-in.ts';
import { pushTarget } from '../src/notifications/push-target.ts';
import type { FamilyResponse, FamilyTripResponse } from '../../../packages/shared/src/family.mjs';

const id = '00000000-0000-4000-8000-000000000001';
const dashboard = (): FamilyResponse => ({ serverNow: 10_000, family: { adultConfirmed: true, contacts: [], trips: [], availableTrips: [], inbox: [], limits: { contacts: 5, checkInCooldownMs: 300000 } } });
function fixture() {
  let serial = 0, time = 0;
  const calls: Array<{ action: string; data: Record<string, unknown>; key: string; signal?: AbortSignal }> = [];
  const api: ConstructorParameters<typeof FamilyController>[0] = {
    familyDashboard: async () => dashboard(),
    familyTrip: async () => { throw new Error('No trip selected'); },
    familyCommand: async (action, data, key, signal) => { calls.push({ action, data: structuredClone(data), key, signal }); return { ...dashboard(), replayed: false }; },
  };
  return { api, calls, advance: (amount: number) => { time += amount; }, c: new FamilyController(api, () => `family-key-${++serial}`, () => time) };
}
async function activate(f: ReturnType<typeof fixture>) { f.c.activate(); await settle(); }

test('family location labels age the GPS fix and never imply passenger tracking', () => {
  const position = { lat: 9.07, lng: 7.49, accuracy: 12, capturedAt: 1000, source: 'driver_shared' as const, stale: false };
  assert.equal(familyLocationStatus(position, 10_000, true).state, 'recent');
  assert.equal(familyLocationStatus(position, 31_000, true).state, 'stale');
  assert.equal(familyLocationStatus({ ...position, stale: true }, 1000, true).state, 'stale');
  assert.equal(familyLocationStatus(position, 1000, false).state, 'ended');
  assert.equal(familyLocationStatus(null, 1000, true).state, 'unavailable');
  assert.match(familyLocationStatus(position, 10_000, true).label, /vehicle/);
});

test('backgrounding aborts family reads and discards late private data until a new authorized read', async () => {
  const f = fixture(); let finish!: (value: FamilyResponse) => void, signal: AbortSignal | undefined;
  f.api.familyDashboard = async incoming => { signal = incoming; return new Promise(resolve => { finish = resolve; }); };
  f.c.activate(); await settle(); f.c.pause(); assert.equal(signal?.aborted, true);
  finish(dashboard()); await settle(); assert.equal(f.c.snapshot().family, null);
  f.api.familyDashboard = async () => dashboard(); await activate(f);
  assert.ok(f.c.snapshot().family); f.c.dispose();
});

test('a failed permission refresh removes family names, inbox and trip data', async () => {
  const f = fixture(); await activate(f); assert.ok(f.c.snapshot().family);
  f.api.familyDashboard = async () => { throw Object.assign(new Error('Connection revoked.'), { status: 403 }); };
  await f.c.refresh(); assert.equal(f.c.snapshot().family, null); assert.equal(f.c.snapshot().trip, null);
  assert.equal(f.c.snapshot().stale, true); f.c.dispose();
});

test('family uncertain commands preserve the exact body and key through backgrounding without automatic replay', async () => {
  const f = fixture(); await activate(f);
  f.api.familyCommand = async (action, data, key, signal) => {
    f.calls.push({ action, data: structuredClone(data), key, signal });
    if (f.calls.length === 1) throw new Error('Lost response');
    return { ...dashboard(), replayed: true };
  };
  const data = { shareId: id, expectedVersion: 2, response: 'help' };
  assert.equal(await f.c.command('respond', data), false); data.response = 'okay';
  assert.equal(f.c.snapshot().uncertain, true);
  f.c.pause(); await activate(f); assert.equal(f.calls.length, 1);
  await f.c.command('acknowledge', { eventId: id }); assert.equal(f.calls.length, 1);
  assert.equal(await f.c.retry(), true); assert.equal(f.calls[0].key, f.calls[1].key); assert.deepEqual(f.calls[0].data, f.calls[1].data);
  assert.equal(f.c.snapshot().uncertain, false); assert.match(f.c.snapshot().notice, /Emergency services have not been contacted/); f.c.dispose();
});

test('a family write cancelled by backgrounding cannot repopulate a hidden screen', async () => {
  const f = fixture(); await activate(f); let finish!: (value: Awaited<ReturnType<typeof f.api.familyCommand>>) => void, signal: AbortSignal | undefined;
  f.api.familyCommand = async (_action, _data, _key, incoming) => { signal = incoming; return new Promise(resolve => { finish = resolve; }); };
  const writing = f.c.command('acknowledge', { eventId: id }); f.c.pause(); assert.equal(signal?.aborted, true);
  finish({ ...dashboard(), replayed: false }); await writing;
  assert.equal(f.c.snapshot().family, null); assert.equal(f.c.snapshot().notice, ''); f.c.dispose();
});

test('family controller purges the view when its access has not been refreshed for one minute', async () => {
  const f = fixture(); await activate(f); f.advance(61_000); f.c.tick();
  assert.equal(f.c.snapshot().family, null); assert.equal(f.c.snapshot().stale, true);
  await f.c.command('share', { rideId: id, contactId: id }); assert.equal(f.calls.length, 0); f.c.dispose();
});

test('family trip response cannot replace a different selected grant', async () => {
  const f = fixture();
  f.api.familyDashboard = async () => ({ ...dashboard(), family: { ...dashboard().family, trips: [{ shareId: id } as FamilyResponse['family']['trips'][number]] } });
  f.api.familyTrip = async () => ({ serverNow: 10000, trip: { shareId: '00000000-0000-4000-8000-000000000002' } as FamilyTripResponse['trip'] });
  await activate(f); f.c.selectTrip(id); await settle();
  assert.equal(f.c.snapshot().trip, null); assert.equal(f.c.snapshot().family, null); assert.match(f.c.snapshot().error, /different shared trip/); f.c.dispose();
});

test('family push payloads only open a review prompt and reject missing or malformed event IDs', () => {
  assert.deepEqual(pushTarget({ kind: 'family', eventId: id }), { kind: 'family', eventId: id });
  assert.equal(pushTarget({ kind: 'family', eventId: '../private', notificationId: 5 }), null);
  assert.equal(pushTarget({ kind: 'family', eventId: 5 }), null);
  assert.equal(pushTarget({ kind: 'family' }), null);
  assert.deepEqual(pushTarget({ notificationId: 7 }), { kind: 'journey', notificationId: 7 });
});

test('notification service acceptance is not rendered as delivery or acknowledgment', () => {
  const delivery = { configured: true, acceptedAt: 10000, providerConfirmedAt: 10001, deliveredAt: null };
  assert.equal(familyDeliveryLabel({ ...delivery, status: 'provider_accepted' }), 'Accepted by notification service');
  assert.equal(familyDeliveryLabel({ ...delivery, status: 'queued' }), 'Phone alert queued');
  assert.equal(familyDeliveryLabel({ ...delivery, status: 'failed' }), 'Phone alert failed; update remains in the inbox');
  assert.equal(familyDeliveryLabel({ ...delivery, status: 'saved' }), 'Saved in the Family Safety inbox');
});

test('a new family check-in is pending after an earlier okay or help response', () => {
  assert.equal(familyCheckInState({ requestedAt: 1000, respondedAt: 2000, response: 'okay' }), 'okay');
  assert.equal(familyCheckInState({ requestedAt: 301001, respondedAt: 2000, response: 'okay' }), 'pending');
  assert.equal(familyCheckInState({ requestedAt: 301001, respondedAt: 2000, response: 'help' }), 'pending');
  assert.equal(familyCheckInState({ requestedAt: null, respondedAt: 2000, response: 'help' }), 'help');
});
