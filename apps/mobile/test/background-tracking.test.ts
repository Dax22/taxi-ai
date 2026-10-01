import test from 'node:test';
import assert from 'node:assert/strict';
import { setImmediate as settle } from 'node:timers/promises';
import { BackgroundLocationManager, readBackgroundLease } from '../src/tracking/background-core.ts';
import type { BackgroundGrant, BackgroundLease, BackgroundNative, BackgroundTrackingApi, BackgroundVault } from '../src/tracking/background-contracts.ts';
import type { LocationShare, Position } from '../src/tracking/contracts.ts';

const jobId = '00000000-0000-4000-8000-000000000001';
const shareId = '00000000-0000-4000-8000-000000000002';
const clientId = '00000000-0000-4000-8000-000000000003';
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}
function fixture() {
  let now = 1_800_000_000_000, raw: string | null = null;
  const initialWall = now, initialServer = now - 123_000;
  const events: string[] = [], writes: string[] = [], stops: string[] = [];
  const positions: Array<{ token: string; sequence: number; position: Position }> = [];
  const authorization: BackgroundGrant = { token: 'a'.repeat(64), kind: 'ride', jobId, shareId, clientId,
    sequence: 3, expiresAt: initialServer + 3_600_000 };
  const grants = new Map([[authorization.token, authorization]]);
  const serverNow = () => initialServer + now - initialWall;
  const vault: BackgroundVault = {
    read: async () => raw,
    write: async value => { events.push('write'); writes.push(value); raw = value; },
    clear: async () => { events.push('clear'); raw = null; },
  };
  const native: BackgroundNative = {
    start: async () => { events.push('native-start'); },
    stop: async () => { events.push('native-stop'); },
    permissions: async () => { events.push('permissions'); return true; },
  };
  const api: BackgroundTrackingApi = {
    position: async (token, sequence, position) => {
      positions.push({ token, sequence, position: { ...position } });
      const grant = grants.get(token)!;
      const share: LocationShare = { id: grant.shareId, rideId: grant.jobId, owned: true, active: true,
        sequence, startedAt: initialServer, updatedAt: serverNow(), stale: false, position: { ...position } };
      return { share, serverNow: serverNow() };
    },
    stop: async token => { events.push('api-stop'); stops.push(token); },
  };
  const manager = () => new BackgroundLocationManager({ vault, native, api, clock: () => now });
  return { vault, native, api, manager, m: manager(), authorization, grants, events, writes, stops, positions,
    now: () => now, serverNow, advance: (ms: number) => { now += ms; },
    fresh: (overrides: Partial<Position> = {}): Position => ({ lat: 9.05, lng: 7.49, accuracy: 12, capturedAt: now, ...overrides }),
    raw: () => raw, seed: (value: string | null) => { raw = value; },
    record: () => readBackgroundLease(raw),
  };
}

async function begin(f: ReturnType<typeof fixture>, grant = f.authorization) {
  f.grants.set(grant.token, grant);
  await f.m.begin({ background: grant, serverNow: f.serverNow() });
}
function scope(grant: BackgroundGrant) { return { kind: grant.kind, jobId: grant.jobId, clientId: grant.clientId }; }

test('begin persists only scoped authority before native registration, without publishing coordinates', async () => {
  const f = fixture(); await begin(f);
  assert.ok(f.events.indexOf('write') < f.events.indexOf('native-start'));
  assert.equal(f.positions.length, 0);
  assert.deepEqual(Object.keys(f.record()!).sort(), ['clientId', 'expiresAt', 'jobId', 'kind', 'lastSuccessAt', 'savedAt',
    'sequence', 'serverNow', 'shareId', 'token', 'version'].sort());
  assert.equal((await f.m.current())?.token, f.authorization.token);
});

test('permission denial and storage failure never register a native task and revoke the issued capability', async () => {
  for (const failure of ['permission', 'storage']) {
    const f = fixture();
    if (failure === 'permission') f.native.permissions = async () => false;
    else f.vault.write = async () => { throw new Error('secure storage unavailable'); };
    await assert.rejects(begin(f));
    assert.equal(f.events.includes('native-start'), false);
    assert.equal(f.raw(), null);
    assert.deepEqual(f.stops, [f.authorization.token]);
  }
});

