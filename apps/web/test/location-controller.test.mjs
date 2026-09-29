import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createGeolocation } from '../public/dashboard/geolocation.mjs';
async function browser(name) {
  const source = (await readFile(new URL(`../public/dashboard/${name}.mjs`, import.meta.url), 'utf8'))
    .replaceAll("'/shared/transport-categories.mjs'", `'${new URL('../../../packages/shared/src/transport-categories.mjs', import.meta.url)}'`)
    .replaceAll("'/shared/locations.mjs'", `'${new URL('../../../packages/shared/src/locations.mjs', import.meta.url)}'`);
  return import(`data:text/javascript,${encodeURIComponent(source)}`);
}
const { createLocationPlanner } = await browser('location-planner');
const { createLocationSharing } = await browser('location-sharing');
const wait = () => new Promise((resolve) => setImmediate(resolve));
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { resolve, reject, promise }; };
const customer = { id: 'customer', role: 'customer' }, driver = { id: 'driver', role: 'driver', driver: { status: 'approved' } };
const ride = { id: 'ride', status: 'booked' };
const pickup = { lat: 9.08, lng: 7.4, name: 'Pickup' }, destination = { lat: 9.1, lng: 7.45, name: 'Destination' };
const currentPickup = { lat: pickup.lat, lng: pickup.lng, name: 'Current location' };

function plannerSetup() {
  const f = { requests: [], commands: [], books: [], time: 1000, states: [], locates: 0, supported: true };
  const client = {
    async request(path, options) { f.requests.push({ path, options }); if (f.requestHook) return f.requestHook(path, options);
      return path === '/api/locations' ? { settings: { enabled: true, mode: 'community' } } : { places: [pickup] }; },
    async command(path, data) { f.commands.push({ path, data }); if (f.commandHook) return f.commandHook(path, data);
      return { quote: { id: 'quote-one', expiresAt: 2000, route: { pickup, destination } } }; },
  };
  const device = { supported: () => f.supported, locate: async () => {
    f.locates++; return f.locateHook ? f.locateHook() : { coords: { latitude: pickup.lat, longitude: pickup.lng, accuracy: 12 } };
  } };
  f.c = createLocationPlanner({ client, device, serverNow: () => f.time,
    view: { renderPlanner: (state) => f.states.push(state), resetPlanner() {}, selected() {} },
    onOnline: (enabled) => { f.online = enabled; }, onBook: async (id) => { f.books.push(id); return { ride }; },
  });
  return f;
}
async function enabled(f) { await f.c.setContext(customer, false); f.c.enable(); await f.c.useCurrentPickup(); f.c.select('destination', destination); }

test('online search needs explicit enabling, explicit address submission or current pickup; settings alone send no addresses', async () => {
  const f = plannerSetup(); await f.c.setContext(customer, false);
  await f.c.search('destination', 'Maitama'); assert.equal(f.requests.length, 1); assert.equal(f.online, false);
  f.c.enable(); await f.c.search('pickup', 'Wuse'); assert.equal(f.requests.length, 2);
  assert.deepEqual(f.requests[1].options.data, { query: 'Wuse' });
  await f.c.search('destination', 'Maitama'); assert.equal(f.requests.length, 3);
  assert.deepEqual(f.requests[2].options.data, { query: 'Maitama' });
  await f.c.useCurrentPickup(); assert.equal(f.locates, 1); assert.deepEqual(f.c.snapshot().pickup, currentPickup);
  f.c.reset(); assert.equal(f.c.snapshot().pickup, null); assert.equal(f.online, false);
  await f.c.setContext(driver, false); f.c.enable(); await f.c.search('destination', 'Wuse');
  assert.equal(f.requests.filter((r) => r.path.endsWith('/search')).length, 2);
});

test('late searches and quotes are discarded after input changes, map opt-out or account changes', async () => {
  const f = plannerSetup(); await enabled(f);
  const result = deferred(); f.requestHook = async () => result.promise;
  const searching = f.c.search('destination', 'Wuse'); f.c.clear('destination'); result.resolve({ places: [destination] }); await searching;
  assert.deepEqual(f.c.snapshot().results.destination, []);
  await f.c.useCurrentPickup();
  const quote = deferred(); f.commandHook = () => quote.promise;
  const pending = f.c.preview(); f.c.select('destination', { ...destination, lng: 7.46 });
  quote.resolve({ quote: { id: 'old', expiresAt: 2000 } }); await pending; assert.equal(f.c.snapshot().quote, null);
  const another = deferred(); f.commandHook = () => another.promise;
  const old = f.c.preview(); f.c.enable(); another.resolve({ quote: { id: 'old-again', expiresAt: 2000 } }); await old;
  assert.equal(f.c.snapshot().quote, null);
  f.c.reset(); assert.deepEqual(f.c.snapshot().results, { pickup: [], destination: [] });
});

