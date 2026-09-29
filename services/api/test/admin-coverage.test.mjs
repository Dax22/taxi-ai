import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { harness, participants } from './helpers.mjs';
import { asAsyncDatabase } from '../src/infrastructure/async-database.mjs';
import { createAdminDemandRepository } from '../src/modules/admin-demand/repository.mjs';
import { createAdminDemandService } from '../src/modules/admin-demand/service.mjs';
import { coverageFilters, DAY_MS } from '../src/modules/admin-demand/domain.mjs';
import { NIGERIA_BOUNDS } from '../../../packages/shared/src/locations.mjs';
import { NIGERIA_MAP_PLACES } from '../../../packages/shared/src/nigeria-map-places.mjs';

function serviceFor(h, admin, extra = {}) {
  const db = asAsyncDatabase(h.db);
  return createAdminDemandService({ repository: createAdminDemandRepository(db), clock: () => h.now,
    unitOfWork: run => db.transaction(run), allowSimulation: true,
    requirePermission: async (id, permission) => { assert.equal(permission, 'demand.read'); if (id !== admin.user.id) throw new Error('FORBIDDEN'); }, ...extra });
}
function user(h) {
  const id = randomUUID();
  h.db.prepare("INSERT INTO users(id,email,name,password_hash,role,created_at) VALUES (?,?,?,'fixture','customer',?)")
    .run(id, id + '@coverage.example.test', 'Private passenger', h.now);
  return id;
}
function ride(h, { point = { lat: 9.076541, lng: 7.462321 }, createdAt = h.now - 600000,
  expiresAt = h.now + 60000, status = 'requested', region = 'ng:181:149', category = 'standard',
  matchedAt = null, closedReason = null, trip = null, delivery = ['van', 'truck', 'motorcycle'].includes(category) } = {}) {
  const id = randomUUID(), customerId = user(h), driverId = matchedAt === null ? null : user(h);
  h.db.prepare(`INSERT INTO rides(id,customer_id,driver_id,pickup_id,destination_id,suggested_fare_kobo,status,created_at,updated_at,
    request_expires_at,dispatch_region,vehicle_category,matched_at,closed_reason)
    VALUES (?,?,?,'PRIVATE-PICKUP','PRIVATE-DESTINATION',300000,?,?,?,?,?,?,?,?)`)
    .run(id, customerId, driverId, status, createdAt, createdAt, expiresAt, region, category, matchedAt, closedReason);
  if (delivery) h.db.prepare('INSERT INTO delivery_orders(ride_id,details_json) VALUES (?,?)')
    .run(id, JSON.stringify({ recipientName: 'Private recipient', packageDescription: 'Private parcel' }));
  if (point) h.db.prepare('INSERT INTO location_quotes(id,customer_id,created_at,expires_at,route_json,ride_id) VALUES (?,?,?,?,?,?)')
    .run(randomUUID(), customerId, createdAt, h.now + 60000, JSON.stringify({ pickup: { ...point, label: 'PRIVATE-ADDRESS' }, destination: { lat: 9.1, lng: 7.4 } }), id);
  if (trip) h.db.prepare(`INSERT INTO ride_trips(ride_id,customer_id,driver_id,status,fare_kobo,booked_at,departed_at,arrived_at,started_at,completed_at)
    VALUES (?,?,?,'completed',300000,?,?,?,?,?)`).run(id, customerId, driverId, trip.booked, trip.booked, trip.arrived, trip.arrived, h.now);
  return id;
}
function sum(rows, field) { return rows.reduce((total, row) => total + row[field], 0); }

test('coverage accepts every Nigerian place, nationwide bounds and rural viewports, with stable snapped cells and bounded filters', () => {
  const now = Date.UTC(2026, 0, 1);
  const national = coverageFilters({}, now);
  assert.deepEqual(national.bounds, NIGERIA_BOUNDS); assert.equal(national.cellDegrees, 0.5);
  for (const place of NIGERIA_MAP_PLACES) {
    const result = coverageFilters({ place: place.id }, now);
    assert.equal(result.place.id, place.id);
    const replay = coverageFilters({ bbox: Object.values(result.bounds).join(',') }, now);
    assert.deepEqual(replay.bounds, result.bounds);
  }
  const narrow = coverageFilters({ place: 'map-maitama', bbox: '7.462301,9.076511,7.462399,9.076599' }, now);
  assert.equal(narrow.place, null);
  assert.deepEqual(narrow.bounds, { west: 7.46, south: 9.07, east: 7.47, north: 9.08 });
  for (let i = 0; i < 100; i++) {
    const west = 3 + i / 100, bounds = coverageFilters({ bbox: `${west},8.031,${west + 0.021},8.043` }, now);
    assert.deepEqual(coverageFilters({ bbox: bounds.bbox }, now).bounds, bounds.bounds);
  }
  for (const input of [{ bbox: 'NaN,8,9,10' }, { bbox: '7,9,6,10' }, { bbox: '0,0,180,90' }, { bbox: '7,8,7,9' },
    { bbox: '7,8,9,10,11' }, { bbox: '7,8,Infinity,10' }, { place: 'unknown' }, { layer: 'individual-drivers' },
    { from: '2025-01-01' }, { service: 'eats' }, { limit: '999' }]) assert.throws(() => coverageFilters(input, now));
});

