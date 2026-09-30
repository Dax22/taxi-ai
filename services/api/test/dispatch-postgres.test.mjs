import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { openPostgresDatabase } from '../src/infrastructure/postgres.mjs';
import { createDispatchRepository } from '../src/modules/dispatch/repository.mjs';
import { createWorkerCoordinationRepository } from '../src/modules/worker-coordination/repository.mjs';
import { createWorkerCoordinator } from '../src/infrastructure/worker-coordinator.mjs';
import { createDispatchService } from '../src/modules/dispatch/service.mjs';

const connectionString = process.env.TAXI_AI_TEST_POSTGRES_URL;
const deferred = () => { let resolve; const promise = new Promise((r) => { resolve = r; }); return { promise, resolve }; };
function barrier(parties) {
  const gate = deferred(); let arrivals = 0;
  return async () => { if (++arrivals === parties) gate.resolve(); await gate.promise; };
}

test('native PostgreSQL dispatch races across independent pools', { skip: !connectionString, timeout: 60000 }, async (t) => {
  const schema = `test_dispatch_${randomUUID().replaceAll('-', '')}`;
  const first = await openPostgresDatabase({ connectionString, schema, max: 2, migrate: true });
  let second;
  try {
    second = await openPostgresDatabase({ connectionString, schema, max: 2 });
    const dbs = [first, second];
    assert.notEqual((await first.query('SELECT pg_backend_pid() AS pid')).rows[0].pid,
      (await second.query('SELECT pg_backend_pid() AS pid')).rows[0].pid);
    await first.exec('CREATE TABLE concurrency_probe (id INTEGER PRIMARY KEY, value INTEGER NOT NULL)');
    await first.exec('INSERT INTO concurrency_probe VALUES(1,0)');
    await t.test('serialization conflicts retry the complete transaction without losing an update', async () => {
      const together = barrier(2), attempts = [0, 0];
      await Promise.all(dbs.map((db, index) => db.transaction(async () => {
        attempts[index]++;
        const row = await db.prepare('SELECT value FROM concurrency_probe WHERE id=1').get();
        if (attempts[index] === 1) await together();
        await db.prepare('UPDATE concurrency_probe SET value=? WHERE id=1').run(row.value + 1);
      })));
      assert.equal((await first.prepare('SELECT value FROM concurrency_probe WHERE id=1').get()).value, 2);
      assert.ok(attempts[0] + attempts[1] >= 3, 'a real server conflict exercised the retry path');
    });
    const now = Date.now();
    for (const id of ['customer-1', 'customer-2', 'driver-1', 'driver-2']) {
      await first.prepare('INSERT INTO users(id,email,name,password_hash,role,created_at) VALUES(?,?,?,?,?,?)')
        .run(id, `${id}@example.test`, 'Synthetic concurrency fixture', 'unused', id.startsWith('driver') ? 'driver' : 'customer', now);
    }
    for (let i = 1; i <= 2; i++) {
      await first.prepare('INSERT INTO drivers(user_id,vehicle_model,vehicle_plate) VALUES(?,?,?)').run(`driver-${i}`, 'Test', `TEST-${i}`);
      await first.prepare("INSERT INTO driver_availability(id,driver_id,active,mode,area_id,session_hash,client_hash,sequence,started_at,seen_at) VALUES(?,?,1,'sample','wuse-ii','session','client',1,?,?)")
        .run(`availability-driver-${i}`, `driver-${i}`, now, now);
      await first.prepare("INSERT INTO rides(id,customer_id,pickup_id,destination_id,suggested_fare_kobo,created_at,updated_at) VALUES(?,?,'wuse-ii','maitama',50000,?,?)")
        .run(`ride-${i}`, `customer-${i}`, now, now);
    }
    const offer = (index, rideId, driverId) => ({ id: `offer-${index}`, rideId, driverId, availabilityId: `availability-${driverId}`,
      mode: 'sequential', policyVersion: 'test', etaSource: 'distance_fallback', pickupEtaSeconds: null, estimatedAt: null, createdAt: now, expiresAt: now + 20000 });
    for (const [name, pairs] of [
      ['one driver visible to two regions', [['ride-1', 'driver-1'], ['ride-2', 'driver-1']]],
      ['one ride visible to two dispatchers', [['ride-1', 'driver-1'], ['ride-1', 'driver-2']]],
    ]) await t.test(name, async () => {
      await first.exec('DELETE FROM dispatch_offers');
      const together = barrier(2), attempts = [0, 0];
      const inserted = await Promise.all(dbs.map((db, index) => db.transaction(async () => {
        attempts[index]++;
        const repo = createDispatchRepository(db);
        await repo.pending(); // Establish competing SERIALIZABLE snapshots.
        if (attempts[index] === 1) await together();
        return repo.insert(offer(index, ...pairs[index]));
      })));
      assert.equal(inserted.filter(Boolean).length, 1);
      assert.equal((await createDispatchRepository(first).pending()).length, 1);
    });
    await first.exec('DELETE FROM dispatch_offers');
    await t.test('lease guard holds its row lock through the offer transaction commit', async () => {
      const repos = dbs.map(createWorkerCoordinationRepository), held = deferred(), release = deferred();
      const lease = await repos[0].acquire('dispatch:locked', 'first', now, now + 1000);
      const pid = (await second.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
      const writer = first.transaction(async () => {
        assert.equal(await repos[0].guard(lease, now + 100), true);
        held.resolve(); await release.promise;
        await first.prepare('UPDATE concurrency_probe SET value=3 WHERE id=1').run();
      });
      let takeover;
      try {
        await held.promise;
        takeover = repos[1].acquire('dispatch:locked', 'second', now + 1001, now + 3000);
        let blocked = false;
        for (let i = 0; i < 100; i++) {
          blocked = (await first.query('SELECT wait_event_type FROM pg_stat_activity WHERE pid=$1', [pid])).rows[0]?.wait_event_type === 'Lock';
          if (blocked) break;
          await delay(10);
        }
        assert.equal(blocked, true, 'the successor must wait on the guarded lease row');
      } finally { release.resolve(); await writer; }
      assert.equal((await takeover).token, lease.token + 1);
      assert.equal((await second.prepare('SELECT value FROM concurrency_probe WHERE id=1').get()).value, 3);
    });
    await t.test('only one competing worker obtains a lease and takeover fences its predecessor', async () => {
      const repos = dbs.map(createWorkerCoordinationRepository);
      const leases = await Promise.all(repos.map((repo, i) => repo.acquire('dispatch:race', `worker-${i}`, now, now + 1000)));
      assert.equal(leases.filter(Boolean).length, 1);
      const previous = leases.find(Boolean), successor = await repos[1].acquire('dispatch:race', 'successor', now + 1001, now + 3000);
      assert.equal(successor.token, previous.token + 1);
      assert.equal(await first.transaction(() => repos[0].guard(previous, now + 1002)), false);
      assert.equal(await repos[0].renew(previous, now + 1002, now + 5000), false);
      assert.equal(await repos[0].release(previous), false);
      assert.equal(await second.transaction(() => repos[1].guard(successor, now + 1002)), true);
    });
    await t.test('a worker paused during routing cannot publish after another pool takes over', async () => {
      let clock = now;
      const coordinators = dbs.map((db, i) => createWorkerCoordinator({ repository: createWorkerCoordinationRepository(db),
        ownerId: `routing-${i}`, leaseMs: 1000, clock: () => clock }));
      const region = 'ng:181:148', entered = deferred(), resume = deferred();
      const edge = { rideId: 'ride-1', driverId: 'driver-1', region, availabilityId: 'availability-driver-1', version: 1,
        createdAt: now, expiresAt: now + 300000, distanceMeters: 100, from: { lat: 9.08, lng: 7.4 }, to: { lat: 9.081, lng: 7.4 } };
      const dispatch = createDispatchService({ config: { mode: 'sequential' }, coordinator: coordinators[0], clock: () => clock,
        repository: createDispatchRepository(first), candidates: async () => [edge], candidateFor: async () => edge,
        unitOfWork: (action) => first.transaction(action), estimateMany: async () => { entered.resolve(); return resume.promise; },
        tokens: { id: randomUUID }, audit: { record: async () => {} } });
      const lease = await coordinators[0].acquire(`dispatch:${region}`), work = dispatch.refresh({ region, lease });
      try {
        await entered.promise; clock += 1001;
        const successor = await coordinators[1].acquire(lease.name);
        assert.equal(successor.token, lease.token + 1);
      } finally { resume.resolve([]); await work; await dispatch.stop(); }
      assert.equal((await createDispatchRepository(second).pending()).length, 0);
    });
    await t.test('offer and notification failure roll back together', async () => {
      await assert.rejects(first.transaction(async () => {
        assert.equal(await createDispatchRepository(first).insert(offer('rollback', 'ride-1', 'driver-1')), true);
        throw new Error('notification failed');
      }), /notification failed/);
      assert.equal((await createDispatchRepository(second).pending()).length, 0);
    });
  } finally {
    await second?.close();
    try { await first.exec(`DROP SCHEMA "${schema}" CASCADE`); } finally { await first.close(); }
  }
});
