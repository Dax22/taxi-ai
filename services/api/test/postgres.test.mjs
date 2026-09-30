import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { openPostgresDatabase, migratePostgres } from '../src/infrastructure/postgres.mjs';
import { floorIntegerSql } from '../src/shared/sql-floor.mjs';
import { createAvailabilityRepository } from '../src/modules/availability/repository.mjs';
import { createWorkerCoordinationRepository } from '../src/modules/worker-coordination/repository.mjs';

const connectionString = process.env.TAXI_AI_TEST_POSTGRES_URL;
test('PostgreSQL/PostGIS storage: migrations, domain SQL, scoped triggers, geo index and transactions', { skip: !connectionString }, async () => {
  const schema = `test_${randomUUID().replaceAll('-', '')}`;
  const db = await openPostgresDatabase({ connectionString, schema, max: 1, migrate: true });
  try {
    assert.equal(await db.healthy(), true);
    const bucket = db.prepare(`SELECT ${floorIntegerSql('value')} AS cell FROM (SELECT CAST(? AS double precision) AS value) fixture`);
    for (const value of [-1.9, -1.1, -0.1, 0, 0.1, 1.1, 1.9, 181.6, 746.23]) assert.equal((await bucket.get(value)).cell, Math.floor(value));
    assert.equal((await bucket.get(null)).cell, null);
    await migratePostgres(db); // Re-running deploy migrations is idempotent.
    const now = Date.now();
    for (const [id, role] of [['customer', 'customer'], ['driver', 'driver']]) await db.prepare('INSERT INTO users(id,email,name,password_hash,role,created_at) VALUES(?,?,?,?,?,?)').run(id, `${id}@example.test`, id, 'unused-test-hash', role, now);
    assert.equal((await db.prepare('SELECT id,created_at AS createdAt FROM users WHERE email=?').get('CUSTOMER@example.test')).createdAt, now);
    await db.prepare('INSERT INTO drivers(user_id,vehicle_model,vehicle_plate) VALUES(?,?,?)').run('driver', 'Test car', 'TEST-1');
    await db.prepare("INSERT INTO rides(id,customer_id,pickup_id,destination_id,suggested_fare_kobo,created_at,updated_at) VALUES(?,?,'wuse','maitama',50000,?,?)").run('ride', 'customer', now, now);
    const notification = await db.prepare("INSERT OR IGNORE INTO account_notifications(user_id,ride_id,kind,mode,event_key,created_at) VALUES(?,?,'request','customer','test',?)").run('customer', 'ride', now);
    assert.equal(notification.changes, 1); assert.equal(typeof notification.lastInsertRowid, 'number');
    const duplicate = await db.prepare("INSERT OR IGNORE INTO account_notifications(user_id,ride_id,kind,mode,event_key,created_at) VALUES(?,?,'request','customer','test',?)").run('customer', 'ride', now);
    assert.equal(duplicate.changes, 0);
    const revision = await db.prepare('SELECT revision FROM account_revisions WHERE user_id=?').get('customer');
    assert.ok(revision.revision >= 2);
    assert.equal(await db.prepare('SELECT revision FROM account_revisions WHERE user_id=?').get('driver'), undefined);
    await assert.rejects(db.transaction(async () => {
      await db.prepare("UPDATE users SET name='rollback' WHERE id=?").run('customer');
      throw new Error('rollback requested');
    }), /rollback requested/);
    assert.equal((await db.prepare('SELECT name FROM users WHERE id=?').get('customer')).name, 'customer');
    await db.transaction(async () => {
      await db.prepare("UPDATE users SET name='committed' WHERE id=?").run('customer');
      await assert.rejects(db.transaction(async () => { await db.prepare("UPDATE users SET name='nested' WHERE id=?").run('customer'); throw new Error('nested rollback'); }), /nested rollback/);
    });
    assert.equal((await db.prepare('SELECT name FROM users WHERE id=?').get('customer')).name, 'committed');
    let releaseDetached, detached, detachedFinished = false;
    const gate = new Promise((resolve) => { releaseDetached = resolve; });
    await db.transaction(async () => {
      detached = gate.then(() => db.prepare('SELECT name FROM users WHERE id=?').get('customer')).then((row) => { detachedFinished = true; return row; });
    });
    await db.transaction(async () => {
      await db.prepare("UPDATE users SET name='second transaction' WHERE id=?").run('customer');
      releaseDetached();
      await new Promise((resolve) => setTimeout(resolve, 20));
      assert.equal(detachedFinished, false, 'detached work cannot reuse a released connection now owned by another transaction');
    });
    assert.equal((await detached).name, 'second transaction');
    const position = { lat: 9.0765, lng: 7.3986, capturedAt: now, accuracyMeters: 10 };
    await db.prepare(`INSERT INTO driver_availability(id,driver_id,active,mode,position_json,session_hash,client_hash,sequence,started_at,seen_at,expires_at,latitude,longitude)
      VALUES(?,?,1,'gps',?,?,'browser',1,?,?,?,?,?)`).run('availability', 'driver', JSON.stringify(position), 'session', now, now, now + 30000, position.lat, position.lng);
    const near = await db.prepare("SELECT id FROM driver_availability WHERE active=1 AND mode='gps' AND ST_DWithin(location,ST_SetSRID(ST_MakePoint(?,?),4326)::geography,?)").all(7.3987, 9.0766, 1000);
    assert.equal(near.length, 1);
    const availability = createAvailabilityRepository(db);
    const search = { mode: 'gps', position, radiusMeters: 1000, now };
    assert.equal((await availability.nearby(search))[0].driverId, 'driver');
    await db.prepare(`INSERT INTO dispatch_offers(id,ride_id,driver_id,availability_id,status,mode,policy_version,eta_source,created_at,expires_at)
      VALUES(?,?,?,?,'pending','sequential','test','distance_fallback',?,?)`).run('offer', 'ride', 'driver', 'availability', now, now + 20000);
    assert.deepEqual(await availability.nearby(search), [], 'an active offer excludes its driver before the candidate limit');
    await db.prepare("UPDATE dispatch_offers SET status='declined',closed_at=? WHERE id='offer'").run(now + 1);
    assert.equal((await availability.nearby(search)).length, 1);
    assert.equal((await db.prepare('SELECT id FROM driver_availability WHERE ST_DWithin(location,ST_SetSRID(ST_MakePoint(?,?),4326)::geography,?)').all(3.3792, 6.5244, 1000)).length, 0);
    const plans = await db.transaction(async () => { await db.exec('SET LOCAL enable_seqscan=off'); return db.query("EXPLAIN SELECT id FROM driver_availability WHERE active=1 AND mode='gps' AND ST_DWithin(location,ST_SetSRID(ST_MakePoint(7.3987,9.0766),4326)::geography,1000)"); });
    // A one-row test table may legitimately use a smaller B-tree index. Verify
    // the spatial access path exists without prescribing the planner's cost choice.
    assert.match(JSON.stringify(plans.rows), /Index Scan|Bitmap/);
    const spatialIndex = await db.query("SELECT indexdef FROM pg_indexes WHERE schemaname=$1 AND indexname='availability_gps_location'", [schema]);
    assert.match(spatialIndex.rows[0].indexdef, /USING gist \(location\)/);
    await db.prepare("UPDATE driver_availability SET active=0,area_id=NULL,position_json=NULL,session_hash=NULL,client_hash=NULL,stopped_at=?,reason='offline',latitude=NULL,longitude=NULL,expires_at=NULL WHERE id=?").run(now, 'availability');
    assert.equal((await db.query("SELECT location IS NULL AS cleared FROM driver_availability WHERE id='availability'")).rows[0].cleared, true);
    const json = await db.prepare("SELECT json_extract(?,'$.enabled') AS enabled,json_extract(?,'$.amountKobo') AS amountKobo,json_object('lat',CAST(? AS double precision),'lng',CAST(? AS double precision)) AS point").get('{"enabled":true}', '{"amountKobo":50000}', 9.1, 7.2);
    assert.equal(json.enabled, 'true'); assert.equal(json.amountKobo, 50000); assert.deepEqual(JSON.parse(json.point), { lat: 9.1, lng: 7.2 });
    const leases = createWorkerCoordinationRepository(db), clock = await leases.now();
    const lease = await leases.acquire('dispatch:test', 'worker-a', clock, clock + 1000);
    assert.equal(lease.ownerId, 'worker-a');
    assert.equal(await leases.acquire('dispatch:test', 'worker-b', clock, clock + 1000), undefined);
    const successor = await leases.acquire('dispatch:test', 'worker-b', clock + 1001, clock + 3000);
    assert.equal(successor.token, lease.token + 1);
    assert.equal(await db.transaction(() => leases.guard(lease, clock + 1002)), false);
    assert.equal(await db.transaction(() => leases.guard(successor, clock + 1002)), true);
    assert.equal(await leases.release(lease), false);
  } finally {
    await db.exec(`DROP SCHEMA "${schema}" CASCADE`);
    await db.close();
  }
});
