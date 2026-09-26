import test from 'node:test';
import assert from 'node:assert/strict';
import { setImmediate as settle } from 'node:timers/promises';
import { ParcelsController } from '../src/parcels/controller.ts';
import { ParcelLinkController } from '../src/parcels/link-controller.ts';
import { parcelInvitationToken } from '../src/parcels/invitation.ts';
import { readParcelResponse } from '../../../packages/shared/src/parcels.mjs';
import type { ParcelSnapshot } from '../../../packages/shared/src/parcels.mjs';
import type { Envelope } from '../../../packages/shared/src/mobile-contracts.mjs';

const id = '00000000-0000-4000-8000-000000000001', linkId = '00000000-0000-4000-8000-000000000002';
const token = 'd'.repeat(64), origin = 'https://taxi.example.test';
const env = { apiVersion: 1 as const, serverNow: 1_000_000 };
const parcel: ParcelSnapshot = { rideId: id, reference: 'PARCEL-00000000', status: 'in_progress', description: 'Sealed parcel',
  weightKg: 5, recipientName: 'Ada', destination: 'Maitama', driver: null,
  location: { lat: 9.08, lng: 7.4, accuracy: 8, capturedAt: env.serverNow, source: 'driver_shared', stale: false }, dropoffPin: '123456', verifiedAt: null, updatedAt: env.serverNow };
const link = { id: linkId, version: 1, active: true, expiresAt: env.serverNow + 100_000, claimed: false };
const invitation = { rideId: id, canCreate: true, link: null as typeof link | null };
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(r => { resolve = r; }); return { resolve, promise }; }
function fixture() {
  const calls: Array<{ path: string; data: unknown; key?: string }> = []; let time = 0;
  const api: ConstructorParameters<typeof ParcelsController>[0] = { origin, parcels: async (path, data, key) => {
    calls.push({ path, data, key });
    if (path === '/parcels/received') return { ...env, parcels: [structuredClone(parcel)] };
    if (path.endsWith('/invitation')) return { ...env, invitation: structuredClone(invitation) };
    return { ...env, parcel: structuredClone(parcel) };
  } };
  const controller = new ParcelsController(api, () => 'fixed-key', () => time);
  return { api, calls, controller, advance: (ms: number) => { time += ms; } };
}

test('recipient claims explicitly and binds only the validated invitation token', async () => {
  const f = fixture(); f.controller.activate(); await settle();
  f.controller.editInvitation(`${origin}/parcels#token=${token}`);
  assert.equal(f.calls.filter(c => c.path.endsWith('/accept')).length, 0);
  await f.controller.accept();
  assert.deepEqual(f.calls.at(-1), { path: '/parcels/accept', data: { token }, key: 'fixed-key' });
  assert.equal(f.controller.snapshot().selected?.dropoffPin, '123456'); assert.equal(f.controller.snapshot().invitation, '');
  f.controller.dispose(); assert.equal(f.controller.snapshot().selected, null);
});

test('invitation parser rejects foreign origins, wrong paths and query leakage', () => {
  assert.equal(parcelInvitationToken(token, origin), token);
  assert.equal(parcelInvitationToken(`${origin}/parcels#token=${token}`, origin), token);
  for (const value of [`https://other.example/parcels#token=${token}`, `${origin}/app#token=${token}`, `${origin}/parcels?token=${token}`, `${origin}/parcels#token=bad`, `${origin}/parcels#token=${token}&other=1`]) {
    assert.throws(() => parcelInvitationToken(value, origin));
  }
});

test('late recipient claims cannot restore data after backgrounding or disposal', async () => {
  const f = fixture(); f.controller.activate(); await settle();
  const pending = deferred<Envelope>(); f.api.parcels = () => pending.promise;
  f.controller.editInvitation(token); const action = f.controller.accept(); f.controller.pause();
  pending.resolve({ ...env, parcel }); await action;
  assert.equal(f.controller.snapshot().selected, null); assert.equal(f.controller.snapshot().invitation, '');
  assert.deepEqual(f.controller.snapshot().parcels, []); f.controller.dispose();
});

