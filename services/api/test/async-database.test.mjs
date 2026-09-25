import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { setImmediate as nextTurn } from 'node:timers/promises';
import { asAsyncDatabase } from '../src/infrastructure/async-database.mjs';
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
function setup(t) {
  const raw = new DatabaseSync(':memory:'); raw.exec('CREATE TABLE records(id TEXT PRIMARY KEY, value INTEGER NOT NULL)');
  const db = asAsyncDatabase(raw); t.after(() => db.close());
  const write = (id, value = 1) => db.prepare('INSERT INTO records(id,value) VALUES(?,?)').run(id, value);
  const rows = () => db.prepare('SELECT id,value FROM records ORDER BY id').all();
  return { raw, db, write, rows };
}

test('async SQLite rolls back every write on both sides of an await', async t => {
  const { db, write, rows } = setup(t);
  await assert.rejects(db.transaction(async () => { await write('first'); await nextTurn(); await write('second'); throw new Error('rollback'); }), /rollback/);
  assert.deepEqual(await rows(), []);
});

test('outside requests wait for the owning transaction and cannot be rolled back with it', async t => {
  const { db, write, rows } = setup(t), entered = deferred(), release = deferred();
  const transaction = db.transaction(async () => { await write('private'); entered.resolve(); await release.promise; throw new Error('cancel transaction'); });
  const rejected = assert.rejects(transaction, /cancel transaction/); await entered.promise;
  let observed = false;
  const read = rows().then(result => { observed = true; return result; });
  const outside = write('outside');
  await nextTurn(); assert.equal(observed, false);
  release.resolve(); await rejected;
  assert.deepEqual(await read, []); await outside;
  assert.deepEqual((await rows()).map(row => row.id), ['outside']);
});

test('nested savepoint rollback preserves successful outer work and remains usable', async t => {
  const { db, write, rows } = setup(t);
  const result = await db.transaction(async () => {
    await write('before');
    await assert.rejects(db.transaction(async () => { await write('nested'); await nextTurn(); throw new Error('nested failed'); }), /nested failed/);
    await db.transaction(async () => { await write('after'); });
    return 'committed';
  });
  assert.equal(result, 'committed'); assert.deepEqual((await rows()).map(row => row.id), ['after','before']);
});

test('queued queries continue after SQL errors and rejected transactions', async t => {
  const { db, write, rows } = setup(t);
  await write('one');
  const duplicate = assert.rejects(write('one'), /UNIQUE/), successful = write('two');
  await duplicate; await successful;
  await assert.rejects(db.transaction(async () => { await write('three'); throw new Error('fail'); }), /fail/);
  await write('four'); assert.deepEqual((await rows()).map(row => row.id), ['four','one','two']);
});

test('wrapping the same raw SQLite connection shares its transaction queue', async t => {
  const { raw, db, write } = setup(t), entered = deferred(), release = deferred();
  assert.equal(asAsyncDatabase(raw), db); assert.equal(asAsyncDatabase(db), db);
  const transaction = db.transaction(async () => { await write('inside'); entered.resolve(); await release.promise; });
  await entered.promise;
  let resolved = false;
  const outside = asAsyncDatabase(raw).prepare('SELECT count(*) AS n FROM records').get().then(value => { resolved = true; return value; });
  await nextTurn(); assert.equal(resolved, false); release.resolve(); await transaction;
  assert.equal((await outside).n, 1);
});

test('detached work from a finished transaction does not enter another request transaction', async t => {
  const { db, write, rows } = setup(t), wake = deferred(), otherEntered = deferred(), releaseOther = deferred();
  let detached;
  await db.transaction(async () => { await write('committed'); detached = wake.promise.then(() => write('detached')); });
  const other = db.transaction(async () => { await write('rolled-back'); otherEntered.resolve(); await releaseOther.promise; throw new Error('other failed'); });
  const rejected = assert.rejects(other, /other failed/); await otherEntered.promise;
  wake.resolve(); await nextTurn(); releaseOther.resolve(); await rejected; await detached;
  assert.deepEqual((await rows()).map(row => row.id), ['committed','detached']);
});