test('booking submits only the saved quote ID and rejects expired quotes or an existing open journey', async () => {
  const f = plannerSetup(); await enabled(f); await f.c.preview();
  assert.deepEqual(f.commands[0].data, { pickup: currentPickup, destination, vehicleCategory: 'standard' });
  f.time = 2000; await f.c.book(); assert.equal(f.books.length, 0);
  f.time = 1999; await f.c.book(); assert.deepEqual(f.books, ['quote-one']); assert.equal(f.c.snapshot().quote, null);
  await f.c.setContext(customer, true); await f.c.preview(); assert.equal(f.commands.length, 1);
});

function sharingSetup(account = driver) {
  const f = { time: 1_000_000, requests: [], commands: [], share: null, locates: 0, watches: 0, clears: 0 };
  const sample = () => ({ coords: { latitude: 9.08, longitude: 7.4, accuracy: 12 }, timestamp: f.time });
  const device = { supported: () => true,
    async locate() { f.locates++; return f.locateHook ? f.locateHook() : sample(); },
    watch(onFix, onError) { f.watches++; f.onFix = onFix; f.onError = onError; if (f.watchHook) f.watchHook(onFix, onError); return () => { f.clears++; }; },
  };
  const client = {
    async command(path, data, options) {
      f.commands.push({ path, data, options }); if (f.commandHook) return f.commandHook(path, data, options);
      if (path.endsWith('/start')) f.share = { id: `share-${f.commands.length}`, rideId: ride.id, active: true, owned: true, sequence: 0, position: null };
      else if (path.endsWith('/stop')) f.share = null;
      return { share: f.share };
    },
    async request(path, options) {
      f.requests.push({ path, options }); if (f.requestHook) return f.requestHook(path, options);
      if (path.endsWith('/position')) f.share = { ...f.share, sequence: options.data.sequence, position: options.data };
      return { share: f.share };
    },
  };
  f.c = createLocationSharing({ client, device, makeId: () => 'window-one', now: () => f.time, serverNow: () => f.time,
    view: { renderTracking(state) { f.state = state; }, resetTracking() {} } });
  f.c.context(account, ride); f.sample = sample; return f;
}

test('GPS never starts from polling; an explicit driver action publishes bounded updates and stop clears its watcher immediately', async () => {
  const f = sharingSetup(); await f.c.poll(); assert.equal(f.locates, 0); assert.equal(f.watches, 0);
  await f.c.start(); await wait(); assert.equal(f.locates, 1); assert.equal(f.watches, 1);
  assert.equal(f.requests.filter((r) => r.path.endsWith('/position')).length, 1);
  f.time += 9999; f.onFix(f.sample()); f.c.tick(); await wait();
  assert.equal(f.requests.filter((r) => r.path.endsWith('/position')).length, 1);
  f.time++; f.c.tick(); await wait();
  assert.equal(f.requests.filter((r) => r.path.endsWith('/position')).length, 2);
  assert.equal(f.requests.at(-1).options.locationClient, 'window-one');
  const ending = deferred(); f.commandHook = () => ending.promise;
  const stop = f.c.stop(); assert.equal(f.clears, 1); assert.equal(f.c.sharing(), false);
  ending.reject(new Error('offline')); await stop; assert.match(f.c.snapshot().error, /GPS is stopped/);
});

test('customers and unbooked drivers never request GPS; denial and inaccurate/out-of-area fixes never start sharing', async () => {
  const customerFixture = sharingSetup(customer); await customerFixture.c.start(); assert.equal(customerFixture.locates, 0);
  const unbooked = sharingSetup(); unbooked.c.context(driver, { ...ride, status: 'agreed' }); await unbooked.c.start(); assert.equal(unbooked.locates, 0);
  for (const fix of [{ coords: { latitude: 41, longitude: -87, accuracy: 12 }, timestamp: 1_000_000 },
    { coords: { latitude: 9.08, longitude: 7.4, accuracy: 500 }, timestamp: 1_000_000 }]) {
    const f = sharingSetup(); f.locateHook = async () => fix; await f.c.start(); assert.equal(f.commands.length, 0); assert.equal(f.watches, 0);
  }
  const denied = sharingSetup(); denied.locateHook = async () => { throw { code: 1 }; };
  await denied.c.start(); assert.match(denied.c.snapshot().error, /permission was denied/); assert.equal(denied.commands.length, 0);
});

