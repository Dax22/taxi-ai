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

test('PostgreSQL staff membership, case idempotency and revocation agree across independent application pools', {
  skip: !connectionString && 'Set TAXI_AI_TEST_POSTGRES_URL to an isolated PostgreSQL/PostGIS test database.', timeout: 120000,
}, async t => {
  if (serialOnly) t.diagnostic('Embedded PostgreSQL compatibility mode serializes commands; production contention is not tested.');
  const schema = `test_admin_${randomUUID().replaceAll('-', '')}`;
  const control = await openPostgresDatabase({ connectionString, schema, max: 1, migrate: true });
  const pools = [], apps = [];
  const now = Date.UTC(2026, 8, 25, 12);
  try {
    for (let index = 0; index < 2; index++) {
      const db = await openPostgresDatabase({ connectionString, schema, max: serialOnly ? 1 : 2 });
      pools.push(db); apps.push(createApplication({ db, clock: () => now, allowSimulation: true,
        callConfig: createCallConfig({ TAXI_AI_CALLS_MODE: 'off' }),
        mapProvider: createMapProvider({ env: { TAXI_AI_MAPS_MODE: 'off' } }), dispatchConfig: { mode: 'legacy' } }));
    }
    const owner = randomUUID(), support = randomUUID(), customer = randomUUID(), rideId = randomUUID();
    for (const [id, name, role] of [[owner, 'Owner', 'admin'], [support, 'Support', 'customer'], [customer, 'Passenger', 'customer']]) {
      await control.prepare('INSERT INTO users(id,email,name,password_hash,role,created_at) VALUES (?,?,?,?,?,?)')
        .run(id, `${name.toLowerCase()}@admin-pg.example.test`, name, 'fictional-non-login-hash', role, now);
    }
    await control.prepare(`INSERT INTO rides(id,customer_id,pickup_id,destination_id,suggested_fare_kobo,status,version,created_at,updated_at,dispatch_region)
      VALUES (?,?,?,?,?,'requested',0,?,?,?)`).run(rideId, customer, 'wuse-ii', 'maitama', 450000, now, now, 'sample:wuse-ii');
    const grant = { userId: owner, action: 'assign', key: randomUUID(), data: {
      email: 'support@admin-pg.example.test', role: 'support', expectedVersion: 0, reason: 'Fictional PostgreSQL support assignment.',
    } };
    const grants = await paired(index => apps[index].staffAccess.command(grant));
    assert.deepEqual(grants.map(result => result.replayed).sort(), [false, true]);
    assert.equal((await apps[1].staffAccess.requirePermission(support, 'cases.support')).role, 'support');
    await assert.rejects(apps[0].staffAccess.requirePermission(support, 'cases.safety'), { code: 'FORBIDDEN' });
    assert.equal((await control.prepare('SELECT role FROM users WHERE id=?').get(support)).role, 'customer');
    const creation = { userId: support, action: 'create', key: randomUUID(), data: { category: 'support', rideId,
      subject: 'Fictional PostgreSQL support case', description: 'A fictional request confirms durable case behavior.', priority: 'normal' } };
    const cases = await paired(index => apps[index].adminCases.command(creation));
    assert.deepEqual(cases.map(result => result.replayed).sort(), [false, true]);
    assert.equal(cases[0].case.id, cases[1].case.id);
    const item = (await apps[1].adminCases.get(support, cases[0].case.id)).case;
    const note = { userId: support, action: 'note', id: item.id, key: randomUUID(),
      data: { expectedVersion: item.version, body: 'One note across both application instances.' } };
    const notes = await paired(index => apps[index].adminCases.command(note));
    assert.deepEqual(notes.map(result => result.replayed).sort(), [false, true]);
    const detail = await apps[0].adminCases.get(support, item.id);
    assert.equal(detail.events.filter(event => event.action === 'note').length, 1);
    assert.ok(!JSON.stringify(detail).includes('pickupPin'));
    await assert.rejects(apps[1].adminCases.command({ ...note, key: randomUUID(), data: { ...note.data, body: 'Stale command must not win.' } }), { code: 'STALE_VERSION' });
    const member = await control.prepare('SELECT version FROM staff_memberships WHERE user_id=?').get(support);
    await apps[0].staffAccess.command({ userId: owner, action: 'revoke', key: randomUUID(),
      data: { userId: support, expectedVersion: member.version, reason: 'Fictional assignment has ended.' } });
    await assert.rejects(apps[1].adminCases.get(support, item.id), { code: 'FORBIDDEN' });
    await assert.rejects(apps[1].adminCases.command(note), { code: 'FORBIDDEN' });
    assert.equal((await control.prepare('SELECT count(*) AS count FROM admin_cases').get()).count, 1);
    assert.equal((await control.prepare('SELECT count(*) AS count FROM admin_case_commands').get()).count, 2);
  } finally {
    for (const app of apps) await app.realtime.close();
    for (const db of pools) await db.close();
    try { await control.exec(`DROP SCHEMA ${schema} CASCADE`); } finally { await control.close(); }
  }
});
