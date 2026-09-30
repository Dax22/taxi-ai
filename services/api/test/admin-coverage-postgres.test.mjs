import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { openPostgresDatabase } from '../src/infrastructure/postgres.mjs';
import { createAdminDemandRepository } from '../src/modules/admin-demand/repository.mjs';
import { createAdminDemandService } from '../src/modules/admin-demand/service.mjs';

const connectionString = process.env.TAXI_AI_TEST_POSTGRES_URL;
test('PostgreSQL coverage keeps JSON numeric guards, bounded GPS aggregates, current eligibility and snapshot/date separation', {
  skip: !connectionString && 'Set TAXI_AI_TEST_POSTGRES_URL to an isolated PostgreSQL/PostGIS test database.', timeout: 120000,
}, async () => {
  const schema = `test_coverage_${randomUUID().replaceAll('-', '')}`;
  const db = await openPostgresDatabase({ connectionString, schema, max: 1, migrate: true });
  const now = Date.UTC(2026, 0, 1, 12), owner = randomUUID(), driver = randomUUID();
  const service = createAdminDemandService({ repository: createAdminDemandRepository(db), clock: () => now,
    unitOfWork: run => db.transaction(run), allowSimulation: true,
    requirePermission: async (id, permission) => { assert.equal(id, owner); assert.equal(permission, 'demand.read'); } });
  try {
    for (const [id, role] of [[owner, 'admin'], [driver, 'driver']]) {
      await db.prepare('INSERT INTO users(id,email,name,password_hash,role,created_at) VALUES (?,?,?,?,?,?)')
        .run(id, id + '@coverage-pg.example.test', 'PRIVATE-NAME', 'fixture-non-login-hash', role, now);
    }
    await db.prepare("INSERT INTO drivers(user_id,status,vehicle_model,vehicle_plate) VALUES (?,'approved','Test car','TEST-PG')").run(driver);
    await db.prepare("INSERT INTO driver_applications(driver_id,status,details_json,verification_json,updated_at) VALUES (?,'approved',?,'{}',?)")
      .run(driver, JSON.stringify({ vehicle: { category: 'standard' } }), now);
    await db.prepare("INSERT INTO account_capabilities(user_id,capability,created_at) VALUES (?,'driver',?)").run(driver, now);
    for (const kind of ['profile_photo', 'driving_licence', 'vehicle_registration', 'insurance', 'vehicle_photo']) {
      await db.prepare(`INSERT INTO driver_documents(id,driver_id,kind,name,mime_type,size_bytes,sha256,expires_on,content,created_at)
        VALUES (?,?,?,'test','image/png',1,'test',?,?,?)`).run(randomUUID(), driver, kind, kind.endsWith('photo') ? null : '2027-01-01', Buffer.from([0]), now);
    }
    const sessionHash = 'coverage-pg-session';
    await db.prepare('INSERT INTO sessions(token_hash,user_id,csrf_token,expires_at) VALUES (?,?,?,?)').run(sessionHash, driver, 'test', now + 60000);
    await db.prepare(`INSERT INTO driver_availability(id,driver_id,active,mode,position_json,session_hash,client_hash,sequence,started_at,seen_at,expires_at,latitude,longitude)
      VALUES (?,?,1,'gps',?,?,'test',1,?,?,?,?,?)`).run(randomUUID(), driver,
      JSON.stringify({ lat: 9.076541, lng: 7.462321, capturedAt: now, accuracy: 10 }), sessionHash, now, now, now + 30000, 9.076541, 7.462321);
    const ids = [], customers = [];
    const fixturePoints = [
      { lat: 9.076541, lng: 7.462321 }, // Selected Abuja cell.
      { lat: 6.456789, lng: 3.356789 }, // Outside viewport, nationwide Lagos demand.
      { lat: '9.076541', lng: '7.462321' }, // JSON text must never be cast into valid GPS.
      { lat: 'not-a-number', lng: 'private longitude' },
      { lat: 9.076541, lng: 7.462321 }, // Live request before chosen history period.
      { lat: 9.076541, lng: 7.462321 }, // Valid observed pickup wait.
    ];
    for (const [index, point] of fixturePoints.entries()) {
      const id = randomUUID(); ids.push(id);
      const customer = randomUUID(); customers.push(customer);
      await db.prepare('INSERT INTO users(id,email,name,password_hash,role,created_at) VALUES (?,?,?,?,?,?)')
        .run(customer, customer + '@coverage-pg.example.test', 'PRIVATE-NAME', 'fixture-non-login-hash', 'customer', now);
      const createdAt = index === 4 ? now - 20 * 86400000 : now - 600000;
      await db.prepare(`INSERT INTO rides(id,customer_id,driver_id,pickup_id,destination_id,suggested_fare_kobo,status,created_at,updated_at,request_expires_at,matched_at,dispatch_region)
        VALUES (?,?,?,'PRIVATE-PICKUP','PRIVATE-DESTINATION',300000,?,?,?,?,?,'ng:181:149')`)
        .run(id, customer, index === 5 ? driver : null, index === 5 ? 'agreed' : 'requested', createdAt, createdAt,
          index === 1 ? now : now + 60000, index === 5 ? now - 500000 : null);
      await db.prepare('INSERT INTO location_quotes(id,customer_id,created_at,expires_at,route_json,ride_id) VALUES (?,?,?,?,?,?)')
        .run(randomUUID(), customer, createdAt, now + 60000, JSON.stringify({ pickup: { ...point, label: 'PRIVATE-ADDRESS' } }), id);
      if (index === 5) await db.prepare(`INSERT INTO ride_trips(ride_id,customer_id,driver_id,status,fare_kobo,booked_at,departed_at,arrived_at,started_at,completed_at)
        VALUES (?,?,?,'completed',300000,?,?,?,?,?)`).run(id, customer, driver, now - 400000, now - 390000, now - 220000, now - 210000, now);
    }
    const result = await service.coverage({ id: owner }, { bbox: '7.462301,9.076511,7.462399,9.076599' });
    assert.deepEqual(result.viewport.bounds, { west: 7.46, south: 9.07, east: 7.47, north: 9.08 });
    assert.equal(result.cells.length, 1);
    assert.deepEqual(result.cells[0].bounds, result.viewport.bounds, 'GPS cell indices must floor, not round into a neighbouring cell');
    assert.equal(result.historicalTotals.requests, 2); assert.equal(result.currentTotals.waitingRequests, 2);
    assert.equal(result.currentTotals.availableDrivers, 1); assert.equal(result.historicalTotals.pickupWaitObservations, 1);
    assert.equal(result.historicalTotals.meanPickupWaitSeconds, 180);
    assert.equal(result.outsideViewport.historical.requests, 1); assert.equal(result.outsideViewport.historical.unserved, 1);
    assert.equal(result.offMap.historical.unlocated.requests, 2); assert.equal(result.nationwideTotals.historical.requests, 5);
    const outsideDates = await service.coverage({ id: owner }, { from: '2025-12-20', to: '2025-12-20' });
    assert.equal(outsideDates.historicalTotals.requests, 0); assert.equal(outsideDates.currentTotals.waitingRequests, 2);
    assert.equal(outsideDates.currentTotals.availableDrivers, 1);
    await db.prepare('INSERT INTO delivery_orders(ride_id,details_json) VALUES (?,?)')
      .run(ids[0], JSON.stringify({ recipientName: 'PRIVATE-RECIPIENT', packageDescription: 'PRIVATE-PARCEL' }));
    const courier = await service.coverage({ id: owner }, { service: 'courier' });
    const passenger = await service.coverage({ id: owner }, { service: 'ride' });
    const all = await service.coverage({ id: owner });
    assert.equal(courier.historicalTotals.requests, 1); assert.equal(courier.currentTotals.waitingRequests, 1);
    assert.equal(courier.currentTotals.availableDrivers, 1); assert.equal(passenger.currentTotals.availableDrivers, 1);
    assert.equal(all.currentTotals.availableDrivers, 1);
    assert.equal(courier.nationwideTotals.historical.requests + passenger.nationwideTotals.historical.requests, all.nationwideTotals.historical.requests);
    for (const secret of ['PRIVATE-RECIPIENT', 'PRIVATE-PARCEL']) assert.ok(!JSON.stringify(courier).includes(secret));
    for (const secret of [...customers, driver, ...ids, 'PRIVATE-NAME', 'PRIVATE-ADDRESS', 'PRIVATE-PICKUP', '9.076541', '7.462321']) assert.ok(!JSON.stringify(result).includes(secret), secret);
    await db.prepare('DELETE FROM sessions WHERE token_hash=?').run(sessionHash);
    assert.equal((await service.coverage({ id: owner })).currentTotals.availableDrivers, 0);
  } finally {
    try { await db.exec(`DROP SCHEMA ${schema} CASCADE`); } finally { await db.close(); }
  }
});