test('delayed permission and start replies cannot enable GPS after cancellation or account reset', async () => {
  const f = sharingSetup(), fix = deferred(); f.locateHook = () => fix.promise;
  const start = f.c.start(); await f.c.stop(); fix.resolve(f.sample()); await start;
  assert.equal(f.watches, 0); assert.equal(f.commands.length, 0);
  const g = sharingSetup(), response = deferred();
  g.commandHook = async (path) => path.endsWith('/start') ? response.promise : { share: null };
  const starting = g.c.start(); await wait(); g.c.reset();
  response.resolve({ share: { id: 'late', active: true, owned: true } }); await starting; await wait();
  assert.equal(g.watches, 0); assert.ok(g.commands.some((r) => r.path === '/api/location-shares/late/stop'));
  assert.equal(g.c.snapshot().share, null);
});

test('remote closure, session rejection, journey change and device errors stop GPS without automatic resumption', async () => {
  for (const reason of ['closed', 'session', 'journey', 'device']) {
    const f = sharingSetup(); await f.c.start(); await wait();
    if (reason === 'closed') { f.share = null; await f.c.poll(); }
    if (reason === 'session') { f.requestHook = async () => { throw Object.assign(new Error('expired'), { status: 401 }); }; await f.c.poll(); }
    if (reason === 'journey') f.c.context(driver, { ...ride, id: 'other' });
    if (reason === 'device') f.onError({ code: 1 });
    await wait(); assert.equal(f.clears, 1, reason); assert.equal(f.c.sharing(), false, reason); assert.equal(f.locates, 1);
  }
  const lost = sharingSetup(); lost.share = { id: 'lost', active: true, owned: true, sequence: 0 };
  await lost.c.poll(); await wait(); assert.equal(lost.locates, 0); assert.ok(lost.commands[0].path.endsWith('/stop'));
});

test('old location reads cannot overwrite an acknowledged newer fix; a prolonged publishing outage clears GPS', async () => {
  const f = sharingSetup(); await f.c.start(); await wait();
  const stale = { ...f.share, sequence: 0, position: null };
  f.requestHook = async (path) => path.endsWith('/location') ? { share: stale } : Promise.reject(new Error('offline'));
  await f.c.poll(); assert.equal(f.c.snapshot().share.sequence, 1);
  f.time += 45_000; f.c.tick(); await wait(); assert.equal(f.c.sharing(), false); assert.equal(f.clears, 1);
});

test('a synchronously revoked watch is cleaned up, and browser geolocation adapter clears its exact watch ID', async () => {
  const f = sharingSetup(); f.watchHook = (_, fail) => fail({ code: 1 });
  await f.c.start(); await wait(); assert.equal(f.clears, 1); assert.equal(f.c.sharing(), false);
  const calls = [];
  const device = { getCurrentPosition(resolve, reject, options) { calls.push(options); resolve('fix'); },
    watchPosition(success, error, options) { calls.push(options); return 0; }, clearWatch(id) { calls.push(id); } };
  const gps = createGeolocation({ device, secure: true }); assert.equal(calls.length, 0);
  assert.equal(await gps.locate(), 'fix'); const clear = gps.watch(() => {}, () => {}); clear();
  assert.equal(calls.at(-1), 0); assert.equal(calls[0].maximumAge, 5000); assert.equal(calls[0].timeout, 10000);
  assert.equal(createGeolocation({ device, secure: false }).supported(), false);
});

test('category changes invalidate both saved and in-flight quotes, including a selection before account load', async () => {
  const f = plannerSetup(); f.c.setCategory('suv'); await f.c.setContext(customer, false); f.c.enable();
  await f.c.useCurrentPickup(); f.c.select('destination', destination);
  const pending = deferred(); f.commandHook = () => pending.promise;
  const first = f.c.preview(); assert.equal(f.commands[0].data.vehicleCategory, 'suv');
  f.c.setCategory('truck'); pending.resolve({ quote: { id: 'old-suv-quote', expiresAt: 2000 } }); await first;
  assert.equal(f.c.snapshot().quote, null); await f.c.book(); assert.deepEqual(f.books, []);
  f.commandHook = null; await f.c.preview(); assert.equal(f.commands.at(-1).data.vehicleCategory, 'truck');
  assert.ok(f.c.snapshot().quote); f.c.setCategory('motorcycle'); assert.equal(f.c.snapshot().quote, null);
  f.c.reset(); assert.equal(f.c.snapshot().vehicleCategory, 'standard');
});


