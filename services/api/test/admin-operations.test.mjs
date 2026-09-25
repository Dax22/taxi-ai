import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { harness, participants, requestRide, claimRide } from './helpers.mjs';
import { asAsyncDatabase } from '../src/infrastructure/async-database.mjs';
import { createAdminOperationsRepository } from '../src/modules/admin-operations/repository.mjs';
import { createAdminOperationsService } from '../src/modules/admin-operations/service.mjs';
import { operationsFilters, regionSummary } from '../src/modules/admin-operations/domain.mjs';
import { adminOperationsRoutes } from '../src/modules/admin-operations/routes.mjs';

function operations(h, admin, options = {}) {
  const db = asAsyncDatabase(h.db);
  return createAdminOperationsService({ repository: createAdminOperationsRepository(db), clock: () => h.now,
    unitOfWork: (run) => db.transaction(run), allowSimulation: true,
    requirePermission: async (id, permission) => { assert.equal(permission, 'operations.read'); if (id !== admin.user.id) throw new Error('FORBIDDEN'); }, ...options });
}
function seedUser(h) {
  const id = randomUUID();
  h.db.prepare("INSERT INTO users(id,email,name,password_hash,role,created_at) VALUES (?,?,?,'fixture','customer',?)")
    .run(id, id + '@example.test', 'Private passenger name', h.now);
  return id;
}
function seedRide(h, { customerId = seedUser(h), status = 'requested', createdAt = h.now - 60_000, expiresAt = h.now + 120_000, region = 'ng:181:148' } = {}) {
  const id = randomUUID();
  h.db.prepare(`INSERT INTO rides(id,customer_id,pickup_id,destination_id,suggested_fare_kobo,status,created_at,updated_at,request_expires_at,dispatch_region)
    VALUES (?,?,'private-pickup','private-destination',300000,?,?,?,?,?)`).run(id, customerId, status, createdAt, createdAt, expiresAt, region);
  return id;
}

test('operations queues apply keyset, region and status filters while global counts omit expired requests', async (t) => {
  const h = await harness(t), { admin } = await participants(h, 0), service = operations(h, admin);
  const ids = Array.from({ length: 56 }, () => seedRide(h));
  seedRide(h, { expiresAt: h.now }); seedRide(h, { status: 'cancelled' });
  const otherRegion = seedRide(h, { region: 'sample:wuse-ii' });
  let page = await service.get(admin.user, { limit: '17' }), seen = [];
  assert.equal(page.counts.waitingRequests, 57); assert.equal(page.countScope, 'all_regions');
  do {
    seen.push(...page.queues.waiting.items.map((row) => row.id));
    page = page.queues.waiting.nextCursor ? await service.get(admin.user, { limit: '17', after: page.queues.waiting.nextCursor }) : null;
  } while (page);
  assert.equal(seen.length, 57); assert.equal(new Set(seen).size, 57);
  assert.deepEqual(new Set(seen), new Set([...ids, otherRegion]));
  const filtered = await service.get(admin.user, { region: 'sample:wuse-ii', status: 'requested' });
  assert.equal(filtered.counts.waitingRequests, 57); assert.deepEqual(filtered.queues.waiting.items.map((row) => row.id), [otherRegion]);
  assert.equal(filtered.queues.waiting.items[0].region.label, 'Wuse II (sample)');
  for (const field of ['Private passenger name', 'private-pickup', 'private-destination', 'customerId', 'pickupPin', 'latitude', 'longitude']) {
    assert.ok(!JSON.stringify(filtered).includes(field), field);
  }
});