test('nationwide cells include Lagos, Kano, Abuja and rural demand; sample and unlocated rows reconcile without invented GPS', async t => {
  const h = await harness(t), { admin } = await participants(h, 0), service = serviceFor(h, admin);
  const points = [{ lat: 6.456789, lng: 3.356789 }, { lat: 12.002241, lng: 8.591956 }, { lat: 9.076541, lng: 7.462321 }, { lat: 8.521413, lng: 6.132415 }];
  const ids = points.map(point => ride(h, { point }));
  ride(h, { point: null, region: 'sample:wuse-ii' });
  ride(h, { point: points[0], region: 'sample:maitama' }); // Sample rows never become real GPS demand.
  ride(h, { point: null });
  ride(h, { point: { lat: '9.076541', lng: '7.462321' } });
  ride(h, { point: { lat: 91, lng: 7.46 } });
  const report = await service.coverage(admin.user);
  assert.equal(report.cells.length, 4); assert.equal(report.historicalTotals.requests, 4);
  assert.equal(report.nationwideTotals.historical.requests, 9); assert.equal(report.currentTotals.waitingRequests, 4);
  assert.equal(report.offMap.historical.sample.requests, 2); assert.equal(report.offMap.historical.unlocated.requests, 3);
  assert.equal(report.outsideViewport.historical.requests, 0); assert.equal(report.viewport.truncated, false);
  assert.equal(sum(report.cells, 'requests'), report.historicalTotals.requests);
  assert.equal(report.offMap.scope, 'nationwide');
  const focused = await service.coverage(admin.user, { bbox: '7.43,9.04,7.49,9.10' });
  assert.equal(focused.historicalTotals.requests, 1); assert.equal(focused.outsideViewport.historical.requests, 3);
  assert.equal(focused.nationwideTotals.historical.requests, 9);
  const text = JSON.stringify(report);
  for (const secret of [...ids, 'Private passenger', 'PRIVATE-ADDRESS', 'PRIVATE-PICKUP', 'PRIVATE-DESTINATION', '9.076541', '7.462321', 'customerId', 'driverId', 'latitude', 'longitude']) assert.ok(!text.includes(secret), secret);
});

test('historical pickup waits have explicit valid observation counts and unserved excludes passenger cancellations and previous matches', async t => {
  const h = await harness(t), { admin } = await participants(h, 0), service = serviceFor(h, admin);
  const createdAt = h.now - 600000, booked = createdAt + 60000;
  for (const arrived of [booked + 120000, booked + 240000, booked - 1, h.now + 1]) {
    ride(h, { status: 'agreed', createdAt, matchedAt: booked, trip: { booked, arrived } });
  }
  ride(h, { status: 'agreed', createdAt, matchedAt: booked, trip: { booked: createdAt - 1, arrived: booked } });
  ride(h, { expiresAt: h.now });
  ride(h, { status: 'cancelled', closedReason: 'request_expired' });
  ride(h, { status: 'cancelled' });
  ride(h, { status: 'cancelled', matchedAt: booked, closedReason: 'request_expired' });
  const result = await service.coverage(admin.user);
  assert.equal(result.historicalTotals.requests, 9); assert.equal(result.historicalTotals.unserved, 2);
  assert.equal(result.historicalTotals.pickupWaitObservations, 2); assert.equal(result.historicalTotals.meanPickupWaitSeconds, 180);
  assert.equal(result.currentTotals.waitingRequests, 0); assert.equal(result.currentTotals.meanWaitingSeconds, null);
  assert.equal(sum(result.cells, 'unserved'), 2);
});

