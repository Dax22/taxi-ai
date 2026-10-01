import test from 'node:test';
import assert from 'node:assert/strict';
import { setImmediate as settle } from 'node:timers/promises';
import { TripLocationController } from '../src/tracking/controller.ts';
import type { LocationShare, TrackingResult, Position } from '../src/tracking/contracts.ts';
import type { ControllerBackground } from '../src/tracking/background-contracts.ts';

const rideId = '00000000-0000-4000-8000-000000000001';
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(r => { resolve = r; }); return { promise, resolve }; }
function fixture(options: ConstructorParameters<typeof TripLocationController>[6] = {}) {
  let n = 10, mono = 0, wall = 1_000_000_000, canShare = true, share: LocationShare | null = null;
  const starts: Array<{ rideId: string; clientId: string; key: string }> = [];
  const stops: Array<{ id: string; clientId: string; key: string }> = [];
  const positions: Array<{ id: string; clientId: string; sequence: number; position: Position }> = [];
  const locations: Array<{ ask: boolean; current?: () => boolean }> = [];
  const saved = new Map<string, LocationShare>();
  const serverNow = () => 1000 + mono;
  const fresh = (): Position => ({ lat: 9.05, lng: 7.49, accuracy: 12, capturedAt: wall });
  const api: ConstructorParameters<typeof TripLocationController>[0] = {
    tracking: async () => ({ rideId, isDriver: true, canShare, share: share?.active ? structuredClone(share) : null, serverNow: serverNow() }),
    startTracking: async (rideId, clientId, key) => {
      starts.push({ rideId, clientId, key });
      const previous = saved.get(key);
      if (!previous) {
        share = { id: `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}`, rideId, owned: true, active: true,
          sequence: 0, startedAt: serverNow(), updatedAt: null, stale: true, position: null };
        saved.set(key, share);
      }
      return { share: structuredClone(previous ?? share!), replayed: !!previous, serverNow: serverNow() };
    },
    stopTracking: async (id, clientId, key) => {
      stops.push({ id, clientId, key });
      const replayed = saved.has(key);
      assert.equal(share?.id, id);
      Object.assign(share!, { active: false, position: null, updatedAt: null, stale: true });
      saved.set(key, share!);
      return { share: structuredClone(share!), replayed, serverNow: serverNow() };
    },
    trackingPosition: async (id, clientId, sequence, position) => {
      positions.push({ id, clientId, sequence, position: { ...position } });
      assert.equal(share?.id, id);
      Object.assign(share!, { sequence, position: { ...position }, updatedAt: serverNow(), stale: false });
      return { share: structuredClone(share!), replayed: false, serverNow: serverNow() };
    },
  };
  const f = { api, starts, stops, positions, locations, fresh,
    locate: async (ask: boolean, current?: () => boolean) => { locations.push({ ask, current }); return fresh(); },
    advance: (ms: number) => { mono += ms; wall += ms; },
    close: () => { canShare = false; if (share) share.active = false; },
    c: null as unknown as TripLocationController };
  f.c = new TripLocationController(api, rideId, () => `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}`,
    (ask, current) => f.locate(ask, current), () => mono, () => wall, options);
  return f;
}
async function activate(f: ReturnType<typeof fixture>) { f.c.activate(); await settle(); }
async function sharing(f: ReturnType<typeof fixture>) { await activate(f); await f.c.start(); assert.equal(f.c.snapshot().sharing, true); }

test('only explicit start acquires GPS; pause closes sharing and foreground does not resume it', async () => {
  const f = fixture(); await activate(f); await f.c.heartbeat();
  assert.equal(f.locations.length, 0);
  await f.c.start(); assert.equal(f.c.snapshot().sharing, true);
  await f.c.heartbeat(); assert.deepEqual(f.locations.map(v => v.ask), [true, false]);
  assert.deepEqual(f.positions.map(v => v.sequence), [1, 2]);
  f.c.pause(); await settle(); assert.equal(f.c.snapshot().sharing, false); assert.equal(f.stops.length, 1);
  await activate(f); await f.c.heartbeat(); assert.equal(f.locations.length, 2);
  await f.c.start(); assert.equal(f.locations.length, 3); assert.equal(f.c.snapshot().sharing, true);
});

