import test from 'node:test';
import assert from 'node:assert/strict';
import { setImmediate as settle } from 'node:timers/promises';
import { BookingController } from '../src/booking/controller.ts';
import { routeDrawing } from '../src/booking/route-drawing.ts';
import { parsePreview, parseBookingRide } from '../../../packages/shared/src/mobile-booking.mjs';
import type { Booking, BookingPreview, BookingRide, BookingRideResult, PlacesResult } from '../../../packages/shared/src/mobile-booking.mjs';

const envelope = { apiVersion: 1 as const, serverNow: 1_000_000 };
const pickup = { name: 'Wuse test pickup', lat: 9.08, lng: 7.4 }, destination = { name: 'Test destination', lat: 9.1, lng: 7.45 };
const ride: BookingRide = { id: '00000000-0000-4000-8000-000000000000', version: 1, status: 'requested', pickup: pickup.name,
  destination: destination.name, suggestedFareKobo: 450000, fareKobo: null, expiresAt: envelope.serverNow + 300_000, canCancel: true, driver: null };
const preview: BookingPreview = { kind: 'sample', pickup: pickup.name, destination: destination.name, suggestedFareKobo: 450000,
  expiresAt: null, request: { pickupId: 'wuse-ii', destinationId: 'maitama' }, route: null };
function deferred<T>() { let resolve!: (v: T) => void, reject!: (e: Error) => void; const promise = new Promise<T>((r, j) => { resolve = r; reject = j; }); return { resolve, reject, promise }; }
function fixture() {
  let time = 1200, key = 0;
  const settings: Booking = { ...envelope, online: { enabled: true, searchHost: 'search.example.test', routeHost: 'route.example.test' },
    allowSample: true, areas: [{ id: 'wuse-ii', name: 'Wuse II' }, { id: 'maitama', name: 'Maitama' }], current: [], blockedBy: null };
  const api: ConstructorParameters<typeof BookingController>[0] = {
    booking: async () => structuredClone(settings), bookingRide: async () => ({ ...envelope, ride: structuredClone(ride) }),
    searchPlaces: async () => ({ ...envelope, places: [pickup], attribution: 'Test source' }),
    samplePreview: async () => ({ ...envelope, preview: structuredClone(preview) }),
    routePreview: async () => ({ ...envelope, preview: { ...preview, kind: 'route', request: { quoteId: ride.id }, expiresAt: envelope.serverNow + 900_000,
      route: { distanceMeters: 7000, durationSeconds: 1200, coordinates: [[7.4, 9.08], [7.45, 9.1]] } } }),
    requestRide: async () => { settings.current = [ride]; return { ...envelope, ride }; },
    cancelRide: async () => { settings.current = []; return { ...envelope, ride: { ...ride, status: 'cancelled', canCancel: false, version: 2, expiresAt: null } }; },
  };
  const controller = new BookingController(api, () => `command-key-${++key}`, () => time);
  return { api, settings, controller, advance: (ms: number) => { time += ms; } };
}
async function start(f: ReturnType<typeof fixture>) { f.controller.activate(); await settle(); }
async function sample(f: ReturnType<typeof fixture>) {
  const c = f.controller; c.chooseMode('sample'); c.sample('pickup', 'wuse-ii'); c.sample('destination', 'maitama'); await c.preview();
}

test('address lookup needs consent and explicit search; stale edits and background responses cannot replace selected places', async () => {
  const f = fixture(); await start(f); const c = f.controller, one = deferred<PlacesResult>(), two = deferred<PlacesResult>();
  let searches = 0;
  f.api.searchPlaces = async () => { searches++; return searches === 1 ? one.promise : two.promise; };
  c.edit('pickup', 'Wuse'); await c.search('pickup'); assert.equal(searches, 0);
  c.consent(); const old = c.search('pickup'); c.edit('pickup', 'Jabi'); const latest = c.search('pickup');
  two.resolve({ ...envelope, places: [destination], attribution: 'Test source' }); await latest;
  c.select('pickup', destination);
  one.resolve({ ...envelope, places: [pickup], attribution: 'Test source' }); await old;
  assert.equal(c.snapshot().pickup.selected?.name, destination.name); assert.deepEqual(c.snapshot().pickup.results, []);
  const late = deferred<PlacesResult>(); f.api.searchPlaces = () => late.promise;
  c.edit('destination', 'Maitama'); const pending = c.search('destination'); c.pause();
  late.resolve({ ...envelope, places: [pickup], attribution: 'Test source' }); await pending;
  assert.deepEqual(c.snapshot().destination.results, []); assert.equal(c.snapshot().stale, true);
});

test('edited routes require a new review and quote expiry uses server time plus monotonic elapsed time', async () => {
  const f = fixture(); await start(f); const c = f.controller;
  c.consent(); c.select('pickup', pickup); c.select('destination', destination); await c.preview();
  assert.ok(c.snapshot().preview); c.edit('pickup', 'Another place'); assert.equal(c.snapshot().preview, null);
  await c.submit(); assert.equal(f.settings.current.length, 0);
  c.select('pickup', pickup); await c.preview(); f.advance(900_000);
  await c.submit(); assert.match(c.snapshot().error, /expired/); assert.equal(f.settings.current.length, 0);
  assert.equal(c.snapshot().preview, null);
});

