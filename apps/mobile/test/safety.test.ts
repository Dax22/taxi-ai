import test from 'node:test';
import assert from 'node:assert/strict';
import { setImmediate as nextTurn } from 'node:timers/promises';
import { readFileSync } from 'node:fs';
import { SafetyController } from '../src/safety/controller.ts';
import type { SafetyCommand, SafetyContact, SafetyMutation, TripSafety } from '../../../packages/shared/src/mobile-safety.mjs';
const userId = '11111111-1111-4111-8111-111111111111', rideId = '22222222-2222-4222-8222-222222222222';
const contactId = '33333333-3333-4333-8333-333333333333', shareId = '44444444-4444-4444-8444-444444444444';
const base = { mode: 'simulation' as const, viewerId: userId, serverNow: 1000 };
const friend: SafetyContact = { id: contactId, name: 'Test friend', phone: '+2348000000000', version: 4, verified: false };
function fixture(id: string | null = rideId) {
  let localNow = 0, keys = 0;
  const contacts = [structuredClone(friend)], calls: { command: SafetyCommand; key: string }[] = [];
  const trip: TripSafety = { ...base, rideId, canRaise: true, incidents: [], share: null, location: null };
  const api: ConstructorParameters<typeof SafetyController>[0] = {
    origin: 'https://taxi.example.test',
    safetyContacts: async () => ({ ...base, contacts: structuredClone(contacts) }),
    tripSafety: async () => structuredClone(trip),
    safetyCommand: async (command, key): Promise<SafetyMutation> => {
      calls.push({ command: structuredClone(command), key });
      if (command.action === 'link.create') {
        trip.share = { id: shareId, rideId, active: true, version: 0, createdAt: 1000, expiresAt: 901000 };
        return { ...base, replayed: false, share: structuredClone(trip.share), token: 'a'.repeat(64) };
      }
      if (command.action === 'link.revoke') { trip.share = null; return { ...base, replayed: false, share: null, token: null }; }
      if (command.action === 'incident.create') {
        const incident = { id: contactId, rideId, kind: command.data.kind, status: 'open' as const, version: 0, note: command.data.note,
          createdAt: 1000, updatedAt: 1000, driverName: 'Test driver', vehiclePlate: 'TEST-ONLY', location: null, notifications: [], events: [] };
        trip.incidents = [incident]; return { ...base, replayed: false, incident };
      }
      return { ...base, replayed: false, contact: command.action === 'contact.remove' ? null : structuredClone(friend) };
    },
  };
  const c = new SafetyController(api, id, () => `command-${++keys}`, () => localNow);
  return { c, api, contacts, trip, calls, advance: (ms: number) => { localNow += ms; }, async start() { c.activate(); await nextTurn(); } };
}

test('opening safety only reads; explicit reports capture exactly the selected contact versions', async () => {
  const f = fixture(); await f.start();
  assert.equal(f.c.snapshot().stale, false); assert.equal(f.calls.length, 0);
  f.c.toggle(friend); f.c.edit('note', 'Private confirmed note');
  const command = f.c.reportCommand(); assert.ok(command && command.action === 'incident.create');
  assert.deepEqual(command.data.contactVersions, { [contactId]: 4 });
  await f.c.submit(command); await nextTurn();
  assert.equal(f.calls.length, 1); assert.equal(f.calls[0].command.action, 'incident.create');
  assert.match(f.c.snapshot().message, /No alerts were sent/); assert.equal(f.c.snapshot().note, '');
  f.c.dispose();
});

test('an interrupted command keeps its original key, recipient versions and note across navigation; no automatic mutation retry', async () => {
  const f = fixture(); await f.start(); const original = f.api.safetyCommand; let first = true;
  f.api.safetyCommand = async (command, key) => {
    if (first) { first = false; f.calls.push({ command: structuredClone(command), key }); throw new Error('Lost response'); }
    return original(command, key);
  };
  f.c.toggle(friend); f.c.edit('note', 'Original only'); await f.c.submit(f.c.reportCommand());
  assert.equal(f.c.snapshot().uncertain, true);
  const saved = structuredClone(f.calls[0]);
  f.c.pause(); assert.equal(f.c.snapshot().note, ''); assert.deepEqual(f.c.snapshot().contacts, []);
  f.c.activate(); await nextTurn(); f.c.edit('note', 'Must not replace pending command');
  await f.c.refresh(); assert.equal(f.calls.length, 1);
  await f.c.retry(); await nextTurn(); assert.equal(f.calls.length, 2); assert.deepEqual(f.calls[1], saved);
  assert.equal(f.c.snapshot().uncertain, false); f.c.dispose();
});

test('definite conflict clears the retry command and never silently substitutes a newer contact version', async () => {
  const f = fixture(); await f.start();
  f.api.safetyCommand = async (command, key) => { f.calls.push({ command, key }); throw Object.assign(new Error('Refresh the contact'), { status: 409, code: 'STALE_VERSION' }); };
  f.c.toggle(friend); await f.c.submit(f.c.reportCommand());
  assert.equal(f.c.snapshot().uncertain, false); assert.equal(f.c.snapshot().stale, true);
  await f.c.retry(); assert.equal(f.calls.length, 1); f.c.dispose();
});

test('contact edits preserve the version originally displayed and changed selected recipients are deselected on refresh', async () => {
  const f = fixture(); await f.start();
  f.c.editContact(friend); f.c.edit('name', 'New display name'); f.c.toggle(friend);
  f.contacts[0].version = 5; f.contacts[0].phone = '+2348000000009'; await f.c.refresh();
  const command = f.c.contactCommand(); assert.ok(command.action === 'contact.edit');
  assert.equal(command.data.expectedVersion, 4); assert.equal(command.data.phone, friend.phone);
  assert.deepEqual(f.c.snapshot().selected, {}); f.c.dispose();
});