test('current waiting and eligible supply share one snapshot regardless of historic range and respect service filters and pending reservations', async t => {
  const h = await harness(t), { admin, drivers } = await participants(h, 3), service = serviceFor(h, admin);
  for (const driver of drivers.slice(0, 2)) await driver.online({ mode: 'gps', lat: 9.076541, lng: 7.462321 });
  h.db.prepare("UPDATE driver_applications SET details_json=json_set(details_json,'$.vehicle.category','motorcycle') WHERE driver_id=?").run(drivers[1].user.id);
  ride(h, { createdAt: h.now - 20 * DAY_MS, category: 'motorcycle' });
  ride(h, { createdAt: h.now - 30 * DAY_MS });
  const expired = ride(h, { expiresAt: h.now });
  ride(h, { createdAt: h.now + 1 });
  let result = await service.coverage(admin.user, { from: '2025-12-20', to: '2025-12-20' });
  assert.equal(result.historicalTotals.requests, 0); assert.equal(result.currentTotals.waitingRequests, 2);
  assert.equal(result.currentTotals.availableDrivers, 2); assert.equal(result.offMap.current.sample.availableDrivers, 1);
  assert.equal(result.currentTotals.meanWaitingSeconds, 25 * DAY_MS / 1000); assert.equal(result.currentTotals.maxWaitingSeconds, 30 * DAY_MS / 1000);
  result = await service.coverage(admin.user, { service: 'courier' });
  assert.equal(result.currentTotals.waitingRequests, 1); assert.equal(result.currentTotals.availableDrivers, 2);
  const availability = h.db.prepare('SELECT id FROM driver_availability WHERE driver_id=? AND active=1').get(drivers[1].user.id);
  h.db.prepare(`INSERT INTO dispatch_offers(id,ride_id,driver_id,availability_id,status,mode,policy_version,eta_source,created_at,expires_at)
    VALUES (?,?,?,?,'pending','sequential','test','sample',?,?)`).run(randomUUID(), expired, drivers[1].user.id, availability.id, h.now - 1, h.now + 60000);
  assert.equal((await service.coverage(admin.user, { service: 'courier' })).currentTotals.availableDrivers, 1);
  h.db.prepare("UPDATE driver_documents SET expires_on='2025-12-31' WHERE driver_id=? AND kind='insurance'").run(drivers[0].user.id);
  assert.equal((await service.coverage(admin.user)).currentTotals.availableDrivers, 0);
  assert.equal((await serviceFor(h, admin, { allowSimulation: false }).coverage(admin.user)).offMap.current.sample.availableDrivers, 0);
});

test('coverage places car parcels in courier demand and eligible car supply in both services without duplicating nationwide totals', async t => {
  const h = await harness(t), { admin, drivers } = await participants(h, 3), service = serviceFor(h, admin);
  for (const [index, category] of ['standard', 'suv', 'truck'].entries()) {
    await drivers[index].online({ mode: 'gps', lat: 9.076541, lng: 7.462321 });
    h.db.prepare("UPDATE driver_applications SET details_json=json_set(details_json,'$.vehicle.category',?) WHERE driver_id=?")
      .run(category, drivers[index].user.id);
    ride(h, { category });
  }
  const parcel = ride(h, { category: 'standard', delivery: true, expiresAt: h.now });
  const all = await service.coverage(admin.user), passenger = await service.coverage(admin.user, { service: 'ride' }), courier = await service.coverage(admin.user, { service: 'courier' });
  assert.equal(all.historicalTotals.requests, 4); assert.equal(passenger.historicalTotals.requests, 2); assert.equal(courier.historicalTotals.requests, 2);
  assert.equal(courier.historicalTotals.unserved, 1); assert.equal(passenger.historicalTotals.unserved, 0);
  assert.equal(all.currentTotals.waitingRequests, 3); assert.equal(passenger.currentTotals.waitingRequests, 2); assert.equal(courier.currentTotals.waitingRequests, 1);
  assert.equal(all.currentTotals.availableDrivers, 3); assert.equal(passenger.currentTotals.availableDrivers, 2); assert.equal(courier.currentTotals.availableDrivers, 2);
  assert.equal(sum(courier.cells, 'requests'), 2); assert.equal(sum(courier.cells, 'availableDrivers'), 2);
  assert.equal(all.nationwideTotals.historical.requests, 4); assert.equal(all.nationwideTotals.current.availableDrivers, 3);
  for (const secret of [parcel, 'Private recipient', 'Private parcel']) assert.ok(!JSON.stringify(courier).includes(secret));
});

test('sub-cell viewports query the same complete cells and regional output has no hidden top-N truncation', async t => {
  const h = await harness(t), { admin } = await participants(h, 0), service = serviceFor(h, admin);
  for (let i = 0; i < 60; i++) ride(h, { point: { lat: 9.001 + Math.floor(i / 10) * 0.01, lng: 7.401 + (i % 10) * 0.01 } });
  const a = await service.coverage(admin.user, { bbox: '7.4011,9.0011,7.4012,9.0012' });
  const b = await service.coverage(admin.user, { bbox: '7.4081,9.0081,7.4082,9.0082' });
  assert.deepEqual(a, b); assert.equal(a.historicalTotals.requests, 1);
  const all = await service.coverage(admin.user, { bbox: '7.40,9.00,7.50,9.06' });
  assert.equal(all.cells.length, 60); assert.equal(all.historicalTotals.requests, 60); assert.equal(all.viewport.truncated, false);
  assert.ok(all.cells.length <= all.viewport.maxCells);
});

test('coverage refreshes demand permission before reading repository or validating report filters', async () => {
  let reads = 0;
  const service = createAdminDemandService({ unitOfWork: run => run(), clock: () => Date.now(),
    repository: { coverage: async () => { reads++; return []; } }, requirePermission: async () => { throw new Error('FORBIDDEN'); } });
  await assert.rejects(service.coverage({ id: 'revoked' }, { bbox: 'bad' }), /FORBIDDEN/); assert.equal(reads, 0);
});
