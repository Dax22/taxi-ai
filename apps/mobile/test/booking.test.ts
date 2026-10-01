import test from 'node:test';
import assert from 'node:assert/strict';
import { setImmediate as settle } from 'node:timers/promises';
import { BookingController } from '../src/booking/controller.ts';
import { routeDrawing } from '../src/booking/route-drawing.ts';
import { parsePreview, parseBookingRide } from '../../../packages/shared/src/mobile-booking.mjs';
import type { Booking, BookingPreview, BookingRide, BookingRideResult, Place, PlacesResult } from '../../../packages/shared/src/mobile-booking.mjs';

const envelope = { apiVersion: 1 as const, serverNow: 1_000_000 };
const pickup = { name: 'Wuse test pickup', lat: 9.08, lng: 7.4 }, destination = { name: 'Test destination', lat: 9.1, lng: 7.45 };
const ride: BookingRide = { id: '00000000-0000-4000-8000-000000000000', version: 1, status: 'requested', pickup: pickup.name,
  destination: destination.name, suggestedFareKobo: 450000, fareKobo: null, expiresAt: envelope.serverNow + 300_000, canCancel: true, driver: null };
const preview: BookingPreview = { kind: 'sample', pickup: pickup.name, destination: destination.name, suggestedFareKobo: 450000,
  expiresAt: null, request: { pickupId: 'wuse-ii', destinationId: 'maitama' }, route: null };
function deferred<T>() { let resolve!: (v: T) => void, reject!: (e: Error) => void; const promise = new Promise<T>((r, j) => { resolve = r; reject = j; }); return { resolve, reject, promise }; }
function fixture(locatePickup: () => Promise<Place> = async () => ({ ...pickup, name: 'Current location' })) {
  let time = 1200, key = 0, locates = 0;
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
  const controller = new BookingController(api, () => `command-key-${++key}`, () => time, async () => {
    locates++; return locatePickup();
  });
  return { api, settings, controller, advance: (ms: number) => { time += ms; }, locates: () => locates };
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

test('route pickup comes from the current location action before previewing', async () => {
  const f = fixture(); await start(f); const c = f.controller;
  c.consent(); c.select('destination', destination); await c.preview();
  assert.match(c.snapshot().error, /current location/); assert.equal(f.locates(), 0);
  await c.useCurrentPickup(); assert.equal(f.locates(), 1);
  assert.equal(c.snapshot().pickup.selected?.name, 'Current location');
  await c.preview(); assert.equal(c.snapshot().preview?.kind, 'route');
});



test('Find rides refreshes current pickup, searches destination and prepares the route fare automatically', async () => {
  const f = fixture(); await start(f); const c = f.controller;
  c.consent(); c.select('pickup', { ...pickup, name: 'Old manual pickup' });
  f.api.searchPlaces = async () => ({ ...envelope, places: [destination], attribution: 'Test source' });
  c.edit('destination', 'Maitama, Abuja');
  await c.findRides();
  assert.equal(f.locates(), 1);
  assert.equal(c.snapshot().destination.selected?.name, destination.name);
  assert.equal(c.snapshot().pickup.selected?.name, 'Current location');
  assert.equal(c.snapshot().preview?.kind, 'route');
});

test('Find rides leaves ambiguous destinations for customer selection before pricing', async () => {
  const f = fixture(); await start(f); const c = f.controller;
  const second = { ...destination, name: 'Maitama District', lng: destination.lng + 0.001 };
  f.api.searchPlaces = async () => ({ ...envelope, places: [destination, second], attribution: 'Test source' });
  c.edit('destination', 'Maitama');
  await c.findRides();
  assert.equal(f.locates(), 1);
  assert.equal(c.snapshot().pickup.selected?.name, 'Current location');
  assert.equal(c.snapshot().preview, null);
  assert.equal(c.snapshot().destination.results.length, 2);
  await c.chooseRideDestination(second);
  assert.equal(f.locates(), 1);
  assert.equal(c.snapshot().destination.selected?.name, second.name);
  assert.equal(c.snapshot().preview?.kind, 'route');
});

test('Find rides explains foreign GPS without requesting a fare and recovers after a Nigerian location retry', async () => {
  let outsideNigeria = true, searches = 0, quotes = 0;
  const f = fixture(async () => outsideNigeria
    ? { name: 'Current location', lat: 41.8781, lng: -87.6298 }
    : { ...pickup, name: 'Current location' });
  const routePreview = f.api.routePreview;
  f.api.routePreview = async (...args) => { quotes++; return routePreview(...args); };
  f.api.searchPlaces = async () => { searches++; return { ...envelope, places: [destination], attribution: 'Test source' }; };
  await start(f); const c = f.controller;
  assert.equal(f.locates(), 0, 'opening booking does not request GPS');
  c.edit('destination', 'Maitama, Abuja');
  await c.findRides();
  assert.match(c.snapshot().error, /testing from outside Nigeria/);
  assert.match(c.snapshot().error, /can't show a suggested fare/);
  assert.equal(c.snapshot().pickup.selected, null);
  assert.equal(c.snapshot().preview, null);
  assert.equal(c.snapshot().locatingPickup, false);
  assert.equal(searches, 0); assert.equal(quotes, 0);
  outsideNigeria = false;
  await c.findRides();
  assert.equal(c.snapshot().error, '');
  assert.equal(c.snapshot().preview?.kind, 'route');
  assert.equal(searches, 1); assert.equal(quotes, 1);
});

test('typed sample destination must match an available area and editing removes an old preview', async () => {
  const f = fixture(); await start(f); const c = f.controller;
  c.chooseMode('sample');
  assert.equal(c.snapshot().destinationId, '');
  c.editSampleDestination('Mai'); await c.preview();
  assert.match(c.snapshot().error, /Type a destination/);
  c.editSampleDestination('  mAiTaMa  ');
  assert.equal(c.snapshot().destinationId, 'maitama');
  await c.preview(); assert.equal(c.snapshot().preview?.kind, 'sample');
  c.editSampleDestination('Lagos');
  assert.equal(c.snapshot().destinationId, '');
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
      route: { distanceMeters: 7000, durationSeconds: 1000, coordinates: [[7.4, 9.08], [0, 51]] } },
    { ...preview, kind: 'route', request: { quoteId: ride.id }, expiresAt: 1234,
      route: { distanceMeters: 7000, durationSeconds: 1000, coordinates: [[7.4,9.08],[7.45,9.1]],
        pricing: { baseKobo: 50000, distanceKobo: -1, timeKobo: 60000, minimumKobo: 100000, incrementKobo: 5000 } } }])
    assert.throws(() => parsePreview({ ...envelope, preview: invalid }));
  assert.throws(() => parseBookingRide({ ...envelope, ride: { ...ride, status: 'unknown' } }));
  for (const paymentMode of ['simulation', 'paystack_test']) assert.equal(parseBookingRide({ ...envelope, ride: { ...ride, paymentMode } }).ride.paymentMode, paymentMode);
  assert.throws(() => parseBookingRide({ ...envelope, ride: { ...ride, paymentMode: 'paystack_live' } }));
  assert.throws(() => parseBookingRide({ ...envelope, ride: { ...ride, status: 'in_progress', canCancel: true } }));
});