test('share tokens stay outside rendered state and require an explicit revalidated OS-share action', async () => {
  const f = fixture(); await f.start(); await f.c.submit(f.c.linkCommand()); await nextTurn();
  assert.equal(f.c.snapshot().hasLink, true); assert.equal(JSON.stringify(f.c.snapshot()).includes('a'.repeat(64)), false);
  const shared: string[] = []; assert.equal(shared.length, 0);
  await f.c.shareLink(async (url) => { shared.push(url); });
  assert.deepEqual(shared, [`${f.api.origin}/trip-share#${'a'.repeat(64)}`]);
  assert.equal(f.c.snapshot().hasLink, false); assert.match(f.c.snapshot().message, /does not confirm delivery/);
  await f.c.shareLink(async (url) => { shared.push(url); }); assert.equal(shared.length, 1); f.c.dispose();
});

test('revoked and expired links cannot reach the share adapter', async () => {
  for (const reason of ['revoked', 'expired']) {
    const f = fixture(); await f.start(); await f.c.submit(f.c.linkCommand()); await nextTurn();
    if (reason === 'revoked') f.trip.share = null;
    else { f.advance(901000); f.c.tick(); }
    let shared = false; await f.c.shareLink(async () => { shared = true; });
    assert.equal(shared, false); assert.equal(f.c.snapshot().hasLink, false); f.c.dispose();
  }
});

test('backgrounding during share revalidation prevents any external sharing and clears private visible data', async () => {
  const f = fixture(); await f.start(); await f.c.submit(f.c.linkCommand()); await nextTurn();
  let release!: (value: TripSafety) => void;
  f.api.tripSafety = () => new Promise((resolve) => { release = resolve; });
  let shared = false; const running = f.c.shareLink(async () => { shared = true; });
  f.c.pause(); release(structuredClone(f.trip)); await running;
  assert.equal(shared, false); assert.equal(f.c.snapshot().hasLink, false);
  assert.equal(f.c.snapshot().trip, null); assert.deepEqual(f.c.snapshot().contacts, []); f.c.dispose();
});

test('background or disposal during an in-flight link creation cannot restore private data or secrets', async () => {
  for (const dispose of [false, true]) {
    const f = fixture(); await f.start(); let release!: (value: SafetyMutation) => void;
    f.api.safetyCommand = () => new Promise((resolve) => { release = resolve; });
    const running = f.c.submit(f.c.linkCommand());
    if (dispose) f.c.dispose(); else f.c.pause();
    release({ ...base, replayed: false, share: { id: shareId, rideId, active: true, version: 0, createdAt: 1000, expiresAt: 901000 }, token: 'a'.repeat(64) });
    await running;
    assert.equal(f.c.snapshot().hasLink, false); assert.equal(f.c.snapshot().trip, null); assert.deepEqual(f.c.snapshot().contacts, []);
    let shared = false; await f.c.shareLink(async () => { shared = true; }); assert.equal(shared, false); f.c.dispose();
  }
});

test('late reads after pause are discarded and failed revalidation clears stale private details', async () => {
  const f = fixture(); await f.start(); let release!: (value: TripSafety) => void;
  f.api.tripSafety = () => new Promise((resolve) => { release = resolve; });
  const running = f.c.refresh(); await Promise.resolve(); f.c.pause(); release(structuredClone(f.trip)); await running;
  assert.equal(f.c.snapshot().trip, null); assert.deepEqual(f.c.snapshot().contacts, []);
  f.api.tripSafety = async () => { throw new Error('Revoked or unavailable'); };
  f.c.activate(); await nextTurn(); assert.equal(f.c.snapshot().stale, true); assert.deepEqual(f.c.snapshot().contacts, []); f.c.dispose();
});

test('contacts-only safety cannot generate trip commands; disposed uncertain requests are not replayed', async () => {
  const f = fixture(null); await f.start(); assert.equal(f.c.linkCommand(), null); assert.equal(f.c.reportCommand(), null);
  f.api.safetyCommand = async (command, key) => { f.calls.push({ command, key }); throw new Error('Offline'); };
  f.c.edit('name', 'Test friend'); f.c.edit('phone', friend.phone); await f.c.submit(f.c.contactCommand());
  assert.equal(f.c.snapshot().uncertain, true); f.c.dispose(); f.c.activate(); await f.c.retry();
  assert.equal(f.calls.length, 1); assert.equal(f.c.snapshot().name, '');
});

test('native safety route is protected and both Account and journey screens expose navigation without coupling it to trip commands', () => {
  const layout = readFileSync(new URL('../app/_layout.tsx', import.meta.url), 'utf8');
  const journey = readFileSync(new URL('../app/journey.tsx', import.meta.url), 'utf8');
  const account = readFileSync(new URL('../app/(tabs)/account.tsx', import.meta.url), 'utf8');
  assert.match(layout, /Stack\.Protected guard=\{!!user\}[\s\S]*Stack\.Screen name="safety"/);
  assert.match(layout, /<SafetyProvider><Navigation\/><\/SafetyProvider>/);
  assert.match(journey, /title="Safety & trip sharing"/); assert.match(journey, /params:\{rideId:id\}/);
  assert.match(account, /router\.push\('\/safety'\)/);
});
