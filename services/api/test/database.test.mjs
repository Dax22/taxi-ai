import test from 'node:test';
import assert from 'node:assert/strict';
import { openDatabase, transaction } from '../src/infrastructure/database.mjs';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApplication } from '../src/application.mjs';
import { tokens } from '../src/infrastructure/tokens.mjs';

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

test('the chat migration preserves a version-one database, including existing accounts, sessions and rides', (t) => {
  const folder = mkdtempSync(join(tmpdir(), 'taxi-ai-migration-'));
  t.after(() => rmSync(folder, { recursive: true, force: true }));
  const filename = join(folder, 'existing.sqlite');
  const old = new DatabaseSync(filename);
  old.exec(readFileSync(new URL('../migrations/001_initial.sql', import.meta.url), 'utf8'));
  old.exec('PRAGMA user_version = 1');
  old.prepare('INSERT INTO users (id, email, name, password_hash, role, created_at) VALUES (?, ?, ?, ?, ?, ?)')
    .run('existing-user', 'existing@example.test', 'Existing customer', 'test-only-hash', 'customer', 1000);
  old.prepare('INSERT INTO sessions (token_hash, user_id, csrf_token, expires_at) VALUES (?, ?, ?, ?)')
    .run(tokens.digest('existing-token'), 'existing-user', 'existing-csrf', 9999999);
  old.prepare('INSERT INTO rides (id, customer_id, pickup_id, destination_id, suggested_fare_kobo, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run('existing-ride', 'existing-user', 'wuse-ii', 'maitama', 450000, 1000, 1000);
  const snapshot = ['users', 'sessions', 'rides'].map((table) => JSON.stringify(old.prepare(`SELECT * FROM ${table}`).all()));
  old.close();
  const upgraded = openDatabase(filename);
  try {
    assert.equal(upgraded.prepare('PRAGMA user_version').get().user_version, 2);
    for (const [index, table] of ['users', 'sessions', 'rides'].entries()) {
      assert.equal(JSON.stringify(upgraded.prepare(`SELECT * FROM ${table}`).all()), snapshot[index]);
    }
    assert.equal(upgraded.prepare('SELECT count(*) AS count FROM chat_messages').get().count, 0);
    const app = createApplication({ db: upgraded, clock: () => 2000 });
    const session = app.accounts.sessionFor('existing-token');
    assert.equal(session.user.name, 'Existing customer');
    assert.equal(app.rides.get(session.user, 'existing-ride').suggestedFareKobo, 450000);
  } finally { upgraded.close(); }
  const reopened = openDatabase(filename);
  assert.equal(reopened.prepare('PRAGMA user_version').get().user_version, 2);
  reopened.close();
});