test('native registration failure erases stored authority and closes the issued share', async () => {
  const f = fixture(); f.native.start = async () => { throw new Error('OS registration rejected'); };
  await assert.rejects(begin(f), /registration rejected/);
  assert.equal(f.raw(), null); assert.deepEqual(f.stops, [f.authorization.token]);
});

test('authorization expiring during permission lookup or OS registration cannot leave background tracking enabled', async () => {
  for (const stage of ['permission', 'registration']) for (const deadline of ['capability', 'share']) {
    const f = fixture(), gate = deferred<void>();
    const grant = deadline === 'capability' ? { ...f.authorization, expiresAt: f.serverNow() + 20_000 } : f.authorization;
    if (stage === 'permission') f.native.permissions = async () => { await gate.promise; return true; };
    else f.native.start = async () => { f.events.push('native-start'); await gate.promise; };
    const starting = begin(f, grant); await settle();
    f.advance(deadline === 'capability' ? 20_000 : 60_000); gate.resolve(); await starting.catch(() => {});
    assert.equal(f.raw(), null); assert.equal(await f.m.current(), null);
    assert.deepEqual(f.stops, [grant.token]); assert.equal(f.positions.length, 0);
    assert.equal(f.events.includes('native-start'), stage === 'registration');
    if (stage === 'registration') assert.ok(f.events.lastIndexOf('native-stop') > f.events.indexOf('native-start'));
  }
});

test('revoked consent during permission lookup cannot persist or start collection', async () => {
  const f = fixture(), permission = deferred<boolean>(); let current = true;
  f.native.permissions = () => permission.promise;
  const starting = f.m.begin({ background: f.authorization, serverNow: f.serverNow() }, () => current);
  await settle(); current = false; permission.resolve(true); await starting;
  assert.equal(f.raw(), null); assert.equal(f.writes.length, 0);
  assert.equal(f.events.includes('native-start'), false); assert.deepEqual(f.stops, [f.authorization.token]);
});

test('Stop during permission or secure-storage work rejects every late start', async () => {
  for (const stage of ['permission', 'storage']) {
    const f = fixture(), gate = deferred<void>();
    if (stage === 'permission') f.native.permissions = async () => { await gate.promise; return true; };
    else { const write = f.vault.write; f.vault.write = async value => { await gate.promise; await write(value); }; }
    const starting = begin(f); await settle(); const stopping = f.m.stop();
    gate.resolve(); await Promise.all([starting, stopping]);
    assert.equal(f.raw(), null); assert.equal(f.events.includes('native-start'), false);
    assert.ok(f.stops.includes(f.authorization.token));
  }
});

test('Stop during OS registration closes a late successful registration and cannot resume on a callback', async () => {
  const f = fixture(), registered = deferred<void>();
  f.native.start = async () => { f.events.push('native-start'); await registered.promise; };
  const starting = begin(f); await settle(); const stopping = f.m.stop();
  registered.resolve(); await Promise.all([starting, stopping]); f.advance(10_000);
  await f.m.handle([f.fresh()]);
  assert.equal(f.raw(), null); assert.equal(f.positions.length, 0);
  assert.ok(f.events.lastIndexOf('native-stop') > f.events.indexOf('native-start'));
});

test('publication selects the newest valid fix, translates its original age, and retains no GPS history', async () => {
  const f = fixture(); await begin(f); f.advance(10_000);
  await f.m.handle([
    f.fresh({ capturedAt: f.now() - 2000, lng: 7.48 }), f.fresh({ capturedAt: f.now() - 1000, lng: 7.50 }),
    f.fresh({ lat: 41.88, lng: -87.63 }), f.fresh({ accuracy: 201 }), f.fresh({ accuracy: 0 }),
    f.fresh({ lat: NaN }), f.fresh({ capturedAt: f.now() - 30_000 }), f.fresh({ capturedAt: f.now() + 5001 }),
  ]);
  assert.equal(f.positions.length, 1);
  assert.deepEqual(f.positions[0], { token: f.authorization.token, sequence: 4,
    position: { lat: 9.05, lng: 7.50, accuracy: 12, capturedAt: f.serverNow() - 1000 } });
  assert.equal(f.record()?.sequence, 4);
  assert.equal(f.raw()?.includes('capturedAt'), false); assert.equal(f.raw()?.includes('position'), false);
});

