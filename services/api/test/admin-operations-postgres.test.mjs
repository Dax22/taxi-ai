import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { openPostgresDatabase } from '../src/infrastructure/postgres.mjs';
import { createAdminOperationsRepository } from '../src/modules/admin-operations/repository.mjs';
import { createAdminOperationsService } from '../src/modules/admin-operations/service.mjs';

const connectionString = process.env.TAXI_AI_TEST_POSTGRES_URL;
test('PostgreSQL operations projections preserve queue, lease, region and stage-age semantics', {
  skip: !connectionString && 'Set TAXI_AI_TEST_POSTGRES_URL to an isolated PostgreSQL/PostGIS test database.', timeout: 120000,
}, async () => {
  const schema = `test_ops_${randomUUID().replaceAll('-', '')}`;
  const db = await openPostgresDatabase({ connectionString, schema, max: 1, migrate: true });
  try {
    const now = Date.UTC(2026, 0, 1), driverId = randomUUID(), customerId = randomUUID(), staffId = randomUUID();
    for (const id of [driverId, customerId, staffId]) await db.prepare("INSERT INTO users(id,email,name,password_hash,role,created_at) VALUES (?,?,?,'test','customer',?)")
      .run(id, `${id}@example.test`, id === driverId ? 'Operations test driver' : 'Private test person', now);
    await db.prepare("INSERT INTO drivers(user_id,status,vehicle_model,vehicle_plate) VALUES (?,'approved','Test car','TEST')").run(driverId);
    await db.prepare("INSERT INTO driver_applications(driver_id,status,details_json,verification_json,updated_at) VALUES (?,'approved','{\"vehicle\":{\"category\":\"standard\"}}','{}',?)").run(driverId, now);
    for (const kind of ['profile_photo', 'driving_licence', 'vehicle_registration', 'insurance', 'vehicle_photo']) {
      await db.prepare(`INSERT INTO driver_documents(id,driver_id,kind,name,mime_type,size_bytes,sha256,expires_on,content,created_at)
        VALUES (?,?,?,'test','image/png',1,'test','2027-01-01',?,?)`).run(randomUUID(), driverId, kind, Buffer.from([0]), now);
    }
    await db.prepare("INSERT INTO account_capabilities(user_id,capability,created_at) VALUES (?,'driver',?)").run(driverId, now);
    await db.prepare("INSERT INTO sessions(token_hash,user_id,csrf_token,expires_at) VALUES ('ops-test',?,'test',?)").run(driverId, now + 60_000);
    await db.prepare(`INSERT INTO driver_availability(id,driver_id,active,mode,position_json,session_hash,client_hash,sequence,started_at,seen_at,expires_at,latitude,longitude)
      VALUES (?,?,1,'gps',?,'ops-test','test',1,?,?,?,?,?)`).run(randomUUID(), driverId,
      JSON.stringify({ lat: 9.08, lng: 7.41, capturedAt: now, accuracy: 10 }), now, now, now + 30_000, 9.08, 7.41);
    const service = createAdminOperationsService({ repository: createAdminOperationsRepository(db), requirePermission: async () => {}, clock: () => now, unitOfWork: (run) => db.transaction(run) });
    let result = await service.get({ id: staffId }, { queue: 'drivers' });
    assert.equal(result.counts.availableDrivers, 1); assert.equal(result.queues.drivers.items[0].region.key, 'ng:181:148');
    assert.equal(result.queues.drivers.items[0].vehicleCategory, 'standard');
    const rideId = randomUUID();
    await db.prepare(`INSERT INTO rides(id,customer_id,pickup_id,destination_id,suggested_fare_kobo,status,created_at,updated_at,request_expires_at,dispatch_region)
      VALUES (?,?,'wuse-ii','maitama',300000,'requested',?,?,?,'ng:181:148')`).run(rideId, customerId, now - 60_000, now - 60_000, now + 60_000);
    result = await service.get({ id: staffId }, { queue: 'waiting', region: 'ng:181:148' });
    assert.equal(result.counts.waitingRequests, 1); assert.equal(result.queues.waiting.items[0].waitSeconds, 60);
    await db.prepare("UPDATE rides SET status='negotiating',driver_id=?,matched_at=? WHERE id=?").run(driverId, now, rideId);
    result = await service.get({ id: staffId }, { queue: 'active' });
    assert.equal(result.counts.activeTrips, 1); assert.equal(result.counts.availableDrivers, 0);
    assert.equal(result.queues.active.items[0].driverName, 'Operations test driver');
    const storeId = randomUUID();
    await db.prepare("INSERT INTO eats_stores(id,status,details_json,created_at,updated_at) VALUES (?,'approved','{}',?,?)").run(storeId, now, now);
    await db.prepare(`INSERT INTO eats_orders(id,store_id,customer_id,status,snapshot_json,events_json,created_at,updated_at)
      VALUES (?,?,?,'preparing',?,'[]',?,?)`).run(randomUUID(), storeId, customerId,
      JSON.stringify({ restaurant: { name: 'Test Kitchen', areaId: 'wuse-ii', prepMinutes: 20 }, fulfillment: 'delivery', address: { line: 'Private delivery address' } }), now - 3_000_000, now - 1_801_000);
    result = await service.get({ id: staffId }, { queue: 'eats', status: 'preparing' });
    assert.equal(result.counts.delayedEats, 1); assert.equal(result.queues.eats.items[0].delaySeconds, 1);
    assert.equal(result.queues.eats.items[0].expectedStageSeconds, 1800);
    assert.ok(!JSON.stringify(result).includes('Private delivery address'));
  } finally { await db.exec(`DROP SCHEMA "${schema}" CASCADE`); await db.close(); }
});
