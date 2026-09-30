import test from 'node:test';
import assert from 'node:assert/strict';
import { createDispatchProfiler } from '../src/infrastructure/dispatch-profiler.mjs';
import { createTelemetry } from '../src/infrastructure/telemetry.mjs';

test('dispatch profiling isolates concurrent cycles and excludes detached and unrelated queries', async () => {
  const reports = []; let resume;
  const gate = new Promise((resolve) => { resume = resolve; });
  const source = { kind: 'postgres', prepare: () => ({ get: async () => ({ ok: true }) }), transaction: async (run) => run() };
  const profiler = createDispatchProfiler({ sampleEvery: 1, report: (row) => reports.push(row) }), db = profiler.wrap(source);
  let detached;
  await Promise.all([
    profiler.cycle(async () => {
      await profiler.phase('discovery', () => db.prepare('SELECT private_column FROM users WHERE email=?').get('private@example.test'));
      detached = gate.then(() => db.prepare('SELECT private_detached').get());
    }),
    profiler.cycle(async () => { await db.transaction(async () => { await db.prepare('SELECT other').get(); await db.prepare('SELECT other').get(); }); }),
    db.prepare('SELECT unrelated').get(),
  ]);
  resume(); await detached;
  assert.deepEqual(reports.map((r) => r.queryCount).sort(), [1, 2]);
  assert.equal(reports.reduce((n, r) => n + r.transactions, 0), 1);
  assert.ok(reports.some((r) => r.phases.discovery >= 0));
  for (const secret of ['private', 'SELECT', 'users', 'email', 'other', 'detached']) assert.ok(!JSON.stringify(reports).includes(secret));
});

test('profiling counts retry work and errors, bounds fingerprints, and preserves outcomes if reporting fails', async () => {
  const reports = [], failure = new Error('private database error');
  const profiler = createDispatchProfiler({ sampleEvery: 1, report: (row) => { reports.push(row); throw failure; } });
  const db = profiler.wrap({ prepare: () => ({ get: async () => 1 }), transaction: async (run) => { await run(); return run(); } });
  assert.equal(await profiler.cycle(() => db.transaction(() => db.prepare('SELECT 1').get())), 1);
  assert.equal(reports[0].retries, 1); assert.equal(reports[0].queryCount, 2);
  await assert.rejects(profiler.cycle(async () => {
    for (let i = 0; i < 100; i++) await db.prepare(`SELECT ${i}`).get();
    throw failure;
  }), (error) => error === failure);
  assert.equal(reports[1].queries.length, 65); assert.equal(reports[1].failed, true);
  assert.equal(reports[1].queries.reduce((n, row) => n + row.count, 0), 100);
  const failing = profiler.wrap({ prepare: () => ({ get: async () => { throw failure; } }) });
  await assert.rejects(profiler.cycle(() => failing.prepare('SELECT secret').get()), (error) => error === failure);
  assert.equal(reports[2].queryErrors, 1);
  assert.equal(createDispatchProfiler().wrap(db), db);
});

test('profile telemetry allowlists only bounded operational data', () => {
  const lines = [], telemetry = createTelemetry({ write: (line) => lines.push(line) });
  telemetry.dispatchProfile({ durationMs: 10, userId: 'private', sql: 'SELECT private', phases: { discovery: 2, private: 3 },
    queries: [{ fingerprint: '0123456789abcdef', count: 1, values: ['private'] }, { fingerprint: 'private' }] });
  assert.equal(JSON.parse(lines[0]).queries.length, 1);
  assert.ok(!lines[0].includes('private'));
  assert.throws(() => createDispatchProfiler({ sampleEvery: -1 }));
});
