import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { harness, participants } from './helpers.mjs';
import { asAsyncDatabase } from '../src/infrastructure/async-database.mjs';
import { createAdminDemandRepository } from '../src/modules/admin-demand/repository.mjs';
import { createAdminDemandService } from '../src/modules/admin-demand/service.mjs';
import { demandFilters, demandRegion, DAY_MS, WAT_MS } from '../src/modules/admin-demand/domain.mjs';
import { adminDemandRoutes } from '../src/modules/admin-demand/routes.mjs';

function demand(h, admin, options = {}) {
  const db = asAsyncDatabase(h.db);
  return createAdminDemandService({ repository: createAdminDemandRepository(db), clock: () => h.now,
    unitOfWork: (run) => db.transaction(run), allowSimulation: true,
    requirePermission: async (id, permission) => { assert.equal(permission, 'demand.read'); if (id !== admin.user.id) throw new Error('FORBIDDEN'); }, ...options });
}
function seedUser(h) {
  const id = randomUUID();
  h.db.prepare("INSERT INTO users(id,email,name,password_hash,role,created_at) VALUES (?,?,?,'fixture','customer',?)")
    .run(id, id + '@example.test', 'Private passenger name', h.now);
  return id;
}
function seedRide(h, { customerId = seedUser(h), status = 'requested', createdAt = h.now - 60_000,
  expiresAt = h.now + 120_000, region = 'ng:181:148', category = 'standard', matchedAt = null, closedReason = null,
  driverId = matchedAt === null ? null : seedUser(h), completedAt = null,
  delivery = ['van', 'truck', 'motorcycle'].includes(category) } = {}) {
  const id = randomUUID();
  h.db.prepare(`INSERT INTO rides(id,customer_id,driver_id,pickup_id,destination_id,suggested_fare_kobo,status,created_at,updated_at,
    request_expires_at,dispatch_region,vehicle_category,matched_at,closed_reason)
    VALUES (?,?,?,'private-pickup','private-destination',300000,?,?,?,?,?,?,?,?)`)
    .run(id, customerId, driverId, status, createdAt, createdAt, expiresAt, region, category, matchedAt, closedReason);
  if (delivery) h.db.prepare('INSERT INTO delivery_orders(ride_id,details_json) VALUES (?,?)')
    .run(id, JSON.stringify({ recipientName: 'Private recipient', packageDescription: 'Private parcel' }));
  if (completedAt !== null) h.db.prepare(`INSERT INTO ride_trips(ride_id,customer_id,driver_id,status,fare_kobo,booked_at,departed_at,arrived_at,started_at,completed_at)
    VALUES (?,?,?,'completed',300000,?,?,?,?,?)`).run(id, customerId, driverId, matchedAt, matchedAt, matchedAt, matchedAt, completedAt);
  return id;
}

test('demand date filters use inclusive WAT calendar days with a bounded request-created window', () => {
  const now = Date.UTC(2026, 8, 24, 23, 30);
  const filter = demandFilters({}, now);
  assert.equal(filter.to, '2026-09-25'); assert.equal(filter.from, '2026-09-19');
  assert.equal(filter.since, Date.UTC(2026, 8, 18, 23)); assert.equal(filter.until, now + 1);
  assert.equal(filter.end - filter.since, 7 * DAY_MS);
  const historic = demandFilters({ from: '2026-09-01', to: '2026-09-02' }, now);
  assert.equal(historic.since, Date.UTC(2026, 7, 31, 23)); assert.equal(historic.until, Date.UTC(2026, 8, 2, 23));
  for (const query of [{ from: '2026-02-30' }, { to: '2026-09-26' }, { from: '2026-09-03', to: '2026-09-02' },
    { from: '2026-01-01' }, { limit: '51' }, { limit: '2.1' }, { service: 'food' }, { q: 'passenger' }, { region: 'Private address' }]) {
    assert.throws(() => demandFilters(query, now), (error) => ['INVALID_INPUT', 'INVALID_FIELDS'].includes(error.code));
  }
  assert.equal(demandRegion('ng:181:148').kind, 'dispatch_cell');
  assert.equal(demandRegion('sample:wuse-ii').label, 'Wuse II (sample)');
  assert.equal(demandRegion('private address').key, 'unassigned');
});

test('demand request outcomes are disjoint while matched timing includes legacy matches and elapsed requests without mutation', async (t) => {
  const h = await harness(t), { admin } = await participants(h, 0), service = demand(h, admin);
  seedRide(h, { createdAt: h.now - 300_000, status: 'agreed', matchedAt: h.now - 240_000, completedAt: h.now });
  seedRide(h, { status: 'negotiating', createdAt: h.now - 300_000, matchedAt: h.now - 180_000 });
  seedRide(h, { status: 'cancelled' });
  seedRide(h, { status: 'cancelled', closedReason: 'request_expired' });
  const elapsed = seedRide(h, { expiresAt: h.now });
  seedRide(h);
  const result = await service.get(admin.user);
  assert.deepEqual(result.totals, { requests: 6, matched: 2, completed: 1, unserved: 2, cancelled: 1, open: 2,
    matchedWithTiming: 2, meanMatchSeconds: 90 });
  assert.equal(result.totals.completed + result.totals.unserved + result.totals.cancelled + result.totals.open, result.totals.requests);
  assert.equal(h.db.prepare('SELECT status FROM rides WHERE id=?').get(elapsed).status, 'requested');
  assert.equal(result.cohort.basis, 'request_created_at'); assert.equal(result.cohort.outcomeAsOf, h.now);
  assert.equal(result.daily.length, 7); assert.equal(result.hours.length, 24);
  assert.equal(result.daily.reduce((sum, row) => sum + row.requests, 0), 6);
  assert.equal(result.hours.reduce((sum, row) => sum + row.requests, 0), 6);
});

