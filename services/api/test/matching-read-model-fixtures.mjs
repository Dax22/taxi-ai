import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readMatchingFastConfig } from '../src/infrastructure/matching-fast-config.mjs';
import { createApplication } from '../src/application.mjs';
import { createRidesService } from '../src/modules/rides/service.mjs';
import { createRidesRepository } from '../src/modules/rides/repository.mjs';
import { createMatchingRepository, createDispatchRepository } from '../src/modules/dispatch/repository.mjs';
import { createMatchingReadModel } from '../src/modules/dispatch/matching-read-model.mjs';
import { matchingPairKey } from '../src/shared/matching-pair-key.mjs';
import { eligibility } from '../src/modules/drivers/domain.mjs';
import { DRIVER_DOCUMENTS } from '../../../packages/shared/src/driver-onboarding.mjs';

export const matchingNow = Date.UTC(2026, 0, 1) + 1_000_000;
export async function matchingFixture(db) {
  const now = matchingNow;
  for (const id of ['customer', 'driver', 'other']) {
    await db.prepare('INSERT INTO users(id,email,name,password_hash,role,created_at) VALUES(?,?,?,?,?,?)')
      .run(id, `${id}@example.test`, id, 'unused', id === 'driver' ? 'driver' : 'customer', now);
    await db.prepare("INSERT INTO account_capabilities(user_id,capability,created_at) VALUES(?,'customer',?)").run(id, now);
  }
  await db.prepare("INSERT INTO account_capabilities(user_id,capability,created_at) VALUES('driver','driver',?)").run(now);
  await db.prepare("INSERT INTO drivers(user_id,status,vehicle_model,vehicle_plate) VALUES('driver','approved','Toyota Corolla','TEST')").run();
  const details = { vehicle: { make: 'Toyota', model: 'Corolla', year: 2020, colour: 'Black', plate: 'TEST', category: 'standard' } };
  await db.prepare("INSERT INTO driver_applications(driver_id,status,details_json,verification_json,updated_at) VALUES('driver','approved',?,'{}',?)")
    .run(JSON.stringify(details), now);
  for (const [kind, policy] of Object.entries(DRIVER_DOCUMENTS)) {
    await db.prepare("INSERT INTO driver_documents(id,driver_id,kind,name,mime_type,size_bytes,sha256,expires_on,content,created_at) VALUES(?,'driver',?,?,'image/png',1,'test',?,?,?)")
      .run(kind, kind, kind, policy.expires ? '2027-01-01' : null, Buffer.from([1]), now);
  }
  await db.prepare("INSERT INTO sessions(token_hash,user_id,csrf_token,expires_at) VALUES('session','driver','csrf',?)").run(now + 60_000);
  await db.prepare("INSERT INTO device_sessions(id,user_id,name,access_hash,access_expires_at,created_at,refreshed_at,expires_at,idle_expires_at) VALUES('native','driver','phone','access',?,?,?,?,?)")
    .run(now - 1, now, now, now + 60_000, now + 60_000);
  await db.prepare("INSERT INTO driver_availability(id,driver_id,active,mode,area_id,session_hash,client_hash,sequence,started_at,seen_at,expires_at) VALUES('availability','driver',1,'sample','wuse-ii','session','client',1,?,?,?)")
    .run(now, now, now + 60_000);
  await db.prepare("INSERT INTO rides(id,customer_id,pickup_id,destination_id,suggested_fare_kobo,created_at,updated_at,request_expires_at,dispatch_region) VALUES('ride','customer','wuse-ii','maitama',50000,?,?,?,'sample:wuse-ii')")
    .run(now, now, now + 300_000);
  const legacy = createApplication({ db, clock: () => now, allowSimulation: true, dispatchConfig: { mode: 'legacy' } });
  let operations = 0;
  const counted = { prepare(sql) { operations++; return db.prepare(sql); } };
  const matching = createMatchingReadModel({ repository: createMatchingRepository(counted), driverEligibility: eligibility, clock: () => now, allowSimulation: true });
  const fast = createRidesService({ repository: createRidesRepository(db), matching,
    nearbyMatchingDriverIds: legacy.availability.nearbyMatchingDriverIds });
  const edge = { rideId: 'ride', driverId: 'driver' }, key = matchingPairKey('ride', 'driver');
  const currentFast = async () => (await fast.dispatchCandidatesFor([edge], now)).get(key) ?? null;
  const currentLegacy = () => legacy.rides.dispatchCandidateFor('ride', 'driver', now);
  return { legacy, matching, fast, edge, key, now, currentFast, currentLegacy,
    operations: () => operations, resetOperations() { operations = 0; } };
}