test('pause during a permission prompt invalidates acquisition and never starts a server lease', async () => {
  const f = fixture(); await activate(f); const fix = deferred<Position>(); let isCurrent!: () => boolean;
  f.locate = async (_ask, current) => { isCurrent = current!; return fix.promise; };
  const start = f.c.start(); assert.equal(isCurrent(), true);
  f.c.pause(); assert.equal(isCurrent(), false); fix.resolve(f.fresh()); await start;
  assert.equal(f.starts.length, 0); assert.equal(f.positions.length, 0); assert.equal(f.c.snapshot().busy, false);
  await activate(f); await f.c.heartbeat(); assert.equal(f.starts.length, 0);
});

test('stop during a start response closes the late session without publishing a location', async () => {
  const f = fixture(); await activate(f); const response = deferred<TrackingResult>(); const real = f.api.startTracking;
  let result!: TrackingResult;
  f.api.startTracking = async (...args) => { result = await real(...args); return response.promise; };
  const start = f.c.start(); await settle(); await f.c.stop();
  response.resolve(result); await start;
  assert.equal(f.stops.length, 1); assert.equal(f.positions.length, 0); assert.equal(f.c.snapshot().sharing, false);
});

test('foregrounding before a late start response cannot restore revoked consent', async () => {
  const f = fixture(); await activate(f); const response = deferred<TrackingResult>(); const real = f.api.startTracking;
  let result!: TrackingResult;
  f.api.startTracking = async (...args) => { result = await real(...args); return response.promise; };
  const start = f.c.start(); await settle(); f.c.pause(); await activate(f);
  response.resolve(result); await start; await f.c.heartbeat();
  assert.equal(f.positions.length, 0); assert.equal(f.stops.length, 1); assert.equal(f.c.snapshot().sharing, false);
});

test('a late GPS fix after stop cannot be sent', async () => {
  const f = fixture(); await sharing(f); const fix = deferred<Position>(); let current!: () => boolean;
  f.locate = async (_ask, guard) => { current = guard!; return fix.promise; };
  const heartbeat = f.c.heartbeat(); await f.c.stop(); assert.equal(current(), false);
  fix.resolve(f.fresh()); await heartbeat;
  assert.equal(f.positions.length, 1); assert.equal(f.stops.length, 1); assert.equal(f.c.snapshot().sharing, false);
});

test('overlapping timers do not overlap GPS, position updates or tracking reads', async () => {
  const f = fixture(); await sharing(f); const fix = deferred<Position>(); let acquisitions = 0, reads = 0;
  f.locate = async () => { acquisitions++; return fix.promise; };
  const original = f.api.tracking;
  f.api.tracking = async (...args) => { reads++; return original(...args); };
  const heartbeat = f.c.heartbeat(); await f.c.heartbeat(); await f.c.refresh();
  assert.equal(acquisitions, 1); assert.equal(reads, 0);
  fix.resolve(f.fresh()); await heartbeat; assert.equal(f.positions.length, 2);
});

test('an uncertain start is retried with the original key and resolved by stopping, never by collecting again', async () => {
  const f = fixture(); await activate(f); const real = f.api.startTracking; let first = true;
  f.api.startTracking = async (...args) => { const result = await real(...args); if (first) { first = false; throw new Error('lost response'); } return result; };
  await f.c.start(); assert.equal(f.c.snapshot().uncertain, true); assert.equal(f.c.snapshot().sharing, false);
  await f.c.start(); await f.c.heartbeat(); f.c.pause(); await activate(f); await f.c.refresh();
  assert.equal(f.starts.length, 1); assert.equal(f.stops.length, 0);
  await f.c.retry(); assert.deepEqual(f.starts[1], f.starts[0]);
  assert.equal(f.locations.length, 1); assert.equal(f.positions.length, 0); assert.equal(f.stops.length, 1);
  assert.equal(f.c.snapshot().uncertain, false); assert.equal(f.c.snapshot().sharing, false);
});