test('demand grouping honors WAT midnight, region and service without turning completion dates into demand', async (t) => {
  const h = await harness(t), { admin } = await participants(h, 0), service = demand(h, admin);
  const midnight = Date.UTC(2026, 0, 1) - WAT_MS;
  seedRide(h, { createdAt: midnight - 1 });
  seedRide(h, { createdAt: midnight, category: 'motorcycle' });
  seedRide(h, { createdAt: midnight + 1, category: 'suv', region: 'sample:wuse-ii' });
  seedRide(h, { createdAt: h.now + 1 });
  seedRide(h, { createdAt: midnight - 8 * DAY_MS, status: 'agreed', matchedAt: midnight - 7 * DAY_MS, completedAt: h.now });
  const result = await service.get(admin.user, { from: '2026-01-01', to: '2026-01-01' });
  assert.equal(result.totals.requests, 2); assert.equal(result.totals.completed, 0);
  assert.equal(result.daily[0].date, '2026-01-01'); assert.equal(result.hours[0].requests, 2); assert.equal(result.hours[23].requests, 0);
  assert.equal((await service.get(admin.user, { from: '2026-01-01', to: '2026-01-01', service: 'courier' })).totals.requests, 1);
  const filtered = await service.get(admin.user, { from: '2026-01-01', to: '2026-01-01', service: 'ride', region: 'sample:wuse-ii' });
  assert.equal(filtered.totals.requests, 1); assert.equal(filtered.areas.items[0].region.kind, 'sample');
});

test('offer decisions use the selected request cohort and include expiry before worker maintenance', async (t) => {
  const h = await harness(t), { admin, driver } = await participants(h), service = demand(h, admin);
  const availability = h.db.prepare('SELECT id FROM driver_availability WHERE driver_id=? AND active=1').get(driver.user.id);
  const insert = h.db.prepare(`INSERT INTO dispatch_offers(id,ride_id,driver_id,availability_id,status,mode,policy_version,eta_source,created_at,expires_at,closed_at)
    VALUES (?,?,?,?,?,'sequential','test','sample',?,?,?)`);
  for (const status of ['pending', 'accepted', 'declined', 'expired', 'revoked']) {
    insert.run(randomUUID(), seedRide(h), driver.user.id, availability.id, status, h.now - 50_000, h.now - 1, status === 'pending' ? null : h.now);
  }
  // A current offer on an old request is outside the selected request cohort.
  insert.run(randomUUID(), seedRide(h, { createdAt: h.now - 20 * DAY_MS }), driver.user.id, availability.id,
    'accepted', h.now - 1000, h.now + 1000, h.now);
  const result = await service.get(admin.user);
  assert.deepEqual(result.offers, { total: 5, pending: 0, expired: 2, accepted: 1, declined: 1, revoked: 1,
    resolvedForAcceptance: 4, acceptanceRate: 0.25 });
  assert.equal(h.db.prepare("SELECT count(*) AS n FROM dispatch_offers WHERE status='pending'").get().n, 1);
});

test('car parcels count as courier demand while shared car supply is counted once in all-service totals', async (t) => {
  const h = await harness(t), { admin, drivers } = await participants(h, 5), service = demand(h, admin);
  for (const [index, category] of ['standard', 'suv', 'van', 'truck', 'motorcycle'].entries()) {
    h.db.prepare("UPDATE driver_applications SET details_json=json_set(details_json,'$.vehicle.category',?) WHERE driver_id=?")
      .run(category, drivers[index].user.id);
    seedRide(h, { category });
  }
  const parcel = seedRide(h, { category: 'standard', delivery: true, expiresAt: h.now });
  const all = await service.get(admin.user), ride = await service.get(admin.user, { service: 'ride' }), courier = await service.get(admin.user, { service: 'courier' });
  assert.equal(all.totals.requests, 6); assert.equal(ride.totals.requests, 2); assert.equal(courier.totals.requests, 4);
  assert.equal(ride.totals.unserved, 0); assert.equal(courier.totals.unserved, 1);
  assert.equal(all.supply.availableDrivers, 5); assert.equal(ride.supply.availableDrivers, 2); assert.equal(courier.supply.availableDrivers, 4);
  assert.equal(courier.areas.items.reduce((count, area) => count + (area.requests ?? 0), 0), 4);
  assert.equal(courier.daily.reduce((count, day) => count + day.requests, 0), 4);
  assert.equal(courier.hours.reduce((count, hour) => count + hour.requests, 0), 4);
  assert.equal(ride.totals.requests + courier.totals.requests, all.totals.requests);
  for (const secret of [parcel, 'Private recipient', 'Private parcel']) assert.ok(!JSON.stringify(courier).includes(secret));
});