test('the web route planner accepts Lagos and Kano pins while rejecting neighbouring countries', async () => {
  const f = plannerSetup(); await f.c.setContext(customer, false); f.c.enable();
  const lagos = { lat: 6.6018, lng: 3.3515, name: 'Ikeja' }, kano = { lat: 12.0022, lng: 8.592, name: 'Kano' };
  f.c.select('pickup', lagos); f.c.select('destination', kano); await f.c.preview();
  assert.deepEqual(f.commands[0].data, { pickup: lagos, destination: kano, vehicleCategory: 'standard' });
  f.c.select('pickup', { lat: 6.3667, lng: 2.4333, name: 'Cotonou' });
  assert.deepEqual(f.c.snapshot().pickup, lagos); assert.match(f.c.snapshot().error, /Nigeria/);
});

test('an address selection cancels a pending GPS pickup and a newer GPS request invalidates an in-flight quote', async () => {
  const f = plannerSetup(); await enabled(f);
  const gps = deferred(); f.locateHook = () => gps.promise;
  const pending = f.c.useCurrentPickup(); f.c.select('pickup', pickup);
  assert.equal(f.states.at(-1).locatingPickup, false);
  gps.resolve({ coords: { latitude: 6.45, longitude: 3.4, accuracy: 10 } }); await pending;
  assert.deepEqual(f.c.snapshot().pickup, pickup);
  const quote = deferred(); f.commandHook = () => quote.promise;
  const preview = f.c.preview(), second = deferred(); f.locateHook = () => second.promise;
  const current = f.c.useCurrentPickup(); quote.resolve({ quote: { id: 'outdated', expiresAt: 2000 } }); await preview;
  assert.equal(f.c.snapshot().quote, null);
  second.resolve({ coords: { latitude: 6.45, longitude: 3.4, accuracy: 10 } }); await current;
  assert.equal(f.c.snapshot().pickup.lat, 6.45); assert.equal(f.states.at(-1).locatingPickup, false);
});


test('Find rides refreshes current pickup, searches nationwide and prepares a fare without a second preview click', async () => {
  const f = plannerSetup();
  await f.c.setContext(customer, false);
  f.c.enable();
  f.c.select('pickup', { ...pickup, name: 'Old manual pickup' });
  f.requestHook = async (path) => path === '/api/locations/search'
    ? { places: [destination] }
    : { settings: { enabled: true, mode: 'community' } };
  await f.c.findRides('Maitama');
  assert.equal(f.online, true);
  assert.equal(f.locates, 1);
  assert.deepEqual(f.c.snapshot().destination, destination);
  assert.deepEqual(f.c.snapshot().pickup, currentPickup);
  assert.equal(f.commands.length, 1);
  assert.deepEqual(f.commands[0].data, { pickup: currentPickup, destination, vehicleCategory: 'standard' });
  assert.equal(f.c.snapshot().quote?.id, 'quote-one');
});

test('Find rides keeps ambiguous destination matches visible until the customer selects one', async () => {
  const f = plannerSetup(), second = { ...destination, name: 'Maitama District', lng: 7.451 };
  await f.c.setContext(customer, false);
  f.requestHook = async (path) => path === '/api/locations/search'
    ? { places: [destination, second] }
    : { settings: { enabled: true, mode: 'community' } };
  await f.c.findRides('Maitama');
  assert.equal(f.commands.length, 0);
  assert.equal(f.locates, 1);
  assert.deepEqual(f.c.snapshot().pickup, currentPickup);
  assert.equal(f.c.snapshot().results.destination.length, 2);
  await f.c.chooseRidePlace('destination', second);
  assert.equal(f.locates, 1);
  assert.equal(f.commands.length, 1);
  assert.equal(f.c.snapshot().destination?.name, 'Maitama District');
});