test('an uncertain stop retains its immutable key across navigation and is only explicitly retried', async () => {
  const f = fixture(); await sharing(f); const real = f.api.stopTracking; let first = true;
  f.api.stopTracking = async (...args) => { const result = await real(...args); if (first) { first = false; throw new Error('lost response'); } return result; };
  await f.c.stop(); assert.equal(f.c.snapshot().uncertain, true);
  f.c.pause(); await activate(f); await f.c.heartbeat(); await f.c.refresh();
  assert.equal(f.stops.length, 1);
  await f.c.retry(); assert.deepEqual(f.stops[1], f.stops[0]); assert.equal(f.c.snapshot().uncertain, false);
});

test('failed position updates halt collection and close the known session', async () => {
  const f = fixture(); await sharing(f);
  f.api.trackingPosition = async () => { throw new Error('offline'); };
  await f.c.heartbeat(); assert.equal(f.c.snapshot().sharing, false); assert.equal(f.stops.length, 1);
  const count = f.locations.length; await f.c.heartbeat(); await f.c.refresh(); assert.equal(f.locations.length, count);
  assert.match(f.c.snapshot().error, /collection has stopped/);
});

test('GPS capture ages use anchored server time, tolerating a skewed phone clock without freshening old fixes', async () => {
  const f = fixture(); await sharing(f);
  assert.equal(f.positions[0].position.capturedAt, 1000);
  f.advance(12_000); f.locate = async () => ({ ...f.fresh(), capturedAt: f.fresh().capturedAt - 2000 });
  await f.c.heartbeat(); assert.equal(f.positions[1].position.capturedAt, 11_000);
  f.locate = async () => ({ ...f.fresh(), capturedAt: f.fresh().capturedAt - 30_000 });
  await f.c.heartbeat(); assert.equal(f.positions.length, 2); assert.equal(f.c.snapshot().sharing, false); assert.equal(f.stops.length, 1);
});

test('local time marks locations stale and ends collection after lease expiry without needing a successful read', async () => {
  const f = fixture(); await sharing(f);
  f.advance(30_000); f.c.tick();
  assert.equal(f.c.snapshot().data?.share?.stale, true); assert.equal(f.c.snapshot().stale, true);
  f.advance(30_000); f.c.tick();
  assert.equal(f.c.snapshot().data?.share?.active, false); assert.equal(f.c.snapshot().sharing, false);
  await settle(); assert.equal(f.stops.length, 1); assert.equal(f.locations.length, 1);
});

test('a terminal backend journey stops local updates', async () => {
  const f = fixture(); await sharing(f); f.close(); await f.c.refresh(); await f.c.heartbeat();
  assert.equal(f.c.snapshot().data?.canShare, false); assert.equal(f.c.snapshot().sharing, false);
  assert.equal(f.locations.length, 1);
});

test('disposal cannot restore coordinates from a late start and still attempts to close that session', async () => {
  const f = fixture(); await activate(f); const response = deferred<TrackingResult>(); const real = f.api.startTracking;
  let result!: TrackingResult;
  f.api.startTracking = async (...args) => { result = await real(...args); return response.promise; };
  const start = f.c.start(); await settle(); f.c.dispose(); response.resolve(result); await start;
  assert.equal(f.stops.length, 1); assert.equal(f.positions.length, 0);
  assert.equal(f.c.snapshot().data, null); assert.equal(f.c.snapshot().sharing, false); assert.equal(f.c.snapshot().busy, false);
});

test('a definite cleanup rejection does not recursively issue new stop commands', async () => {
  const f = fixture(); await sharing(f); let attempted = 0;
  f.api.stopTracking = async () => { attempted++; throw Object.assign(new Error('session ended'), { status: 401 }); };
  await f.c.stop(); assert.equal(attempted, 1); assert.equal(f.c.snapshot().sharing, false); assert.equal(f.c.snapshot().uncertain, false);
});

test('permission loss during a heartbeat stops the server share and does not prompt again', async () => {
  const f = fixture(); await sharing(f); let ask: boolean | undefined;
  f.locate = async value => { ask = value; throw new Error('permission revoked'); };
  await f.c.heartbeat(); assert.equal(ask, false); assert.equal(f.stops.length, 1);
  assert.equal(f.c.snapshot().sharing, false); assert.match(f.c.snapshot().error, /permission revoked/);
});

