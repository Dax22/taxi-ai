import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { createWorkerCoordinationRepository } from '../src/modules/worker-coordination/repository.mjs';
import { createWorkerCoordinator } from '../src/infrastructure/worker-coordinator.mjs';
import { createWorkerConfig, dispatchRegion } from '../src/infrastructure/worker-config.mjs';
import { createWorkerRuntime } from '../src/infrastructure/worker-runtime.mjs';
import { createDispatchService } from '../src/modules/dispatch/service.mjs';
import { createAppServer } from '../../../apps/web/server.mjs';
import { openDatabase } from '../src/infrastructure/database.mjs';

function fixture(t) {
  const db = new DatabaseSync(':memory:');
  db.exec('CREATE TABLE worker_leases(name TEXT PRIMARY KEY,owner_id TEXT NOT NULL,fencing_token INTEGER NOT NULL,expires_at INTEGER NOT NULL) STRICT');
  t.after(() => db.close());
  const repository = createWorkerCoordinationRepository(db);
  let at = 1000;
  return { db, repository, advance: (ms) => { at += ms; }, coordinator: (ownerId) => createWorkerCoordinator({ repository, ownerId, leaseMs: 100, clock: () => at }) };
}

test('persistent lease takeover increments fencing token and rejects old writes, renewals and releases', async (t) => {
  const f = fixture(t), first = f.coordinator('first'), next = f.coordinator('next');
  const lease = await first.acquire('dispatch:ng:181:148');
  assert.equal(lease.token, 1);
  assert.equal(await next.acquire(lease.name), null);
  assert.equal(await first.guard(lease), true);
  f.advance(100);
  assert.equal(await first.guard(lease), false);
  const takeover = await next.acquire(lease.name);
  assert.equal(takeover.token, 2);
  assert.equal(await first.renew(lease), false);
  assert.equal(await first.release(lease), false);
  assert.equal(await next.guard(takeover), true);
  assert.equal(await next.release(takeover), true);
  assert.equal((await first.acquire(lease.name)).token, 3);
  assert.ok(Math.abs(await f.repository.now() - Date.now()) < 2000);
});

test('a worker losing its lease during route estimation cannot publish an offer', async (t) => {
  const f = fixture(t), coordinator = f.coordinator('old'), next = f.coordinator('new');
  const region = 'ng:181:148';
  const lease = await coordinator.acquire(`dispatch:${region}`);
  let entered, release, offers = 0;
  const enteredRouting = new Promise((resolve) => { entered = resolve; });
  const routing = new Promise((resolve) => { release = resolve; });
  t.after(() => release([]));
  const edge = { rideId: 'ride', driverId: 'driver', region, availabilityId: 'availability', version: 1,
    createdAt: 0, expiresAt: 300_000, distanceMeters: 100, pickupEtaSeconds: null, from: { lat: 9.08, lng: 7.4 }, to: { lat: 9.081, lng: 7.4 } };
  const dispatch = createDispatchService({ coordinator, config: { mode: 'sequential' }, clock: () => 1000,
    repository: { pending: async () => [], attempted: async () => false, insert: async () => { offers += 1; return true; } },
    candidates: async () => [edge], candidateFor: async () => edge, getAccount: async () => ({}),
    unitOfWork: async (run) => { f.db.exec('BEGIN IMMEDIATE'); try { const result = await run(); f.db.exec('COMMIT'); return result; } catch (error) { f.db.exec('ROLLBACK'); throw error; } },
    estimateMany: async () => { entered(); return routing; }, tokens: { id: () => 'offer' }, audit: { record: async () => {} } });
  const work = dispatch.refresh({ region, lease });
  await enteredRouting;
  f.advance(100);
  assert.equal((await next.acquire(lease.name)).token, 2);
  release([]);
  await work;
  assert.equal(offers, 0);
});

test('API-only runtime starts no jobs and regional runtime bounds overlap', async () => {
  const api = createWorkerRuntime({ config: createWorkerConfig({ TAXI_AI_PROCESS_ROLE: 'api' }),
    coordinator: { acquire: () => assert.fail('HTTP role cannot acquire worker leases') },
    regions: () => assert.fail('HTTP role cannot scan regions'), dispatch: {} });
  api.start(); await api.tick(); await api.stop();
  let active = 0, peak = 0;
  const gates = [];
  const coordinator = { acquire: async (name) => ({ name }), release: async () => true, renew: async () => true };
  const runtime = createWorkerRuntime({ coordinator, config: createWorkerConfig({ TAXI_AI_PROCESS_ROLE: 'worker', TAXI_AI_WORKER_CONCURRENCY: '2' }),
    regions: async () => ['ng:181:148', 'ng:182:148', 'ng:181:147'], maintenance: async () => {},
    dispatch: { refresh: async () => { active += 1; peak = Math.max(peak, active); await new Promise((resolve) => gates.push(resolve)); active -= 1; } } });
  await runtime.tick(); await new Promise((resolve) => setImmediate(resolve));
  await runtime.tick(); await new Promise((resolve) => setImmediate(resolve));
  assert.equal(peak, 2);
  assert.equal(runtime.running(), 2);
  const stopped = runtime.stop(); gates.forEach((release) => release()); await stopped;
  assert.equal(runtime.running(), 0);
});

test('region cells use pickup coordinates and worker configuration fails closed on invalid roles', () => {
  assert.equal(dispatchRegion({ lat: 9.08, lng: 7.4 }), 'ng:181:148');
  assert.equal(dispatchRegion(null, 'wuse-ii'), 'sample:wuse-ii');
  assert.throws(() => dispatchRegion({ lat: 40, lng: -88 }));
  assert.throws(() => createWorkerConfig({ TAXI_AI_PROCESS_ROLE: 'workre' }));
  assert.throws(() => createWorkerConfig({ TAXI_AI_WORKER_CONCURRENCY: '0' }));
  assert.throws(() => createWorkerConfig({ TAXI_AI_WORKER_REGIONS: 'ng:181:148,ng:181:148' }));
});

test('shutdown bounds stalled region discovery and split roles reject SQLite before starting work', async () => {
  const runtime = createWorkerRuntime({ coordinator: {}, config: { ...createWorkerConfig(), shutdownMs: 10 },
    regions: () => new Promise(() => {}), dispatch: {} });
  void runtime.tick();
  await assert.rejects(runtime.stop(), /shutdown deadline/);
  for (const role of ['api', 'worker']) {
    const db = openDatabase(':memory:');
    try { assert.throws(() => createAppServer({ db, workerConfig: createWorkerConfig({ TAXI_AI_PROCESS_ROLE: role }) }), /require PostgreSQL/); }
    finally { db.close(); }
  }
});

test('regional scheduling consumes every discovery page without starving regions between pages', async () => {
  const pages = [Array.from({ length: 512 }, (_, i) => `ng:100:${i}`), Array.from({ length: 512 }, (_, i) => `ng:101:${i}`)];
  let page = 0;
  const visited = new Set();
  const runtime = createWorkerRuntime({ config: createWorkerConfig({ TAXI_AI_WORKER_CONCURRENCY: '32' }),
    coordinator: { acquire: async (name) => ({ name }), release: async () => true, renew: async () => true },
    regions: async () => pages[page++ % pages.length], maintenance: async () => {},
    dispatch: { refresh: async ({ region }) => { visited.add(region); } } });
  for (let i = 0; i < 36; i += 1) { await runtime.tick(); await new Promise((resolve) => setImmediate(resolve)); }
  await runtime.stop();
  assert.equal(visited.size, 1024);
});