test('lost accept response retries immutable token/key and clears sensitive views on permission failures', async () => {
  const f = fixture(); f.controller.activate(); await settle(); f.controller.editInvitation(token);
  const attempts: unknown[] = []; f.api.parcels = async (path, data, key) => { attempts.push({ path, data, key }); throw new Error('Offline'); };
  await f.controller.accept(); assert.equal(f.controller.snapshot().uncertain, true);
  f.controller.editInvitation('b'.repeat(64)); await f.controller.retry(); assert.deepEqual(attempts[0], attempts[1]);
  f.api.parcels = async () => ({ ...env, parcel }); await f.controller.retry(); assert.equal(f.controller.snapshot().selected?.rideId, id);
  f.api.parcels = async () => { throw Object.assign(new Error('Invitation revoked'), { status: 403 }); };
  await f.controller.refresh(); assert.equal(f.controller.snapshot().selected, null); assert.deepEqual(f.controller.snapshot().parcels, []);
  assert.equal(f.controller.snapshot().stale, true); f.controller.dispose();
});

test('tracking snapshots expire without fresh permission checks and reject leaked completion codes', async () => {
  const f = fixture(); f.controller.activate(); await settle(); f.controller.select(id); await settle();
  assert.ok(f.controller.snapshot().selected?.location);
  f.advance(30_001); f.controller.tick(); assert.equal(f.controller.snapshot().selected, null); assert.deepEqual(f.controller.snapshot().parcels, []);
  assert.throws(() => readParcelResponse({ ...env, parcel: { ...parcel, status: 'completed' } }));
  assert.throws(() => readParcelResponse({ ...env, parcel: { ...parcel, rideId: linkId } }, id)); f.controller.dispose();
});

test('recipient permission snapshots require the native server clock', async () => {
  const f = fixture(); f.api.parcels = async () => ({ parcels: [parcel] } as unknown as Envelope); f.controller.activate(); await settle();
  assert.equal(f.controller.snapshot().stale, true); assert.deepEqual(f.controller.snapshot().parcels, []); f.controller.dispose();
});

test('sender invitations share only fresh secrets and remove them after claim, revoke or background', async () => {
  const f = fixture(), c = new ParcelLinkController(f.api, id, () => 'link-key'); c.activate(); await settle();
  f.api.parcels = async () => ({ ...env, invitation: { ...invitation, link }, token }); await c.create(null);
  assert.equal(c.snapshot().token, token);
  f.api.parcels = async () => ({ ...env, invitation: { ...invitation, link: { ...link, claimed: true } } }); await c.refresh();
  assert.equal(c.snapshot().token, ''); assert.equal(c.snapshot().value?.link?.claimed, true);
  f.api.parcels = async () => ({ ...env, invitation: { ...invitation, link: { ...link, version: 2, active: false, claimed: true } } });
  await c.revoke(linkId, 1); assert.equal(c.snapshot().value?.link?.active, false);
  c.pause(); assert.equal(c.snapshot().value, null); assert.equal(c.snapshot().token, ''); c.dispose();
});

test('lost create response retries one action and cannot redisclose a token from idempotency replay', async () => {
  const f = fixture(), c = new ParcelLinkController(f.api, id, () => 'link-key'); c.activate(); await settle();
  const attempts: unknown[] = []; f.api.parcels = async (path, data, key) => { attempts.push({ path, data, key }); throw new Error('Offline'); };
  await c.create(null); assert.equal(c.snapshot().uncertain, true); await c.create(null); assert.equal(attempts.length, 1);
  f.api.parcels = async (path, data, key) => { attempts.push({ path, data, key }); return { ...env, invitation: { ...invitation, link }, replayed: true }; };
  await c.retry(); assert.deepEqual(attempts[0], attempts[1]); assert.equal(c.snapshot().token, ''); assert.equal(c.snapshot().uncertain, false); c.dispose();
});
