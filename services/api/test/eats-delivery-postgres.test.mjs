import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { openPostgresDatabase, migratePostgres } from '../src/infrastructure/postgres.mjs';
import { createEatsRepository } from '../src/modules/eats/repository.mjs';
import { createEatsService } from '../src/modules/eats/service.mjs';

const connectionString = process.env.TAXI_AI_TEST_POSTGRES_URL;
const address = { line: '20 Fictional Close, house 2, blue gate', areaId: 'maitama', point: { lat: 9.09, lng: 7.49 } };
test('PostgreSQL delivery profiles migrate additively and serialize independent API writes and idempotent retries', { skip: !connectionString }, async () => {
  const schema = `test_eats_delivery_${randomUUID().replaceAll('-', '')}`;
  const control = await openPostgresDatabase({ connectionString, schema, max: 2, migrate: true });
  let second;
  try {
    const users = [{ id: randomUUID(), role: 'customer', capabilities: ['customer'], name: 'Customer A' }, { id: randomUUID(), role: 'customer', capabilities: ['customer'], name: 'Customer B' }];
    for (const user of users) await control.prepare('INSERT INTO users(id,email,name,password_hash,role,created_at) VALUES(?,?,?,?,?,?)').run(user.id, `${user.id}@example.test`, user.name, 'unused', user.role, Date.now());
    await control.exec('DROP TABLE eats_delivery_profiles; DELETE FROM taxi_schema_migrations WHERE version=16');
    await migratePostgres(control);
    assert.equal((await control.prepare('SELECT count(*) AS n FROM users').get()).n, 2);
    second = await openPostgresDatabase({ connectionString, schema, max: 2 });
    const service = db => createEatsService({ repository: createEatsRepository(db, { deliveryAreas: () => [], legacyAreaIds: [], distanceMeters: () => 0 }),
      getAccount: async id => users.find(user => user.id === id), unitOfWork: work => db.transaction(work), clock: Date.now,
      audit: { record: async () => {} }, tokens: { digest: text => createHash('sha256').update(text).digest('hex') } });
    const a = service(control), b = service(second), user = users[0];
    assert.deepEqual((await a.deliveryProfile(user)).deliveryProfile, { version: 0, addresses: { home: null, work: null } });
    const request = { expectedVersion: 0, label: 'home', address }, key = randomUUID();
    const retry = await Promise.all([a.saveDeliveryProfile(user, request, key, async () => user), b.saveDeliveryProfile(user, request, key, async () => user)]);
    assert.ok(retry.some(result => result.replayed)); assert.ok(retry.every(result => result.deliveryProfile.version === 1));
    const edits = await Promise.allSettled([
      a.saveDeliveryProfile(user, { expectedVersion: 1, label: 'home', address: null }, randomUUID(), async () => user),
      b.saveDeliveryProfile(user, { expectedVersion: 1, label: 'work', address }, randomUUID(), async () => user),
    ]);
    assert.equal(edits.filter(result => result.status === 'fulfilled').length, 1);
    assert.equal(edits.find(result => result.status === 'rejected').reason.code, 'STALE_VERSION');
    const current = (await a.deliveryProfile(user)).deliveryProfile; assert.equal(current.version, 2);
    assert.deepEqual((await b.saveDeliveryProfile(user, request, key, async () => user)).deliveryProfile, current);
    assert.deepEqual((await b.deliveryProfile(users[1])).deliveryProfile, { version: 0, addresses: { home: null, work: null } });
    assert.equal((await control.prepare('SELECT count(*) AS n FROM eats_commands WHERE actor_id=?').get(user.id)).n, 2);
  } finally { if (second) await second.close(); await control.exec(`DROP SCHEMA "${schema}" CASCADE`); await control.close(); }
});