test('a position response after backgrounding is cleaned up and cannot restart collection', async () => {
  const f = fixture(); await sharing(f); const response = deferred<TrackingResult>();
  const real = f.api.trackingPosition; let result!: TrackingResult;
  f.api.trackingPosition = async (...args) => { result = await real(...args); return response.promise; };
  const heartbeat = f.c.heartbeat(); await settle(); f.c.pause(); await activate(f);
  response.resolve(result); await heartbeat; await f.c.heartbeat();
  assert.equal(f.stops.length, 1); assert.equal(f.c.snapshot().sharing, false); assert.equal(f.locations.length, 2);
});

test('late position and tracking responses cannot repopulate a disposed account', async () => {
  const f = fixture(); await sharing(f); const response = deferred<TrackingResult>();
  const real = f.api.trackingPosition; let result!: TrackingResult;
  f.api.trackingPosition = async (...args) => { result = await real(...args); return response.promise; };
  const heartbeat = f.c.heartbeat(); await settle(); f.c.dispose(); response.resolve(result); await heartbeat;
  assert.equal(f.stops.length, 1); assert.equal(f.c.snapshot().data, null); assert.equal(f.c.snapshot().sharing, false);
  const other = fixture(); const tracking = deferred<Awaited<ReturnType<typeof other.api.tracking>>>();
  const data = await other.api.tracking(rideId, other.c.clientId); other.api.tracking = () => tracking.promise;
  other.c.activate(); other.c.dispose(); tracking.resolve(data); await settle(); assert.equal(other.c.snapshot().data, null);
});

test('viewing another sharing device does not acquire GPS or stop its session', async () => {
  const f = fixture(); const result = await f.api.startTracking(rideId, 'another-device', 'another-key');
  const original = f.api.tracking;
  f.api.tracking = async (...args) => ({ ...await original(...args), isDriver: false, canShare: false,
    share: { ...result.share, owned: false } });
  await activate(f); await f.c.heartbeat(); f.c.pause(); await settle();
  assert.equal(f.locations.length, 0); assert.equal(f.stops.length, 0);
});

function backgroundFixture() {
  const prepared: Array<() => boolean> = [], started: Array<{ share: LocationShare; serverNow: number; current: () => boolean }> = [];
  let enabled = false, stopped = 0;
  const background: ControllerBackground = {
    prepare: async current => { prepared.push(current); },
    start: async (share, serverNow, current) => { started.push({ share: structuredClone(share), serverNow, current }); enabled = true; },
    stop: async () => { stopped++; enabled = false; },
    active: async () => enabled,
  };
  const f = fixture({ kind: 'ride', background });
  return Object.assign(f, { background, prepared, started, backgroundStops: () => stopped, loseBackground: () => { enabled = false; } });
}

test('explicit background sharing prepares once, preserves consent while suspended, and has no foreground GPS publisher', async () => {
  const f = backgroundFixture(); await activate(f); await f.c.heartbeat();
  assert.equal(f.prepared.length, 0); assert.equal(f.started.length, 0);
  await f.c.start(); assert.equal(f.c.snapshot().background, true);
  assert.equal(f.prepared.length, 1); assert.equal(f.started.length, 1);
  assert.equal(f.started[0].share.sequence, 1); assert.equal(f.positions.length, 1);
  await f.c.heartbeat(); f.c.suspend(); await f.c.heartbeat();
  assert.equal(f.backgroundStops(), 0); assert.equal(f.c.snapshot().sharing, true);
  await activate(f); await f.c.heartbeat();
  assert.equal(f.locations.length, 1); assert.equal(f.positions.length, 1); assert.equal(f.started.length, 1);
});

test('the background permission settings handoff preserves only its explicitly pending consent', async () => {
  const f = backgroundFixture(), permission = deferred<void>(); let current!: () => boolean;
  f.background.prepare = async guard => { current = guard; await permission.promise; };
  await activate(f); const starting = f.c.start(); await settle(); f.c.suspend();
  assert.equal(current(), true); permission.resolve(); await starting;
  assert.equal(f.starts.length, 1); assert.equal(f.started.length, 1); assert.equal(f.c.snapshot().background, true);
});

