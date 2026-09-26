import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { openPostgresDatabase } from '../src/infrastructure/postgres.mjs';
import { createAdminDemandRepository } from '../src/modules/admin-demand/repository.mjs';
import { createAdminDemandService } from '../src/modules/admin-demand/service.mjs';

const connectionString = process.env.TAXI_AI_TEST_POSTGRES_URL;
test('PostgreSQL demand aggregates preserve WAT buckets, request cohorts, unknown areas and separate current supply', {
  skip: !connectionString && 'Set TAXI_AI_TEST_POSTGRES_URL to an isolated PostgreSQL/PostGIS test database.', timeout: 120000,
}, async () => {
  const schema = `test_demand_${randomUUID().replaceAll('-', '')}`;
  const db = await openPostgresDatabase({ connectionString, schema, max: 1, migrate: true });
  try {
    const now = Date.UTC(2026, 0, 1), midnight = now - 3_600_000, driverId = randomUUID(), staffId = randomUUID();
    async function user(id = randomUUID()) {
      await db.prepare("INSERT INTO users(id,email,name,password_hash,role,created_at) VALUES (?,?,?,'test','customer',?)")
        .run(id, `${id}@example.test`, 'Private person', now);
      return id;
    }
    await user(driverId); await user(staffId);
    await db.prepare("INSERT INTO drivers(user_id,status,vehicle_model,vehicle_plate) VALUES (?,'approved','Test car','TEST')").run(driverId);
    await db.prepare("INSERT INTO driver_applications(driver_id,status,details_json,verification_json,updated_at) VALUES (?,'approved','{\"vehicle\":{\"category\":\"standard\"}}','{}',?)").run(driverId, now);
    for (const kind of ['profile_photo', 'driving_licence', 'vehicle_registration', 'insurance', 'vehicle_photo']) {
      await db.prepare(`INSERT INTO driver_documents(id,driver_id,kind,name,mime_type,size_bytes,sha256,expires_on,content,created_at)
        VALUES (?,?,?,'test','image/png',1,'test','2027-01-01',?,?)`).run(randomUUID(), driverId, kind, Buffer.from([0]), now);
    }
    await db.prepare("INSERT INTO account_capabilities(user_id,capability,created_at) VALUES (?,'driver',?)").run(driverId, now);
    await db.prepare("INSERT INTO sessions(token_hash,user_id,csrf_token,expires_at) VALUES ('demand-test',?,'test',?)").run(driverId, now + 60_000);
    const availabilityId = randomUUID();
    await db.prepare(`INSERT INTO driver_availability(id,driver_id,active,mode,position_json,session_hash,client_hash,sequence,started_at,seen_at,expires_at,latitude,longitude)
      VALUES (?,?,1,'gps',?,'demand-test','test',1,?,?,?,?,?)`).run(availabilityId, driverId,
      JSON.stringify({ lat: 9.08, lng: 7.41, capturedAt: now, accuracy: 10 }), now, now, now + 30_000, 9.08, 7.41);
    async function ride({ createdAt = midnight, region = 'ng:181:148', category = 'standard', matched = false,
      delivery = ['van', 'truck', 'motorcycle'].includes(category) } = {}) {
      const id = randomUUID(), customerId = await user(), assignedDriver = matched ? await user() : null;
      await db.prepare(`INSERT INTO rides(id,customer_id,driver_id,pickup_id,destination_id,suggested_fare_kobo,status,created_at,updated_at,request_expires_at,dispatch_region,vehicle_category,matched_at)
        VALUES (?, ?, ?, 'private-pickup','private-destination',300000,?,?,?,?,?,?,?)`).run(id, customerId, assignedDriver,
        matched ? 'negotiating' : 'requested', createdAt, createdAt, now - 1, region, category, matched ? createdAt + 60_000 : null);
      if (delivery) await db.prepare('INSERT INTO delivery_orders(ride_id,details_json) VALUES (?,?)')
        .run(id, JSON.stringify({ recipientName: 'Private recipient', packageDescription: 'Private parcel' }));
      return id;
    }
    const eligibleRide = await ride();
    await ride({ region: 'sample:wuse-ii', category: 'motorcycle', matched: true });
    await ride({ region: 'legacy-private-address' });
    await ride({ region: 'ng:181:invalid' });
    await ride({ createdAt: midnight - 1 });
    await ride({ createdAt: now + 1 });
    await db.prepare(`INSERT INTO dispatch_offers(id,ride_id,driver_id,availability_id,status,mode,policy_version,eta_source,created_at,expires_at)
      VALUES (?,?,?,?,'pending','sequential','test','sample',?,?)`).run(randomUUID(), eligibleRide, driverId, availabilityId, midnight, now - 1);
    const service = createAdminDemandService({ repository: createAdminDemandRepository(db), requirePermission: async () => {},
      clock: () => now, unitOfWork: (run) => db.transaction(run) });
    const query = { from: '2026-01-01', to: '2026-01-01' };
    const result = await service.get({ id: staffId }, query);
    assert.equal(result.totals.requests, 4); assert.equal(result.totals.unserved, 3); assert.equal(result.totals.matched, 1);
    assert.equal(result.totals.meanMatchSeconds, 60); assert.equal(result.hours[0].requests, 4);
    assert.equal(result.daily[0].date, '2026-01-01'); assert.equal(result.offers.expired, 1);
    assert.equal(result.supply.availableDrivers, 1); assert.equal(result.supply.capturedAt, now);
    assert.equal(result.areas.items.find((row) => row.region.key === 'unassigned').requests, 2);
    assert.equal((await service.get({ id: staffId }, { ...query, service: 'courier' })).totals.requests, 1);
    assert.equal((await service.get({ id: staffId }, { ...query, service: 'courier' })).supply.availableDrivers, 1);
    assert.equal((await service.get({ id: staffId }, { ...query, region: 'unassigned' })).totals.requests, 2);
    const cell = await service.get({ id: staffId }, { ...query, region: 'ng:181:148', service: 'ride' });
    assert.equal(cell.totals.requests, 1); assert.equal(cell.supply.availableDrivers, 1);
    await ride({ category: 'standard', delivery: true });
    const withParcel = await service.get({ id: staffId }, query);
    const parcelDemand = await service.get({ id: staffId }, { ...query, service: 'courier' });
    const passengerDemand = await service.get({ id: staffId }, { ...query, service: 'ride' });
    assert.equal(withParcel.totals.requests, 5); assert.equal(parcelDemand.totals.requests, 2); assert.equal(passengerDemand.totals.requests, 3);
    assert.equal(withParcel.supply.availableDrivers, 1); assert.equal(parcelDemand.supply.availableDrivers, 1); assert.equal(passengerDemand.supply.availableDrivers, 1);
    for (const value of ['Private person', 'legacy-private-address', 'private-pickup', 'latitude', 'longitude', 'driverId', 'customerId']) {
      assert.ok(!JSON.stringify(result).includes(value), value);
    }
  } finally { await db.exec(`DROP SCHEMA "${schema}" CASCADE`); await db.close(); }
});
