import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { createRealtimeRepository } from '../src/modules/realtime/repository.mjs';
import { createRealtimeService } from '../src/modules/realtime/service.mjs';
import { realtimeResponse, parseRevisionQuery } from '../src/modules/realtime/routes.mjs';
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
function harness(t) {
  const db = new DatabaseSync(':memory:');
  db.exec('CREATE TABLE account_revisions(user_id TEXT PRIMARY KEY, revision INTEGER NOT NULL, updated_at INTEGER NOT NULL)');
  const repository = createRealtimeRepository(db), service = createRealtimeService({ repository, intervalMs: 5 });
  t.after(() => { service.close(); db.close(); });
  return { db, repository, service };
}

test('durable revisions cross service instances and expose only the authenticated account cursor', async t => {
  const { repository, service } = harness(t);
  const other = createRealtimeService({ repository }); t.after(() => other.close());
  const a = service.wait('alice', { waitMs: 100 });
  const b = service.wait('bob', { waitMs: 20 });
  await pause(2); await other.publish(['alice']);
  assert.deepEqual(await a, { cursor: '1', changed: true });
  assert.deepEqual(await b, { cursor: '0', changed: false });
  assert.deepEqual(await service.wait('alice', { cursor: '1', waitMs: 0 }), { cursor: '1', changed: false });
  assert.deepEqual(await other.wait('alice', { cursor: '0', waitMs: 0 }), { cursor: '1', changed: true });
});

test('disconnect and server shutdown release every pending subscription', async t => {
  const { service } = harness(t), signal = new AbortController();
  const waiting = service.wait('alice', { signal: signal.signal });
  await pause(1); assert.equal(service.pending(), 1);
  signal.abort(); await waiting; assert.equal(service.pending(), 0);
  const next = service.wait('bob'); await pause(1); service.close();
  await assert.rejects(next, e => e.code === 'SERVER_DRAINING'); assert.equal(service.pending(), 0);
});

test('long polls revalidate revoked sessions before returning', async t => {
  const { service } = harness(t); let valid = true;
  const pending = realtimeResponse(service, { userId: 'alice', query: new URLSearchParams('cursor=0&wait=100'),
    authorize: () => valid ? { user: { id: 'alice' } } : null });
  await pause(1); valid = false; await service.publish(['alice']);
  await assert.rejects(pending, e => e.code === 'UNAUTHENTICATED');
  await assert.rejects(realtimeResponse(service, { userId: 'alice', query: new URLSearchParams('wait=0'), authorize: () => ({ user: { id: 'bob' } }) }), e => e.code === 'UNAUTHENTICATED');
});

test('queries reject user identifiers, invalid cursors and unbounded waits', () => {
  for (const query of ['userId=bob', 'cursor=-1', 'cursor=2.5', 'cursor=abc', 'wait=25001', 'wait=-1']) {
    assert.throws(() => parseRevisionQuery(new URLSearchParams(query)), e => e.code.startsWith('INVALID_'));
  }
  assert.deepEqual(parseRevisionQuery(new URLSearchParams('cursor=9007199254740993&wait=0')), { cursor: '9007199254740993', waitMs: 0 });
});

test('per-account cap applies to simultaneous opens and unrelated accounts remain usable', async t => {
  const { service } = harness(t), signal = new AbortController();
  const requests = Array.from({ length: 5 }, () => service.wait('alice', { signal: signal.signal }));
  const rejected = assert.rejects(requests[4], e => e.code === 'RATE_LIMITED');
  await pause(1); await rejected; assert.equal(service.pending(), 4);
  assert.deepEqual(await service.wait('bob', { waitMs: 0 }), { cursor: '0', changed: false });
  signal.abort(); await Promise.all(requests.slice(0, 4)); assert.equal(service.pending(), 0);
});

test('domain triggers commit account invalidations atomically and roll back with failed changes', async t => {
  const { openDatabase } = await import('../src/infrastructure/database.mjs');
  const { readFileSync } = await import('node:fs');
  const db = openDatabase(':memory:'); t.after(() => db.close());
  if (!db.prepare("SELECT name FROM sqlite_master WHERE name='account_revisions'").get()) {
    db.exec(readFileSync(new URL('../migrations/028_realtime.sql', import.meta.url), 'utf8'));
  }
  const repository = createRealtimeRepository(db);
  for (const id of ['alice', 'bob', 'charlie']) db.prepare("INSERT INTO users(id,email,name,password_hash,role,created_at) VALUES(?,?,?,'unused','customer',1)").run(id, `${id}@example.test`, id);
  db.prepare(`INSERT INTO rides(id,customer_id,driver_id,pickup_id,destination_id,suggested_fare_kobo,status,created_at,updated_at,matched_at)
    VALUES('ride-1','alice','bob','wuse-ii','jabi',500000,'negotiating',1,1,1)`).run();
  const before = await repository.revision('alice');
  assert.equal(before, '1'); assert.equal(await repository.revision('bob'), '1'); assert.equal(await repository.revision('charlie'), '0');
  db.exec('BEGIN');
  db.prepare("INSERT INTO chat_messages(id,ride_id,sequence,sender_id,body,created_at) VALUES('message-1','ride-1',1,'bob','Private message',2)").run();
  assert.equal(await repository.revision('alice'), '2');
  db.exec('ROLLBACK');
  assert.equal(await repository.revision('alice'), before);
  db.prepare("INSERT INTO chat_messages(id,ride_id,sequence,sender_id,body,created_at) VALUES('message-2','ride-1',1,'bob','Private message',2)").run();
  assert.equal(await repository.revision('alice'), '2'); assert.equal(await repository.revision('bob'), '2');
  assert.equal(await repository.revision('charlie'), '0');
  assert.deepEqual(db.prepare('PRAGMA table_info(account_revisions)').all().map(column => column.name), ['user_id','revision','updated_at']);
});