test('available driver counts exclude expired documents, sessions, leases, busy drivers and reserved dispatch offers', async (t) => {
  const h = await harness(t), { admin, drivers } = await participants(h, 4), service = operations(h, admin);
  let result = await service.get(admin.user, { queue: 'drivers' });
  assert.equal(result.counts.availableDrivers, 4);
  assert.equal(result.queues.drivers.items[0].region.label, 'Wuse II (sample)');
  h.db.prepare("UPDATE driver_documents SET expires_on='2025-12-31' WHERE driver_id=? AND kind='insurance'").run(drivers[0].user.id);
  h.db.prepare('DELETE FROM sessions WHERE user_id=?').run(drivers[1].user.id);
  h.db.prepare('UPDATE driver_availability SET expires_at=? WHERE driver_id=?').run(h.now, drivers[2].user.id);
  result = await service.get(admin.user, { queue: 'drivers' });
  assert.equal(result.counts.availableDrivers, 1); assert.equal(result.queues.drivers.items[0].driverName, drivers[3].user.name);
  const availability = h.db.prepare('SELECT id FROM driver_availability WHERE driver_id=? AND active=1').get(drivers[3].user.id);
  const rideId = seedRide(h);
  h.db.prepare(`INSERT INTO dispatch_offers(id,ride_id,driver_id,availability_id,status,mode,policy_version,eta_source,created_at,expires_at)
    VALUES (?,?,?,?,'pending','sequential','test','sample',?,?)`).run(randomUUID(), rideId, drivers[3].user.id, availability.id, h.now, h.now + 10_000);
  assert.equal((await service.get(admin.user)).counts.availableDrivers, 0);
  h.db.prepare("UPDATE dispatch_offers SET status='expired',closed_at=? WHERE ride_id=?").run(h.now, rideId);
  assert.equal((await service.get(admin.user)).counts.availableDrivers, 1);
  seedRide(h, { customerId: drivers[3].user.id });
  assert.equal((await service.get(admin.user)).counts.availableDrivers, 0, 'A driver waiting for their own ride is unavailable for work');
  assert.equal((await operations(h, admin, { allowSimulation: false }).get(admin.user)).counts.availableDrivers, 0);
});

test('matching offer counters use a 24-hour offer cohort and expire elapsed pending leases without waiting for maintenance', async (t) => {
  const h = await harness(t), { admin, driver } = await participants(h), service = operations(h, admin);
  const availability = h.db.prepare('SELECT id FROM driver_availability WHERE driver_id=? AND active=1').get(driver.user.id);
  const insert = h.db.prepare(`INSERT INTO dispatch_offers(id,ride_id,driver_id,availability_id,status,mode,policy_version,eta_source,created_at,expires_at,closed_at)
    VALUES (?,?,?,?,?,'sequential','test','sample',?,?,?)`);
  for (const status of ['pending', 'declined', 'accepted', 'expired', 'revoked']) {
    insert.run(randomUUID(), seedRide(h), driver.user.id, availability.id, status, h.now - 20_000, h.now - 10_000, status === 'pending' ? null : h.now - 5_000);
  }
  insert.run(randomUUID(), seedRide(h), driver.user.id, availability.id, 'declined', h.now - 86_400_001, h.now - 86_390_001, h.now - 86_390_001);
  const rideId = seedRide(h);
  h.db.prepare("INSERT INTO dispatch_journeys(ride_id,mode,location_mode,created_at,matched_at) VALUES (?,'sequential','sample',?,?)")
    .run(rideId, h.now - 90_000, h.now - 60_000);
  const { matching } = await service.get(admin.user);
  assert.equal(matching.unit, 'offers'); assert.equal(matching.expired, 2); assert.equal(matching.declined, 1);
  assert.equal(matching.accepted, 1); assert.equal(matching.pending, 0); assert.equal(matching.matchedRequests, 1);
  assert.equal(matching.meanMatchSeconds, 30); assert.equal(matching.until - matching.since, 86_400_000);
});