export async function matchingParity(t, db) {
  const f = await matchingFixture(db), { now } = f;
  const initial = await f.currentLegacy();
  assert.ok(initial);
  assert.deepEqual(await f.currentFast(), initial);
  const rolledBack = new Error('rollback fixture');
  async function scenario(name, mutation, expected = false) {
    await t.test(name, async () => {
      await assert.rejects(db.transaction(async () => {
        await mutation();
        const legacy = await f.currentLegacy(), fast = await f.currentFast();
        assert.deepEqual(fast, legacy, 'optimized projection must preserve current business rules');
        assert.equal(Boolean(fast), expected);
        throw rolledBack;
      }), error => error === rolledBack);
    });
  }
  const sql = (statement, ...parameters) => () => db.prepare(statement).run(...parameters);
  await scenario('driver capability revoked', sql("DELETE FROM account_capabilities WHERE user_id='driver' AND capability='driver'"));
  await scenario('admin cannot dispatch', sql("UPDATE users SET role='admin' WHERE id='driver'"));
  await scenario('driver approval revoked', sql("UPDATE drivers SET status='pending' WHERE user_id='driver'"));
  await scenario('application reopened', sql("UPDATE driver_applications SET status='draft' WHERE driver_id='driver'"));
  await scenario('application verification missing', sql("UPDATE driver_applications SET verification_json=NULL WHERE driver_id='driver'"));
  await scenario('application details missing', sql("UPDATE driver_applications SET details_json=NULL WHERE driver_id='driver'"));
  await scenario('required document removed', sql("DELETE FROM driver_documents WHERE kind='vehicle_photo'"));
  await scenario('Nigeria document deadline expired', sql("UPDATE driver_documents SET expires_on='2025-12-31' WHERE kind='insurance'"));
  await scenario('web session expired at boundary', sql('UPDATE sessions SET expires_at=?', now));
  await scenario('web session belongs to someone else', sql("UPDATE sessions SET user_id='customer'"));
  await scenario('availability heartbeat stale at boundary', sql('UPDATE driver_availability SET seen_at=?', now - 60_000));
  await scenario('availability ended', sql("UPDATE driver_availability SET active=0,position_json=NULL,area_id=NULL,session_hash=NULL,client_hash=NULL,stopped_at=?,reason='offline'", now));
  await scenario('request expired at boundary', sql('UPDATE rides SET request_expires_at=?', now));
  await scenario('cancelled request', sql("UPDATE rides SET status='cancelled'"));
  await scenario('self matching rejected', sql("UPDATE rides SET customer_id='driver'"));
  await scenario('vehicle category mismatch', sql("UPDATE rides SET vehicle_category='suv'"));
  const native = async () => db.prepare("UPDATE driver_availability SET native_session_id='native'").run();
  await scenario('native access token rotation/expiry does not end session family', native, true);
  await scenario('native session revoked', async () => { await native(); await db.prepare('UPDATE device_sessions SET revoked_at=?').run(now); });
  await scenario('native session idle boundary', async () => { await native(); await db.prepare('UPDATE device_sessions SET idle_expires_at=?').run(now); });
  await scenario('native session absolute boundary', async () => { await native(); await db.prepare('UPDATE device_sessions SET expires_at=?').run(now); });
  await scenario('native session owner mismatch', async () => { await native(); await db.prepare("UPDATE device_sessions SET user_id='customer'").run(); });
  await scenario('native session customer capability revoked', async () => { await native(); await db.prepare("DELETE FROM account_capabilities WHERE user_id='driver' AND capability='customer'").run(); });
  const work = async (status, customerId, driverId) => db.prepare("INSERT INTO rides(id,customer_id,driver_id,pickup_id,destination_id,suggested_fare_kobo,status,created_at,updated_at,request_expires_at,matched_at) VALUES('work',?,?,'wuse-ii','maitama',50000,?,?,?,?,?)")
    .run(customerId === 'customer' ? 'other' : customerId, driverId ?? (status === 'agreed' ? 'customer' : null), status, now, now, now + 300_000, status === 'requested' ? null : now);
  await scenario('another negotiation blocks work', () => work('negotiating', 'customer', 'driver'));
  await scenario('personal request blocks work', () => work('requested', 'driver', null));
  await scenario('expired personal request does not block', async () => { await work('requested', 'driver', null); await db.prepare("UPDATE rides SET request_expires_at=? WHERE id='work'").run(now); }, true);
  await scenario('personal agreed ride without trip blocks work', () => work('agreed', 'driver', null));
  await scenario('active ride or courier trip blocks work', async () => {
    await work('agreed', 'customer', 'driver');
    await db.prepare("INSERT INTO ride_trips(ride_id,customer_id,driver_id,status,fare_kobo,booked_at,pickup_pin) VALUES('work','other','driver','booked',50000,?,'123456')").run(now);
  });
  await scenario('completed ride permits more work', async () => {
    await work('agreed', 'customer', 'driver');
    await db.prepare("INSERT INTO ride_trips(ride_id,customer_id,driver_id,status,fare_kobo,booked_at,departed_at,arrived_at,started_at,completed_at) VALUES('work','other','driver','completed',50000,?,?,?,?,?)").run(now, now, now, now, now);
  }, true);
  await scenario('Eats assignment blocks ride matching', async () => {
    await db.prepare("INSERT INTO eats_stores(id,status,details_json,created_at,updated_at) VALUES('store','approved','{}',?,?)").run(now, now);
    await db.prepare("INSERT INTO eats_orders(id,store_id,customer_id,courier_id,status,snapshot_json,events_json,created_at,updated_at) VALUES('food','store','customer','driver','assigned','{}','[]',?,?)").run(now, now);
  });
  const delivery = () => db.prepare("INSERT INTO delivery_orders(ride_id,details_json) VALUES('ride',?)").run(JSON.stringify({ weightKg: 2 }));
  await scenario('standard vehicle accepts eligible parcel', delivery, true);
  await scenario('claimed parcel recipient cannot be driver even after invitation expiry', async () => {
    await delivery();
    await db.prepare("INSERT INTO parcel_tracking_links(id,ride_id,owner_id,token_hash,recipient_id,claimed_at,created_at,expires_at) VALUES('parcel','ride','customer','parcel-token','driver',?,?,?)")
      .run(now - 2000, now - 2000, now - 1000);
  });
  const gps = async (capturedAt = now, lat = 9.08) => {
    const point = { lat, lng: 7.4, capturedAt };
    await db.prepare("UPDATE driver_availability SET mode='gps',area_id=NULL,position_json=?,latitude=?,longitude=?").run(JSON.stringify(point), point.lat, point.lng);
    await db.prepare("INSERT INTO location_quotes(id,customer_id,created_at,expires_at,route_json,ride_id) VALUES('quote','customer',?,?,?,'ride')")
      .run(now, now + 60_000, JSON.stringify({ pickup: { lat: 9.081, lng: 7.4 }, destination: { lat: 9.09, lng: 7.4 } }));
  };
  await scenario('fresh nearby GPS driver eligible', () => gps(), true);
  await scenario('GPS freshness boundary enforced', () => gps(now - 30_000));
  await scenario('GPS radius enforced', () => gps(now, 10));
  await scenario('GPS cannot match sample request', async () => { await gps(); await db.prepare('DELETE FROM location_quotes').run(); });
  await t.test('batch read count stays bounded; commit never reuses discovery', async () => {
    f.resetOperations();
    const result = await f.fast.dispatchCandidatesFor(Array.from({ length: 512 }, () => f.edge), now);
    assert.equal(result.size, 1);
    assert.equal(f.operations(), 3, 'one ride query and two eligibility queries, independent of duplicate edge count');
    f.resetOperations();
    await f.matching.drivers(['driver', ...Array.from({ length: 450 }, (_, i) => `missing${i}`)], now);
    assert.equal(f.operations(), 6, 'unique driver inputs chunk into at most 200 IDs per query');
  });
  await scenario('fresh commit sees revocation after discovery', async () => {
    assert.equal((await f.fast.dispatchCandidates(now, { region: 'sample:wuse-ii' })).length, 1);
    await db.prepare("UPDATE drivers SET status='pending' WHERE user_id='driver'").run();
  });
  await t.test('application composition publishes a fast-path sample offer and claims it through existing checks', async () => {
    await assert.rejects(db.transaction(async () => {
      const app = createApplication({ db, clock: () => now, allowSimulation: true,
        matchingFast: readMatchingFastConfig({ TAXI_AI_MATCHING_FAST_PATH: 'true' }), dispatchConfig: { mode: 'sequential' } });
      await app.dispatch.refresh({ region: 'sample:wuse-ii' });
      const offer = await createDispatchRepository(db).forDriver('driver');
      assert.equal(offer?.rideId, 'ride');
      const result = await app.rides.mutate({ userId: 'driver', key: randomUUID(), action: 'claim', id: 'ride',
        data: { expectedVersion: 0, offerId: offer.id } });
      assert.equal(result.ride.status, 'negotiating');
      assert.equal((await createDispatchRepository(db).find(offer.id)).status, 'accepted');
      throw rolledBack;
    }), error => error === rolledBack);
  });
  await t.test('fast-path application rechecks approval after routing before committing an offer', async () => {
    await assert.rejects(db.transaction(async () => {
      await gps();
      let routed = false;
      const mapProvider = { mode: 'dedicated', async pickupEstimates() {
        routed = true;
        await db.prepare("UPDATE drivers SET status='pending' WHERE user_id='driver'").run();
        return [];
      } };
      const app = createApplication({ db, clock: () => now, allowSimulation: true, mapProvider,
        matchingFast: readMatchingFastConfig({ TAXI_AI_MATCHING_FAST_PATH: 'true' }), dispatchConfig: { mode: 'sequential' } });
      await app.dispatch.refresh({ region: 'sample:wuse-ii' });
      assert.equal(routed, true);
      assert.equal(await createDispatchRepository(db).forDriver('driver'), null);
      throw rolledBack;
    }), error => error === rolledBack);
  });
  await t.test('attempt batches preserve pair identity and bound history reads', async () => {
    await createDispatchRepository(db).insert({ id: 'offer', rideId: 'ride', driverId: 'driver', availabilityId: 'availability', mode: 'sequential',
      policyVersion: 'test', etaSource: 'sample', pickupEtaSeconds: null, estimatedAt: null, createdAt: now, expiresAt: now + 20_000 });
    const tried = await f.matching.attemptedMany([f.edge, { rideId: 'other', driverId: 'driver' }]);
    assert.deepEqual([...tried], [f.key]);
    assert.deepEqual(await f.fast.dispatchCandidates(now, { region: 'sample:wuse-ii' }), []);
  });
}