test('Stop during a background permission handoff discards its late grant without starting GPS or sharing', async () => {
  const f = backgroundFixture(), permission = deferred<void>(); let current!: () => boolean;
  f.background.prepare = async guard => { current = guard; await permission.promise; };
  await activate(f); const starting = f.c.start(); await settle(); f.c.suspend(); await f.c.stop();
  assert.equal(current(), false); permission.resolve(); await starting;
  assert.equal(f.starts.length, 0); assert.equal(f.started.length, 0); assert.equal(f.locations.length, 0);
  assert.equal(f.c.snapshot().background, false); assert.equal(f.c.snapshot().sharing, false);
});

test('account teardown closes background sharing and later activation never resumes it implicitly', async () => {
  const f = backgroundFixture(); await sharing(f); f.c.pause(); await settle();
  assert.equal(f.c.snapshot().background, false); assert.equal(f.c.snapshot().sharing, false);
  assert.equal(f.stops.length, 1); assert.ok(f.backgroundStops() >= 1);
  await activate(f); await f.c.heartbeat(); assert.equal(f.started.length, 1); assert.equal(f.locations.length, 1);
});

test('disposal during background registration discards its late completion and clears the share', async () => {
  const f = backgroundFixture(), registered = deferred<void>(); let current!: () => boolean;
  f.background.start = async (_share, _serverNow, guard) => { current = guard; await registered.promise; };
  await activate(f); const starting = f.c.start(); await settle(); f.c.dispose();
  assert.equal(current(), false); registered.resolve(); await starting;
  assert.equal(f.c.snapshot().data, null); assert.equal(f.c.snapshot().background, false);
  assert.equal(f.stops.length, 1); assert.ok(f.backgroundStops() >= 1);
});

test('failed background registration closes the confirmed foreground share without starting an offline retry loop', async () => {
  const f = backgroundFixture(); f.background.start = async () => { throw new Error('native task unavailable'); };
  await activate(f); await f.c.start();
  assert.equal(f.c.snapshot().sharing, false); assert.equal(f.c.snapshot().background, false);
  assert.equal(f.c.snapshot().uncertain, false); assert.equal(f.stops.length, 1);
  await f.c.heartbeat(); assert.equal(f.locations.length, 1); assert.equal(f.starts.length, 1);
});

test('an inactive background publisher or terminal job stops sharing when the UI checks it', async () => {
  for (const ended of ['publisher', 'trip']) {
    const f = backgroundFixture(); await sharing(f);
    if (ended === 'publisher') f.loseBackground(); else f.close();
    await f.c.heartbeat();
    assert.equal(f.c.snapshot().background, false); assert.equal(f.c.snapshot().sharing, false);
    assert.ok(f.backgroundStops() >= 1); assert.equal(f.locations.length, 1);
  }
});

test('a stale background-health response cannot stop a newer explicitly started sharing session', async () => {
  for (const failure of ['inactive', 'rejected']) {
    const f = backgroundFixture(); await sharing(f); const health = deferred<boolean>();
    f.background.active = async () => { const result = await health.promise; if (failure === 'rejected') throw new Error('old check failed'); return result; };
    const checking = f.c.heartbeat(); await f.c.stop(); await f.c.refresh(); await f.c.start();
    assert.equal(f.c.snapshot().background, true); assert.equal(f.starts.length, 2);
    health.resolve(false); await checking;
    assert.equal(f.c.snapshot().background, true); assert.equal(f.c.snapshot().sharing, true);
    assert.equal(f.stops.length, 1);
  }
});

test('suspending without an explicitly enabled background port retains the foreground stop behavior', async () => {
  const f = fixture(); await sharing(f); f.c.suspend(); await settle();
  assert.equal(f.c.snapshot().sharing, false); assert.equal(f.stops.length, 1);
  await activate(f); await f.c.heartbeat(); assert.equal(f.locations.length, 1);
});