test('current supply stays separate from historical requests and requires current eligibility, service and region', async (t) => {
  const h = await harness(t), { admin, drivers } = await participants(h, 4), service = demand(h, admin);
  h.db.prepare("UPDATE driver_applications SET details_json=json_set(details_json,'$.vehicle.category','motorcycle') WHERE driver_id=?").run(drivers[3].user.id);
  let result = await service.get(admin.user, { from: '2025-12-20', to: '2025-12-20' });
  assert.equal(result.totals.requests, 0); assert.equal(result.supply.availableDrivers, 4);
  assert.equal(result.supply.capturedAt, h.now); assert.equal(result.supply.scope, 'current');
  assert.equal(result.areas.items[0].requests, 0); assert.equal(result.areas.items[0].availableDrivers, 4);
  assert.equal((await service.get(admin.user, { service: 'courier' })).supply.availableDrivers, 4);
  assert.equal((await service.get(admin.user, { service: 'ride' })).supply.availableDrivers, 3);
  h.db.prepare("UPDATE driver_documents SET expires_on='2025-12-31' WHERE driver_id=? AND kind='insurance'").run(drivers[0].user.id);
  h.db.prepare('DELETE FROM sessions WHERE user_id=?').run(drivers[1].user.id);
  h.db.prepare('UPDATE driver_availability SET expires_at=? WHERE driver_id=?').run(h.now, drivers[2].user.id);
  result = await service.get(admin.user);
  assert.equal(result.supply.availableDrivers, 1); assert.equal(result.areas.items[0].region.label, 'Wuse II (sample)');
  assert.equal((await service.get(admin.user, { region: 'ng:181:148' })).supply.availableDrivers, 0);
  assert.equal((await demand(h, admin, { allowSimulation: false }).get(admin.user)).supply.availableDrivers, 0);
  seedRide(h, { customerId: drivers[3].user.id });
  assert.equal((await service.get(admin.user)).supply.availableDrivers, 0);
});

test('area results are bounded aggregate projections without personal or precise location data', async (t) => {
  const h = await harness(t), { admin } = await participants(h, 0), service = demand(h, admin);
  for (let i = 0; i < 60; i++) seedRide(h, { region: `ng:181:${100 + i}` });
  const result = await service.get(admin.user, { limit: '50' });
  assert.equal(result.totals.requests, 60); assert.equal(result.areas.items.length, 50); assert.equal(result.areas.truncated, true);
  assert.ok(result.areas.items.every((row) => row.requests === 1 && row.region.kind === 'dispatch_cell'));
  const text = JSON.stringify(result);
  for (const value of ['Private passenger name', 'private-pickup', 'private-destination', 'customerId', 'driverId', 'latitude', 'longitude', 'pickupPin', 'fareKobo']) assert.ok(!text.includes(value), value);
  const empty = await service.get(admin.user, { region: 'ng:190:190' });
  assert.equal(empty.totals.requests, 0); assert.equal(empty.totals.meanMatchSeconds, null); assert.equal(empty.offers.acceptanceRate, null);
});

test('unknown legacy area keys aggregate as unassigned before limits and filters, without exposing saved text', async (t) => {
  const h = await harness(t), { admin } = await participants(h, 0), service = demand(h, admin);
  for (const region of ['', 'Private apartment number 14', 'sample:unrecognized', 'ng:181:not-a-cell', 'ng:181:148:extra']) seedRide(h, { region });
  seedRide(h, { region: 'ng:181:148' });
  const result = await service.get(admin.user, { region: 'unassigned', limit: '1' });
  assert.equal(result.totals.requests, 5); assert.equal(result.areas.items.length, 1); assert.equal(result.areas.truncated, false);
  assert.equal(result.areas.items[0].region.key, 'unassigned'); assert.equal(result.areas.items[0].requests, 5);
  assert.ok(!JSON.stringify(result).includes('Private apartment'));
});

test('demand permission is refreshed before reading and duplicate or unsupported filters are rejected', async () => {
  let reads = 0;
  const service = createAdminDemandService({ requirePermission: async () => { throw new Error('FORBIDDEN'); },
    clock: () => Date.UTC(2026, 0, 1), unitOfWork: (run) => run(), repository: { totals: async () => { reads++; return {}; } } });
  await assert.rejects(service.get({ id: 'not-allowed' }), /FORBIDDEN/); assert.equal(reads, 0);
  const route = adminDemandRoutes(service)[0];
  await assert.rejects(route.handle({ user: { id: 'staff' }, query: new URLSearchParams('service=ride&service=courier') }), { code: 'INVALID_INPUT' });
  assert.equal(route.role, undefined, 'The service permission admits scoped operations staff without legacy admin promotion.');
});