test('Find rides ignores an old destination submitted before the GPS permission wait', async () => {
  const f = plannerSetup(), gps = deferred();
  await f.c.setContext(customer, false); f.locateHook = () => gps.promise;
  const pending = f.c.findRides('Old destination');
  f.c.clear('destination'); // The destination input changed while permission was pending.
  gps.resolve({ coords: { latitude: pickup.lat, longitude: pickup.lng, accuracy: 12 } });
  await pending;
  assert.equal(f.requests.filter((request) => request.path.endsWith('/search')).length, 0);
  assert.equal(f.commands.length, 0);
  assert.deepEqual(f.c.snapshot().results.destination, []);
  await f.c.findRides('New destination');
  assert.deepEqual(f.requests.at(-1).options.data, { query: 'New destination' });
});

test('a repeated Find rides submission during GPS permission keeps the first lookup alive', async () => {
  const f = plannerSetup(), gps = deferred();
  await f.c.setContext(customer, false); f.locateHook = () => gps.promise;
  f.requestHook = async (path) => path === '/api/locations/search'
    ? { places: [destination] }
    : { settings: { enabled: true, mode: 'community' } };
  const first = f.c.findRides('Maitama');
  await f.c.findRides('Maitama');
  assert.equal(f.locates, 1);
  gps.resolve({ coords: { latitude: pickup.lat, longitude: pickup.lng, accuracy: 12 } });
  await first;
  assert.equal(f.requests.filter((request) => request.path.endsWith('/search')).length, 1);
  assert.equal(f.c.snapshot().quote?.id, 'quote-one');
});

test('Find rides requires a new successful GPS fix even when a manual pickup is saved', async () => {
  const f = plannerSetup(); await f.c.setContext(customer, false); f.c.enable();
  f.c.select('pickup', { ...pickup, name: 'Old manual pickup' });
  f.supported = false;
  await f.c.findRides('Maitama');
  assert.equal(f.c.snapshot().pickup, null);
  assert.equal(f.commands.length, 0);
  assert.equal(f.requests.filter((request) => request.path.endsWith('/search')).length, 0);
  assert.match(f.c.snapshot().error, /geolocation/);
  f.supported = true; f.locateHook = async () => { throw new Error('GPS denied'); };
  f.c.select('pickup', { ...pickup, name: 'Another manual pickup' });
  await f.c.findRides('Maitama');
  assert.equal(f.c.snapshot().pickup, null);
  assert.equal(f.commands.length, 0);
});

test('Find rides explains browser permission, unavailable-position and timeout failures without assuming a country', async () => {
  for (const [code, expected] of [[1, /Location access is blocked/], [2, /could not determine/], [3, /timed out/]]) {
    const f = plannerSetup(); await f.c.setContext(customer, false);
    f.locateHook = async () => { throw { code }; }; // Browser GeolocationPositionError is not an Error instance.
    await f.c.findRides('Maitama');
    assert.match(f.c.snapshot().error, expected);
    assert.doesNotMatch(f.c.snapshot().error, /outside Nigeria/);
    assert.equal(f.c.snapshot().pickup, null);
    assert.equal(f.states.at(-1).locatingPickup, false);
    assert.equal(f.requests.filter((request) => request.path.endsWith('/search')).length, 0);
    assert.equal(f.commands.length, 0);
  }
});

test('standard-car courier mode enables manual pickup and cancels pending passenger GPS', async () => {
  const f = plannerSetup(), gps = deferred();
  await f.c.setContext(customer, false); f.locateHook = () => gps.promise;
  const pending = f.c.findRides('Maitama');
  f.c.setCategory('standard', 'delivery');
  assert.equal(f.c.snapshot().rideDiscovery, false);
  assert.equal(f.c.snapshot().service, 'delivery');
  assert.equal(f.c.snapshot().target, 'pickup');
  f.c.setTarget('pickup'); f.c.pick({ ...pickup, name: 'Parcel collection' });
  gps.resolve({ coords: { latitude: 6.45, longitude: 3.4, accuracy: 12 } });
  await pending;
  assert.equal(f.c.snapshot().pickup.name, 'Parcel collection');
  assert.equal(f.requests.filter((request) => request.path.endsWith('/search')).length, 0);
  f.c.select('destination', destination); await f.c.preview();
  assert.equal(f.commands.length, 1);
  assert.equal(f.c.snapshot().quote.id, 'quote-one');
  f.c.setCategory('standard', 'ride');
  assert.equal(f.c.snapshot().pickup, null);
  assert.equal(f.c.snapshot().quote, null);
});