test('active trips expose only vehicle freshness from the location port, never private coordinates or route contents', async (t) => {
  const h = await harness(t), { admin, driver, customer } = await participants(h);
  const ride = await claimRide(driver, await requestRide(customer));
  let position = { lat: 9.08, lng: 7.41, capturedAt: h.now - 35_000, stale: true, source: 'driver_shared' };
  const service = operations(h, admin, { locationForTrip: async (id) => { assert.equal(id, ride.id); return position; } });
  const page = await service.get(admin.user, { queue: 'active', status: 'negotiating' });
  assert.equal(page.counts.activeTrips, 1); assert.equal(page.queues.active.items.length, 1);
  assert.deepEqual(page.queues.active.items[0].location, { status: 'stale', capturedAt: position.capturedAt });
  assert.ok(!JSON.stringify(page).includes('9.08')); assert.ok(!JSON.stringify(page).includes('7.41'));
  position = null;
  assert.deepEqual((await service.get(admin.user, { queue: 'active' })).queues.active.items[0].location, { status: 'unavailable', capturedAt: null });
  await customer.post(`/api/rides/${ride.id}/cancel`, { expectedVersion: ride.version });
  assert.equal((await service.get(admin.user)).counts.activeTrips, 0);
});

test('Eats attention queue uses saved stage age and fulfillment policy without exposing delivery or private kitchen addresses', async (t) => {
  const h = await harness(t), { admin, customer } = await participants(h, 0), service = operations(h, admin), storeId = randomUUID();
  h.db.prepare("INSERT INTO eats_stores(id,status,details_json,created_at,updated_at) VALUES (?,'approved','{}',?,?)").run(storeId, h.now, h.now);
  const insert = h.db.prepare(`INSERT INTO eats_orders(id,store_id,customer_id,status,snapshot_json,events_json,created_at,updated_at)
    VALUES (?,?,?,?,?,'[]',?,?)`);
  function order(status, ageSeconds, fulfillment = 'delivery') {
    const id = randomUUID(), snapshot = { restaurant: { name: 'Home Kitchen', areaId: 'wuse-ii', prepMinutes: 20, address: 'Secret kitchen address' },
      address: { line: 'Secret delivery address' }, fulfillment, instructions: 'Private instructions', lines: [] };
    insert.run(id, storeId, customer.user.id, status, JSON.stringify(snapshot), h.now - 8_000_000, h.now - ageSeconds * 1000); return id;
  }
  const duePlaced = order('placed', 300), duePrep = order('preparing', 1800), dueReady = order('ready', 601);
  order('placed', 299); order('preparing', 1799); order('ready', 601, 'pickup'); order('delivered', 99999); order('cancelled', 99999);
  const result = await service.get(admin.user, { queue: 'eats', region: 'wuse-ii' });
  assert.equal(result.counts.delayedEats, 3);
  assert.deepEqual(new Set(result.queues.eats.items.map((row) => row.id)), new Set([duePlaced, duePrep, dueReady]));
  assert.equal(result.queues.eats.items.find((row) => row.id === dueReady).delaySeconds, 1);
  for (const field of ['Secret', 'instructions', 'customerId', 'pickupPin', 'deliveryPin']) assert.ok(!JSON.stringify(result).includes(field), field);
});

test('operations permissions and filters are checked on each read, with no queue read on denial', async () => {
  let allowed = true, reads = 0;
  const service = createAdminOperationsService({ requirePermission: async () => { if (!allowed) throw new Error('FORBIDDEN'); },
    clock: () => 1_000_000, unitOfWork: (run) => run(), repository: {
      counts: async () => { reads++; return {}; }, queue: async () => [], matching: async () => ({}),
    } });
  await service.get({ id: 'staff' }); allowed = false;
  await assert.rejects(service.get({ id: 'staff' }), /FORBIDDEN/); assert.equal(reads, 1);
  for (const query of [{ limit: '51' }, { limit: '1.2' }, { queue: 'all' }, { queue: 'drivers', status: 'requested' }, { after: 'bad' }, { q: 'private passenger' }]) {
    assert.throws(() => operationsFilters(query), (error) => ['INVALID_INPUT', 'INVALID_FIELDS'].includes(error.code));
  }
  const route = adminOperationsRoutes(service)[0];
  await assert.rejects(route.handle({ user: { id: 'staff' }, query: new URLSearchParams('queue=waiting&queue=active') }), { code: 'INVALID_INPUT' });
  assert.equal(regionSummary('ng:181:148').label, 'ng:181:148', 'A dispatch cell is not described as a verified city');
  assert.equal(regionSummary(''), null);
});
