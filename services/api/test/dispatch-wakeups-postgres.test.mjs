import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { openPostgresDatabase } from '../src/infrastructure/postgres.mjs';
import { dispatchWakeupChannel } from '../src/infrastructure/dispatch-wakeups.mjs';

const connectionString = process.env.TAXI_AI_TEST_POSTGRES_URL;
async function until(predicate) {
  const deadline = Date.now() + 5000;
  while (!predicate()) { if (Date.now() >= deadline) assert.fail('PostgreSQL wakeup was not delivered.'); await delay(10); }
}

test('native PostgreSQL wakeups are commit-bound, schema-isolated, and opt-in', { skip: !connectionString, timeout: 30000 }, async () => {
  const schema = `test_wakeup_${randomUUID().replaceAll('-', '')}`;
  const db = await openPostgresDatabase({ connectionString, schema, max: 1, migrate: true, matchingFast: { enabled: true } });
  let disabled, listener;
  const hints = []; let ready = false;
  try {
    disabled = await openPostgresDatabase({ connectionString, schema, max: 1, matchingFast: { enabled: false } });
    listener = db.subscribeDispatchWakeups({ onHint: (hint) => hints.push(hint), onReconnect: () => { ready = true; } });
    await until(() => ready);
    const now = Date.now();
    for (const id of ['customer-1', 'customer-2', 'customer-3', 'driver-1'])
      await db.prepare('INSERT INTO users(id,email,name,password_hash,role,created_at) VALUES(?,?,?,?,?,?)')
        .run(id, `${id}@example.test`, 'Synthetic wakeup fixture', 'unused', id.startsWith('driver') ? 'driver' : 'customer', now);
    await db.prepare('INSERT INTO drivers(user_id,vehicle_model,vehicle_plate) VALUES(?,?,?)').run('driver-1', 'Test', 'TEST-1');
    const insertRide = (target, id, customerId, region) => target.prepare(`INSERT INTO rides
      (id,customer_id,pickup_id,destination_id,suggested_fare_kobo,created_at,updated_at,request_expires_at,dispatch_region)
      VALUES(?,?,'wuse-ii','maitama',50000,?,?,?,?)`).run(id, customerId, now, now, now + 60000, region);
    await db.transaction(async () => {
      await insertRide(db, 'ride-1', 'customer-1', 'ng:181:148');
      assert.equal(hints.length, 0, 'trigger notification cannot precede commit');
    });
    await until(() => hints.some((hint) => hint.region === 'ng:181:148'));
    await assert.rejects(db.transaction(async () => {
      await insertRide(db, 'rollback', 'customer-2', 'sample:rollback'); throw new Error('rollback');
    }), /rollback/);
    await insertRide(disabled, 'disabled', 'customer-3', 'sample:disabled');
    await db.prepare(`INSERT INTO driver_availability(id,driver_id,active,mode,area_id,session_hash,client_hash,sequence,started_at,seen_at,expires_at)
      VALUES('availability','driver-1',1,'sample','wuse-ii','session','client',1,?,?,?)`).run(now, now, now + 60000);
    await until(() => hints.some((hint) => hint.type === 'availability'));
    assert.deepEqual(hints.find((hint) => hint.type === 'availability'), { type: 'availability', region: 'sample:wuse-ii' });
    await db.query('SELECT pg_notify($1,$2)', [dispatchWakeupChannel(`${schema}_other`), JSON.stringify({ type: 'ride', region: 'sample:other-schema' })]);
    // Same pooled connection emits a marker after every prior transaction, so
    // seeing it establishes delivery order without a timing-based absence check.
    await db.query('SELECT pg_notify($1,$2)', [dispatchWakeupChannel(schema), JSON.stringify({ type: 'ride', region: 'sample:marker' })]);
    await until(() => hints.some((hint) => hint.region === 'sample:marker'));
    assert.equal(hints.some((hint) => ['sample:rollback', 'sample:disabled', 'sample:other-schema'].includes(hint.region)), false);
    assert.deepEqual(await db.activeDispatchRegions(['ng:181:148', 'sample:missing'], now), ['ng:181:148']);
    assert.deepEqual(await db.activeDispatchRegions(['ng:181:148'], now + 60001), []);
    await db.prepare(`INSERT INTO dispatch_offers
      (id,ride_id,driver_id,availability_id,status,mode,policy_version,eta_source,pickup_eta_seconds,estimated_at,created_at,expires_at)
      VALUES('offer','ride-1','driver-1','availability','pending','sequential','test','distance_fallback',NULL,NULL,?,?)`)
      .run(now, now + 20000);
    assert.deepEqual(await db.activeDispatchRegions(['ng:181:148'], now + 60001), ['ng:181:148'],
      'pending offers still wake the region so dispatch can expire/close them');
    assert.deepEqual(await db.activeDispatchRegions([], now), []);
    await assert.rejects(db.activeDispatchRegions(Array(513).fill('ng:181:148')), /bound/);
  } finally {
    await listener?.stop(); await disabled?.close();
    await db.query(`DROP SCHEMA "${schema}" CASCADE`); await db.close();
  }
});