test('a callback cannot send before the minimum interval and invalid fixes never renew the lease', async () => {
  const f = fixture(); await begin(f);
  await f.m.handle([f.fresh()]); f.advance(9999); await f.m.handle([f.fresh()]);
  assert.equal(f.positions.length, 0); const successAt = f.record()?.lastSuccessAt;
  f.advance(1); await f.m.handle([f.fresh({ accuracy: Infinity }), f.fresh({ capturedAt: f.now() - 30_000 })]);
  assert.equal(f.record()?.lastSuccessAt, successAt); assert.equal(f.positions.length, 0);
  await f.m.handle([f.fresh()]); assert.equal(f.positions.length, 1);
});

test('overlapping task callbacks serialize publication and sequence across a headless reconstruction', async () => {
  const f = fixture(); await begin(f); f.advance(10_000);
  const response = deferred<Awaited<ReturnType<BackgroundTrackingApi['position']>>>();
  const send = f.api.position; let accepted!: Awaited<ReturnType<BackgroundTrackingApi['position']>>;
  f.api.position = async (...args) => { accepted = await send(...args); return response.promise; };
  const first = f.m.handle([f.fresh()]); await settle(); const second = f.m.handle([f.fresh()]);
  await settle(); assert.equal(f.positions.length, 1); response.resolve(accepted); await Promise.all([first, second]);
  assert.equal(f.positions.length, 1); f.api.position = send;
  const restored = f.manager(); f.advance(10_000); await restored.handle([f.fresh()]);
  assert.deepEqual(f.positions.map(p => p.sequence), [4, 5]);
});

test('Stop during a network response prevents state resurrection and drops already queued callbacks', async () => {
  const f = fixture(); await begin(f); f.advance(10_000);
  const response = deferred<Awaited<ReturnType<BackgroundTrackingApi['position']>>>(), send = f.api.position;
  let accepted!: Awaited<ReturnType<BackgroundTrackingApi['position']>>;
  f.api.position = async (...args) => { accepted = await send(...args); return response.promise; };
  const running = f.m.handle([f.fresh()]); await settle(); const queued = f.m.handle([f.fresh()]);
  const stopping = f.m.stop(); response.resolve(accepted); await Promise.all([running, queued, stopping]);
  assert.equal(f.raw(), null); assert.equal(f.positions.length, 1); assert.equal(f.writes.length, 1);
});

test('a failed send closes authority and a restored manager never replays that GPS fix', async () => {
  const f = fixture(); await begin(f); f.advance(10_000); let attempts = 0;
  f.api.position = async () => { attempts++; throw new Error('offline'); };
  await f.m.handle([f.fresh()]); assert.equal(f.raw(), null); assert.deepEqual(f.stops, [f.authorization.token]);
  f.advance(10_000); await f.manager().handle([f.fresh()]); assert.equal(attempts, 1);
});

test('terminal, unowned, mismatched, and out-of-sequence confirmations all stop publication', async () => {
  const invalid: Array<(share: LocationShare) => LocationShare> = [
    share => ({ ...share, active: false }), share => ({ ...share, owned: false }),
    share => ({ ...share, id: jobId }), share => ({ ...share, rideId: shareId }),
    share => ({ ...share, sequence: share.sequence + 1 }),
  ];
  for (const alter of invalid) {
    const f = fixture(); await begin(f); f.advance(10_000); const send = f.api.position;
    f.api.position = async (...args) => { const result = await send(...args); return { ...result, share: alter(result.share) }; };
    await f.m.handle([f.fresh()]); assert.equal(f.raw(), null); assert.deepEqual(f.stops, [f.authorization.token]);
  }
});

