import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { openPostgresDatabase } from '../src/infrastructure/postgres.mjs';
import { createApplication } from '../src/application.mjs';
import { createCallConfig } from '../src/infrastructure/call-config.mjs';
import { createMapProvider } from '../src/infrastructure/map-provider.mjs';

const connectionString = process.env.TAXI_AI_TEST_POSTGRES_URL;
const serialOnly = process.env.TAXI_AI_TEST_POSTGRES_SERIAL_ONLY === '1';
const paired = async action => serialOnly ? [await action(0), await action(1)] : Promise.all([0, 1].map(action));

test('PostgreSQL finance, compliance and demand keep exact projections and durable scoped commands across pools', {
  skip: !connectionString && 'Set TAXI_AI_TEST_POSTGRES_URL to an isolated PostgreSQL/PostGIS test database.', timeout: 120000,
}, async t => {
  if (serialOnly) t.diagnostic('Embedded PostgreSQL compatibility mode serializes commands; production contention is not tested.');
  const schema = `test_expansion_${randomUUID().replaceAll('-', '')}`;
  const control = await openPostgresDatabase({ connectionString, schema, max: 1, migrate: true });
  const pools = [], apps = [], now = Date.UTC(2026, 0, 1, 12);
  try {
    for (let index = 0; index < 2; index++) {
      const db = await openPostgresDatabase({ connectionString, schema, max: serialOnly ? 1 : 2 });
      pools.push(db); apps.push(createApplication({ db, clock: () => now, allowSimulation: true,
        callConfig: createCallConfig({ TAXI_AI_CALLS_MODE: 'off' }),
        mapProvider: createMapProvider({ env: { TAXI_AI_MAPS_MODE: 'off' } }), dispatchConfig: { mode: 'legacy' } }));
    }
    const owner = randomUUID(), finance = randomUUID(), operations = randomUUID(), customer = randomUUID(), driver = randomUUID();
    for (const [id, name, role] of [[owner, 'Owner', 'admin'], [finance, 'Finance', 'customer'], [operations, 'Operations', 'customer'],
      [customer, 'PrivatePassenger', 'customer'], [driver, 'PrivateDriver', 'driver']]) {
      await control.prepare('INSERT INTO users(id,email,name,password_hash,role,created_at) VALUES (?,?,?,?,?,?)')
        .run(id, name.toLowerCase() + '@expansion-pg.example.test', name, 'fictional-non-login-hash', role, now);
    }
    for (const role of ['finance', 'operations']) await apps[0].staffAccess.command({ userId: owner, action: 'assign', key: randomUUID(),
      data: { email: role + '@expansion-pg.example.test', role, expectedVersion: 0, reason: 'Fictional reporting assignment.' } });
    await control.prepare("INSERT INTO drivers(user_id,status,vehicle_model,vehicle_plate) VALUES (?,'approved','Test car','TEST-PG')").run(driver);
    await control.prepare("INSERT INTO driver_applications(driver_id,status,details_json,verification_json,updated_at) VALUES (?,'approved',?,'{}',?)")
      .run(driver, JSON.stringify({ vehicle: { category: 'standard' } }), now);
    await control.prepare("INSERT INTO account_capabilities(user_id,capability,created_at) VALUES (?,'driver',?)").run(driver, now);
    for (const kind of ['profile_photo', 'driving_licence', 'vehicle_registration', 'insurance', 'vehicle_photo']) {
      await control.prepare(`INSERT INTO driver_documents(id,driver_id,kind,name,mime_type,size_bytes,sha256,expires_on,content,created_at)
        VALUES (?,?,?,'test','image/png',1,'test',?,?,?)`).run(randomUUID(), driver, kind,
        kind === 'insurance' ? '2026-01-01' : kind.endsWith('photo') ? null : '2027-01-01', Buffer.from([0]), now);
    }
    const sessionHash = 'expansion-pg-session';
    await control.prepare('INSERT INTO sessions(token_hash,user_id,csrf_token,expires_at) VALUES (?,?,?,?)').run(sessionHash, driver, 'test', now + 60000);
    await control.prepare(`INSERT INTO driver_availability(id,driver_id,active,mode,position_json,session_hash,client_hash,sequence,started_at,seen_at,expires_at,latitude,longitude)
      VALUES (?,?,1,'gps',?,?,'test',1,?,?,?,?,?)`).run(randomUUID(), driver,
      JSON.stringify({ lat: 9.08, lng: 7.41, capturedAt: now, accuracy: 10 }), sessionHash, now, now, now + 30000, 9.08, 7.41);
    const rideIds = [];
    for (let i = 0; i < 2; i++) {
      const id = randomUUID(); rideIds.push(id);
      await control.prepare(`INSERT INTO rides(id,customer_id,driver_id,pickup_id,destination_id,suggested_fare_kobo,status,created_at,updated_at,matched_at,dispatch_region)
        VALUES (?,?,?,'wuse-ii','maitama',?,'agreed',?,?,?,'ng:181:148')`).run(id, customer, driver, Number.MAX_SAFE_INTEGER, now - 60000, now, now - 30000);
      await control.prepare(`INSERT INTO ride_trips(ride_id,customer_id,driver_id,status,fare_kobo,booked_at,departed_at,arrived_at,started_at,completed_at)
        VALUES (?,?,?,'completed',?,?,?,?,?,?)`).run(id, customer, driver, Number.MAX_SAFE_INTEGER, now - 30000, now - 25000, now - 20000, now - 15000, now);
      await control.prepare('INSERT INTO payments(ride_id,customer_id,driver_id,amount_kobo,completed_at,updated_at) VALUES (?,?,?,?,?,?)')
        .run(id, customer, driver, Number.MAX_SAFE_INTEGER, now, now);
    }
    const first = await apps[0].adminFinance.get({ id: finance }, { from: '2026-01-01', to: '2026-01-01', limit: '1' });
    assert.equal(first.summary.grossFareKobo, (2n * BigInt(Number.MAX_SAFE_INTEGER)).toString());
    assert.equal(first.summary.completedTrips, 2); assert.equal(first.payments.length, 1); assert.ok(first.page.next);
    const next = await apps[1].adminFinance.get({ id: finance }, { from: '2026-01-01', to: '2026-01-01', limit: '1', before: first.page.next });
    assert.equal(next.payments.length, 1); assert.equal(next.page.next, null);
    assert.equal(new Set([first.payments[0].rideId, next.payments[0].rideId]).size, 2);
    assert.deepEqual(next.summary, first.summary);
    const financeDetail = await apps[1].adminFinance.detail({ id: finance }, rideIds[0]);
    assert.deepEqual(financeDetail.attempts, []);
    for (const value of [customer, driver, 'PrivatePassenger', 'PrivateDriver', 'wuse-ii', 'maitama']) {
      assert.ok(!JSON.stringify({ first, financeDetail }).includes(value), value);
    }
    await assert.rejects(apps[0].adminFinance.get({ id: operations }), { code: 'FORBIDDEN' });
    const list = await apps[0].adminCompliance.list(operations, { queue: 'expiring' });
    assert.equal(list.drivers.length, 1); assert.equal(list.drivers[0].eligibility.validUntil, Date.UTC(2026, 0, 1, 23));
    const command = { userId: operations, id: driver, action: 'follow-up', key: randomUUID(),
      data: { expectedVersion: 0, dueAt: now + 3600000, note: 'Fictional PostgreSQL renewal follow-up.' } };
    const replies = await paired(index => apps[index].adminCompliance.command(command));
    assert.deepEqual(replies.map(result => result.replayed).sort(), [false, true]);
    assert.equal((await apps[1].adminCompliance.get(operations, driver)).events.length, 1);
    await assert.rejects(apps[0].adminCompliance.command({ ...command, key: randomUUID() }), { code: 'STALE_VERSION' });
    await assert.rejects(apps[0].adminCompliance.get(finance, driver), { code: 'FORBIDDEN' });
    const demand = await apps[1].adminDemand.get({ id: operations }, { from: '2026-01-01', to: '2026-01-01' });
    assert.equal(demand.totals.requests, 2); assert.equal(demand.totals.matched, 2); assert.equal(demand.totals.completed, 2);
    assert.equal(demand.totals.meanMatchSeconds, 30); assert.equal(demand.supply.availableDrivers, 1);
    assert.equal(demand.daily.find(row => row.date === '2026-01-01').requests, 2);
    assert.equal(demand.hours.find(row => row.hour === 12).requests, 2, '11:59 UTC belongs to the 12:00 WAT hour');
    assert.equal(demand.areas.items[0].region.key, 'ng:181:148');
    const serialized = JSON.stringify(demand);
    for (const value of [customer, driver, ...rideIds, 'latitude', 'longitude', 'PrivatePassenger', 'PrivateDriver']) assert.ok(!serialized.includes(value), value);
    const member = await control.prepare('SELECT version FROM staff_memberships WHERE user_id=?').get(operations);
    await apps[0].staffAccess.command({ userId: owner, action: 'revoke', key: randomUUID(),
      data: { userId: operations, expectedVersion: member.version, reason: 'Fictional assignment ended.' } });
    await assert.rejects(apps[1].adminDemand.get({ id: operations }), { code: 'FORBIDDEN' });
    await assert.rejects(apps[1].adminCompliance.command(command), { code: 'FORBIDDEN' });
    assert.equal((await control.prepare('SELECT count(*) AS n FROM admin_compliance_events').get()).n, 1);
  } finally {
    for (const app of apps) await app.realtime.close();
    for (const db of pools) await db.close();
    try { await control.exec(`DROP SCHEMA ${schema} CASCADE`); } finally { await control.close(); }
  }
});