test('native route reviews accept Nigerian cities beyond Abuja and reject cross-border geometry', () => {
  for (const [lng, lat] of [[3.35, 6.6], [8.52, 12.0], [7.51, 6.45]]) {
    const routePreview = { ...preview, kind: 'route', request: { quoteId: ride.id }, expiresAt: 1_100_000,
      route: { distanceMeters: 2000, durationSeconds: 600, coordinates: [[lng, lat], [lng + 0.01, lat + 0.01]] } };
    assert.equal(parsePreview({ ...envelope, preview: routePreview }).preview.kind, 'route');
    assert.throws(() => parsePreview({ ...envelope, preview: { ...routePreview,
      route: { ...routePreview.route, coordinates: [[lng, lat], [14.32, 10.59]] } } }));
  }
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

test('delivery requests retain their reviewed category, parcel and retry key; category edits invalidate pricing', async () => {
  const f = fixture(); await start(f); const c = f.controller;
  await sample(f); c.chooseCategory('van'); assert.equal(c.snapshot().preview, null);
  f.api.samplePreview = async (_from, _to, category) => ({ ...envelope, preview: { ...preview, vehicleCategory: category,
    request: { ...preview.request, vehicleCategory: category } } });
  await c.preview(); await c.submit(); assert.match(c.snapshot().error, /weight|description/);
  c.editDelivery('description', 'One test parcel'); c.editDelivery('weightKg', '4'); c.editDelivery('recipientName', 'Test recipient');
  const calls: Array<{ data: unknown; key: string }> = [];
  f.api.requestRide = async (data, key) => { calls.push(structuredClone({ data, key })); throw new Error('Lost response'); };
  await c.submit(); assert.equal(c.snapshot().uncertain, 'request');
  c.chooseCategory('truck'); c.editDelivery('recipientName', 'Another person');
  assert.equal(c.snapshot().category, 'van'); assert.equal(c.snapshot().delivery.recipientName, 'Test recipient');
  await c.retry(); assert.deepEqual(calls[0], calls[1]);
  assert.deepEqual(calls[0].data, { ...preview.request, vehicleCategory: 'van', delivery: {
    description: 'One test parcel', weightKg: 4, recipientName: 'Test recipient', pickupInstructions: '', dropoffInstructions: '',
  } });
  c.dispose(); const next = new BookingController(f.api, () => 'new-account-command');
  assert.equal(next.snapshot().category, 'standard'); assert.equal(next.snapshot().delivery.recipientName, ''); next.dispose();
});

test('native contracts distinguish direct delivery estimates from passenger routing and reject mismatched quote categories', () => {
  const direct = { ...envelope, preview: { ...preview, kind: 'route', vehicleCategory: 'truck',
    request: { quoteId: ride.id, vehicleCategory: 'truck' }, expiresAt: envelope.serverNow + 900000,
    route: { distanceMeters: 5000, durationSeconds: null, distanceKind: 'straight_line', coordinates: [[7.4,9.08],[7.45,9.1]] } } };
  assert.equal(parsePreview(direct).preview.route?.durationSeconds, null);
  assert.throws(() => parsePreview({ ...direct, preview: { ...direct.preview, request: { quoteId: ride.id, vehicleCategory: 'suv' } } }));
  assert.throws(() => parsePreview({ ...direct, preview: { ...direct.preview, route: { ...direct.preview.route, durationSeconds: 600 } } }));
  assert.throws(() => parseBookingRide({ ...envelope, ride: { ...ride, vehicleCategory: 'motorcycle', delivery: null } }));
});

test('guest requests require consent, normalize contact details and keep one immutable payload through retry', async () => {
  const f = fixture(); await start(f); await sample(f); const c = f.controller;
  c.choosePassenger('guest'); c.editPassenger('name', '  Demo Passenger  '); c.editPassenger('phone', '08012345678');
  const attempts: Array<{ data: unknown; key: string }> = [];
  f.api.requestRide = async (data, key) => { attempts.push(structuredClone({ data, key })); throw new Error('Lost confirmation'); };
  await c.submit(); assert.equal(attempts.length, 0); assert.ok(c.snapshot().error);
  c.consentPassenger(true); await c.submit();
  assert.equal(c.snapshot().uncertain, 'request');
  assert.deepEqual(attempts[0].data, { ...preview.request, vehicleCategory: 'standard', passenger: { kind: 'guest', name: 'Demo Passenger', phone: '+2348012345678', consent: true } });
  c.editPassenger('name', 'Another person'); c.choosePassenger('self'); c.chooseCategory('van');
  assert.equal(c.snapshot().passenger.name, '  Demo Passenger  '); assert.equal(c.snapshot().category, 'standard');
  await c.retry(); assert.deepEqual(attempts[1], attempts[0]);
  f.api.requestRide = async () => { f.settings.current = [ride]; return { ...envelope, ride }; };
  await c.retry(); await settle(); assert.deepEqual(c.snapshot().passenger, { kind: 'self', name: '', phone: '', consent: false });
  c.dispose();
});

test('changing a guest identity resets consent; ride option changes preserve the passenger while delivery changes clear it', async () => {
  const f = fixture(); await start(f); const c = f.controller;
  c.choosePassenger('guest'); c.editPassenger('name', 'Demo Passenger'); c.editPassenger('phone', '08012345678'); c.consentPassenger(true);
  c.editPassenger('phone', '08022345678'); assert.equal(c.snapshot().passenger.consent, false);
  c.consentPassenger(true); c.choosePassenger('self');
  assert.deepEqual(c.snapshot().passenger, { kind: 'self', name: '', phone: '', consent: false });
  c.choosePassenger('guest'); c.editPassenger('name', 'Another Guest'); c.editPassenger('phone', '08012345678'); c.consentPassenger(true); c.chooseCategory('suv');
  assert.equal(c.snapshot().passenger.kind, 'guest'); assert.equal(c.snapshot().passenger.name, 'Another Guest'); assert.equal(c.snapshot().passenger.consent, true);
  c.editPassenger('name', 'Delivery must not see me'); c.chooseCategory('van');
  c.choosePassenger('guest'); c.editPassenger('name', 'Blocked in delivery');
  assert.deepEqual(c.snapshot().passenger, { kind: 'self', name: '', phone: '', consent: false });
  c.chooseCategory('standard'); await sample(f);
  let submitted: unknown;
  f.api.requestRide = async (data) => { submitted = data; return { ...envelope, ride }; };
  await c.submit(); assert.deepEqual(submitted, { ...preview.request, vehicleCategory: 'standard', passenger: { kind: 'self' } });
  c.dispose();
});

test('guest data cannot cross into a delivery request after changing categories', async () => {
  const f = fixture(); await start(f); const c = f.controller;
  c.choosePassenger('guest'); c.editPassenger('name', 'Private Passenger'); c.editPassenger('phone', '08012345678'); c.consentPassenger(true);
  c.chooseCategory('van');
  f.api.samplePreview = async (_from, _to, category) => ({ ...envelope, preview: { ...preview, vehicleCategory: category, request: { ...preview.request, vehicleCategory: category } } });
  c.editDelivery('description', 'Test parcel'); c.editDelivery('weightKg', '3'); c.editDelivery('recipientName', 'Parcel recipient'); await sample(f);
  let submitted: unknown;
  f.api.requestRide = async (data) => { submitted = structuredClone(data); return { ...envelope, ride }; };
  await c.submit();
  assert.equal(Object.hasOwn(submitted as object, 'passenger'), false);
  assert.equal(JSON.stringify(submitted).includes('Private Passenger'), false); assert.equal(JSON.stringify(submitted).includes('08012345678'), false);
  c.dispose();
});

test('disposing a guest booking clears contact drafts and ignores late request responses', async () => {
  const f = fixture(); await start(f); await sample(f); const c = f.controller, result = deferred<BookingRideResult>();
  c.choosePassenger('guest'); c.editPassenger('name', 'Private Passenger'); c.editPassenger('phone', '08012345678'); c.consentPassenger(true);
  f.api.requestRide = () => result.promise;
  const pending = c.submit(); c.dispose();
  result.resolve({ ...envelope, ride: { ...ride, passenger: { kind: 'guest', name: 'Private Passenger', phone: '+2348012345678' } } });
  await pending;
  assert.deepEqual(c.snapshot().passenger, { kind: 'self', name: '', phone: '', consent: false });
  assert.equal(c.snapshot().lastRide, null); assert.equal(c.snapshot().settings, null); assert.equal(c.snapshot().uncertain, null);
  const next = new BookingController(f.api, () => 'new-account'); assert.equal(next.snapshot().passenger.kind, 'self'); next.dispose();
});

test('courier car mode requires a parcel, suppresses passenger data and restricts vehicles', async () => {
  const f = fixture(); await start(f); const c = f.controller;
  c.choosePassenger('guest'); c.editPassenger('name', 'Private passenger'); c.editPassenger('phone', '08012345678');
  await sample(f); c.chooseService('courier');
  assert.equal(c.snapshot().preview, null); assert.equal(c.snapshot().passenger.name, '');
  c.chooseCategory('suv'); assert.equal(c.snapshot().category, 'standard');
  c.choosePassenger('guest'); c.editPassenger('name', 'Must not persist'); assert.equal(c.snapshot().passenger.kind, 'self');
  await sample(f); await c.submit(); assert.match(c.snapshot().error, /weight|description/i);
  c.editDelivery('description', 'Small sealed parcel'); c.editDelivery('recipientName', 'Ada'); c.editDelivery('weightKg', '31');
  await c.submit(); assert.ok(c.snapshot().error); assert.equal(f.settings.current.length, 0);
  c.editDelivery('weightKg', '5'); let submitted: unknown;
  f.api.requestRide = async (data) => { submitted = data; return { ...envelope, ride }; }; await c.submit();
  assert.deepEqual(submitted, { ...preview.request, vehicleCategory: 'standard', delivery: {
    description: 'Small sealed parcel', weightKg: 5, recipientName: 'Ada', pickupInstructions: '', dropoffInstructions: '',
  } }); c.dispose();
});

test('switching courier car back to ride clears parcel details and requires a new quote', async () => {
  const f = fixture(); await start(f); const c = f.controller; c.chooseService('courier');
  c.editDelivery('description', 'Private parcel'); c.editDelivery('recipientName', 'Ada'); c.editDelivery('weightKg', '2');
  await sample(f); c.chooseService('ride'); assert.equal(c.snapshot().preview, null); assert.equal(c.snapshot().delivery.recipientName, '');
  await sample(f); let submitted: unknown;
  f.api.requestRide = async data => { submitted = data; return { ...envelope, ride }; }; await c.submit();
  assert.deepEqual(submitted, { ...preview.request, vehicleCategory: 'standard', passenger: { kind: 'self' } }); c.dispose();
});