test('permission revocation stops publication without requesting another permission', async () => {
  const f = fixture(); await begin(f); f.advance(10_000); f.native.permissions = async () => false;
  await f.m.handle([f.fresh()]); assert.equal(f.positions.length, 0); assert.equal(f.raw(), null);
  assert.deepEqual(f.stops, [f.authorization.token]);
});

test('permission-check and vault-read exceptions stop collection without sending a point', async () => {
  for (const failure of ['permission', 'storage']) {
    const f = fixture(); await begin(f); f.advance(10_000);
    if (failure === 'permission') f.native.permissions = async () => { throw new Error('permission lookup failed'); };
    else f.vault.read = async () => { throw new Error('vault read failed'); };
    await f.m.handle([f.fresh()]);
    assert.equal(f.positions.length, 0); assert.equal(f.raw(), null);
    assert.ok(f.events.includes('native-stop')); assert.ok(f.stops.includes(f.authorization.token));
  }
});

test('Stop with an unreadable vault erases durable authority and revokes the known grant before a cold restart', async () => {
  const f = fixture(); await begin(f); const read = f.vault.read;
  f.vault.read = async () => { throw new Error('vault temporarily unreadable'); };
  await f.m.stop().catch(() => {});
  assert.equal(f.raw(), null); assert.ok(f.events.includes('clear')); assert.ok(f.events.includes('native-stop'));
  assert.deepEqual(f.stops, [f.authorization.token]);
  f.vault.read = read; f.advance(10_000); await f.manager().handle([f.fresh()]);
  assert.equal(f.positions.length, 0);
});

test('a cold scoped Stop with an unreadable vault clears local authority and stops the OS task', async () => {
  const f = fixture(); await begin(f); const cold = f.manager(), read = f.vault.read;
  f.vault.read = async () => { throw new Error('vault temporarily unreadable'); };
  await cold.stop(scope(f.authorization)).catch(() => {});
  assert.equal(f.raw(), null); assert.ok(f.events.includes('clear')); assert.ok(f.events.includes('native-stop'));
  assert.deepEqual(f.stops, []);
  f.vault.read = read; f.advance(10_000); await f.manager().handle([f.fresh()]);
  assert.equal(f.positions.length, 0);
});

test('begin revokes its newly issued grant if reading prior durable authority fails', async () => {
  const f = fixture(); f.vault.read = async () => { throw new Error('vault temporarily unreadable'); };
  await assert.rejects(begin(f), /vault temporarily unreadable/);
  assert.deepEqual(f.stops, [f.authorization.token]); assert.equal(f.raw(), null);
  assert.equal(f.events.includes('native-start'), false); assert.equal(f.positions.length, 0);
});

test('failed local erasure still stops the OS task, revokes remotely, and disables further local publication', async () => {
  const f = fixture(); await begin(f); f.advance(10_000);
  f.vault.clear = async () => { throw new Error('vault delete failed'); };
  await f.m.stop().catch(() => {});
  assert.ok(f.events.includes('native-stop')); assert.deepEqual(f.stops, [f.authorization.token]);
  await f.m.handle([f.fresh()]).catch(() => {}); assert.equal(f.positions.length, 0);
});

test('expired, missing, and corrupt durable authority unregister the OS task without publishing', async () => {
  for (const state of ['expired', 'missing', 'corrupt']) {
    const f = fixture(); if (state === 'expired') { await begin(f); f.advance(60_000); }
    else if (state === 'corrupt') f.seed('{not json');
    await f.m.handle([f.fresh()]);
    assert.equal(f.raw(), null); assert.equal(f.positions.length, 0); assert.ok(f.events.includes('native-stop'));
  }
});

test('grant expiry and backward wall-clock changes fail closed even with a recent server share', async () => {
  for (const change of ['expiry', 'clock']) {
    const f = fixture(); await begin(f, { ...f.authorization, expiresAt: f.serverNow() + 20_000 });
    f.advance(change === 'expiry' ? 20_000 : -1);
    assert.equal(await f.m.current(), null); assert.equal(f.raw(), null);
    assert.deepEqual(f.stops, [f.authorization.token]);
  }
});