test('duplicate taps and lost confirmations retain one immutable command; retry does not create another request even after expiry', async () => {
  const f = fixture(); await start(f); await sample(f); const c = f.controller;
  const calls: Array<{ data: unknown; key: string }> = [], pending = deferred<BookingRideResult>();
  f.api.requestRide = async (data, key) => { calls.push({ data, key }); return pending.promise; };
  const first = c.submit(); await c.submit(); c.sample('destination', 'garki');
  assert.equal(calls.length, 1); assert.equal(c.snapshot().destinationId, 'maitama');
  // Simulate a successful write whose response is lost at the transport boundary.
  const failure = new Error('Disconnected');
  pending.reject(failure);
  await first; assert.equal(c.snapshot().uncertain, 'request');
  c.chooseMode('route'); assert.equal(c.snapshot().mode, 'sample');
  f.api.requestRide = async (data, key) => { calls.push({ data, key }); return { ...envelope, ride: { ...ride, status: 'expired', canCancel: false, expiresAt: null } }; };
  await c.retry(); await settle();
  assert.deepEqual(calls[0], calls[1]); assert.equal(c.snapshot().uncertain, null); assert.equal(c.snapshot().lastRide?.status, 'expired');
  assert.equal(c.snapshot().preview, null);
});

test('cancel races keep the reviewed version and require refresh after a definite rejection', async () => {
  const f = fixture(); f.settings.current = [ride]; await start(f); const c = f.controller;
  const versions: number[] = [];
  f.api.cancelRide = async (_id, version) => { versions.push(version); throw Object.assign(new Error('Refresh the journey.'), { status: 409, code: 'STALE_VERSION' }); };
  await c.cancel(ride); await c.cancel(ride);
  assert.deepEqual(versions, [1]); assert.equal(c.snapshot().stale, true); assert.equal(c.snapshot().uncertain, null);
  f.settings.current = [{ ...ride, version: 2, status: 'negotiating', expiresAt: null }];
  await c.refresh(); assert.equal(c.snapshot().settings?.current[0].version, 2);
  assert.equal(c.snapshot().stale, false); assert.equal(c.snapshot().preview, null);
});

test('foreground refresh resumes existing requests and replaces expired or cancelled cards with authoritative detail', async () => {
  const f = fixture(); await start(f); await sample(f); await f.controller.submit(); await settle();
  const resumed = new BookingController(f.api, () => 'another-command-key'); resumed.activate(); await settle();
  assert.equal(resumed.snapshot().settings?.current[0].id, ride.id); await resumed.submit();
  f.settings.current = [];
  f.api.bookingRide = async () => ({ ...envelope, ride: { ...ride, status: 'expired', canCancel: false, expiresAt: null } });
  await f.controller.refresh();
  assert.equal(f.controller.snapshot().lastRide?.status, 'expired'); assert.deepEqual(f.controller.snapshot().settings?.current, []);
  resumed.dispose();
});

test('background reads cannot overwrite foreground state; offline status and driver work disable new submissions', async () => {
  const f = fixture(), pending = deferred<Booking>(); f.api.booking = () => pending.promise;
  f.controller.activate(); f.controller.pause(); pending.resolve(f.settings); await settle();
  assert.equal(f.controller.snapshot().settings, null);
  f.api.booking = async () => structuredClone(f.settings); await start(f); await sample(f);
  f.api.booking = async () => { throw new Error('Offline'); }; await f.controller.refresh(); await f.controller.submit();
  assert.equal(f.settings.current.length, 0); assert.equal(f.controller.snapshot().stale, true);
  f.settings.blockedBy = 'work'; f.api.booking = async () => structuredClone(f.settings); await f.controller.refresh();
  await f.controller.submit(); assert.equal(f.settings.current.length, 0); assert.equal(f.controller.snapshot().preview, null);
});

test('booking contracts reject malformed fares, foreign coordinates and unsafe command payloads', () => {
  assert.equal(parsePreview({ ...envelope, preview }).preview.kind, 'sample');
  for (const invalid of [{ ...preview, suggestedFareKobo: 1.5 }, { ...preview, suggestedFareKobo: '450000' },
    { ...preview, request: { ...preview.request, amountKobo: 1 } }, { ...preview, kind: 'route', request: { quoteId: ride.id }, expiresAt: 1234,
      route: { distanceMeters: 7000, durationSeconds: 1000, coordinates: [[7.4, 9.08], [0, 51]] } }]) assert.throws(() => parsePreview({ ...envelope, preview: invalid }));
  assert.throws(() => parseBookingRide({ ...envelope, ride: { ...ride, status: 'unknown' } }));
  assert.throws(() => parseBookingRide({ ...envelope, ride: { ...ride, status: 'in_progress', canCancel: true } }));
});

test('route drawing preserves equal axes, fits endpoints and never invents a straight road between preview points', () => {
  const drawing = routeDrawing([[7.4, 9.08], [7.43, 9.08], [7.43, 9.1]]);
  const points = drawing.line.split(' ').map((pair) => pair.split(',').map(Number));
  assert.equal(points.length, 3); assert.equal(points[0][1], points[1][1]); assert.equal(points[1][0], points[2][0]);
  for (const [x,y] of points) { assert.ok(x >= 31.9 && x <= 328.1); assert.ok(y >= 31.9 && y <= 188.1); }
  const mercatorLat = (lat: number) => -Math.log(Math.tan(Math.PI / 4 + lat * Math.PI / 360));
  const expected = (0.03 * Math.PI / 180) / Math.abs(mercatorLat(9.1) - mercatorLat(9.08));
  assert.ok(Math.abs(Math.abs((points[1][0] - points[0][0]) / (points[2][1] - points[1][1])) - expected) < 0.00001);
});
