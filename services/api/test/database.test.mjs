import test from 'node:test';
import assert from 'node:assert/strict';
import { openDatabase, transaction } from '../src/infrastructure/database.mjs';

test('synchronous transactions reject async callbacks and roll back promise-returning work', (t) => {
  const db = openDatabase(':memory:');
  t.after(() => db.close());
  let invoked = false;
  assert.throws(() => transaction(db, async () => { invoked = true; }), /synchronous callbacks/);
  assert.equal(invoked, false, 'an async function must not start work outside the transaction');

  assert.throws(() => transaction(db, () => {
    db.prepare('INSERT INTO rate_limits (key, count, reset_at) VALUES (?, ?, ?)').run('probe', 1, 1000);
    return Promise.resolve();
  }), /cannot return promises/);
  assert.equal(db.prepare('SELECT count(*) AS count FROM rate_limits').get().count, 0);

  transaction(db, () => db.prepare('INSERT INTO rate_limits (key, count, reset_at) VALUES (?, ?, ?)').run('probe', 1, 1000));
  assert.equal(db.prepare('SELECT count(*) AS count FROM rate_limits').get().count, 1, 'rollback leaves the connection usable');
});