test('a mismatched scoped Stop cannot stop another known job, including after state restoration', async () => {
  const f = fixture(); await begin(f); const restored = f.manager(); await restored.current();
  const before = [...f.events]; await restored.stop({ ...scope(f.authorization), jobId: shareId });
  assert.deepEqual(f.events, before); assert.equal(f.record()?.token, f.authorization.token);
  f.advance(10_000); await restored.handle([f.fresh()]); assert.equal(f.positions.length, 1);
});

test('a mismatched scoped Stop on a cold manager leaves another persisted job and its OS task untouched', async () => {
  const f = fixture(); await begin(f); const restored = f.manager(), before = [...f.events];
  await restored.stop({ ...scope(f.authorization), jobId: shareId });
  assert.deepEqual(f.events, before); assert.equal(f.record()?.token, f.authorization.token);
  f.advance(10_000); await restored.handle([f.fresh()]); assert.equal(f.positions.length, 1);
});

test('replacing a share revokes its old capability and old-scope cleanup cannot erase the new authority', async () => {
  const f = fixture(); await begin(f);
  const next: BackgroundGrant = { ...f.authorization, kind: 'food', token: 'b'.repeat(64), jobId: shareId, shareId: jobId };
  await begin(f, next); assert.deepEqual(f.stops, [f.authorization.token]);
  await f.m.stop(scope(f.authorization)); assert.equal(f.record()?.token, next.token);
  f.advance(10_000); await f.m.handle([f.fresh()]); assert.equal(f.positions[0].token, next.token);
});

test('Stop erases durable authority before awaiting OS or server cleanup', async () => {
  const f = fixture(); await begin(f); const stopped = deferred<void>();
  f.native.stop = async () => { await stopped.promise; };
  const stopping = f.m.stop(); await settle(); assert.equal(f.raw(), null);
  stopped.resolve(); await stopping; assert.deepEqual(f.stops, [f.authorization.token]);
});

test('lease reader rejects malformed and unbounded records before they can authorize callbacks', async () => {
  const f = fixture(); await begin(f); const valid = f.record()!;
  const invalid: unknown[] = [null, {}, [], { ...valid, version: 2 }, { ...valid, kind: 'courier' },
    { ...valid, sequence: -1 }, { ...valid, token: 'short' }, { ...valid, jobId: 'wrong' },
    { ...valid, savedAt: -1 }, { ...valid, lastSuccessAt: 1.5 },
    { ...valid, expiresAt: valid.serverNow }, { ...valid, expiresAt: valid.serverNow + 12 * 60 * 60_000 + 1 }];
  for (const value of invalid) assert.equal(readBackgroundLease(JSON.stringify(value)), null);
  assert.equal(readBackgroundLease('x'.repeat(4097)), null);
  assert.deepEqual(readBackgroundLease(JSON.stringify(valid)), valid as BackgroundLease);
});

test('unexpected account credentials and coordinates in a grant cannot enter durable background storage', async () => {
  const f = fixture();
  const withPrivateData = { ...f.authorization, accessToken: 'account-access', refreshToken: 'account-refresh',
    position: f.fresh(), history: [f.fresh()] };
  await begin(f, withPrivateData);
  for (const field of ['accessToken', 'refreshToken', 'position', 'history']) assert.equal(Object.hasOwn(f.record()!, field), false);
});

test('lease reader cannot return unexpected credentials, GPS history, or an unsafe connection', async () => {
  const f = fixture(); await begin(f); const valid = f.record()!;
  for (const extra of [{ refreshToken: 'private' }, { position: f.fresh() }, { history: [f.fresh()] }]) {
    const result = readBackgroundLease(JSON.stringify({ ...valid, ...extra }));
    for (const field of Object.keys(extra)) assert.equal(result !== null && Object.hasOwn(result, field), false);
  }
  for (const origin of ['http://public.example', 'https://user:password@example.com', 'https://example.com/path', 'https://example.com/?token=private'])
    assert.equal(readBackgroundLease(JSON.stringify({ ...valid, connection: { origin } })), null);
});
