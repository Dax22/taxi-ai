import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { openDatabase, SCHEMA_VERSION } from '../src/infrastructure/database.mjs';

test('isolated SQLite schema 50 upgrades preserve alerts and accounts without fabricating staff review', t => {
  const directory = mkdtempSync(join(tmpdir(), 'taxi-safety-schema-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const path = join(directory, 'fixture.sqlite'), db = new DatabaseSync(path);
  const migrations = new URL('../migrations/', import.meta.url);
  db.exec('PRAGMA foreign_keys=ON; BEGIN;');
  const files = readdirSync(migrations).filter(name => /^\d{3}_.+\.sql$/.test(name) && Number(name.slice(0, 3)) <= 50).sort();
  assert.equal(files.length, 50);
  for (const file of files) db.exec(readFileSync(new URL(file, migrations), 'utf8'));
  db.exec('PRAGMA user_version=50; COMMIT;');
  const user = randomUUID(), ride = randomUUID(), alert = randomUUID();
  db.prepare('INSERT INTO users(id,email,name,password_hash,role,created_at) VALUES (?,?,?,?,?,?)').run(user, 'fixture@example.test', 'Fixture person', 'not-a-login', 'customer', 1000);
  db.prepare('INSERT INTO rides(id,customer_id,pickup_id,destination_id,suggested_fare_kobo,created_at,updated_at) VALUES (?,?,?,?,?,?,?)').run(ride, user, 'wuse-ii', 'maitama', 100000, 1000, 1000);
  const snapshot = JSON.stringify({ rideId: ride, passenger: { id: user, kind: 'account', name: 'Fixture person' }, recordedAt: 1000, location: null });
  db.prepare('INSERT INTO safety_auto_alerts(id,owner_id,ride_id,kind,signal_json,snapshot_json,status,created_at,due_at) VALUES (?,?,?,?,?,?,?,?,?)').run(alert, user, ride, 'manual', '{"kind":"manual","capturedAt":1000}', snapshot, 'finished', 1000, 31000);
  const before = db.prepare('SELECT * FROM safety_auto_alerts').get(), accounts = db.prepare('SELECT * FROM users').all(); db.close();
  for (let pass = 0; pass < 2; pass++) {
    const upgraded = openDatabase(path);
    try {
      assert.equal(upgraded.prepare('PRAGMA user_version').get().user_version, SCHEMA_VERSION);
      assert.deepEqual(upgraded.prepare('SELECT * FROM safety_auto_alerts').get(), before);
      assert.deepEqual(upgraded.prepare('SELECT * FROM users').all(), accounts);
      assert.equal(upgraded.prepare('SELECT count(*) AS n FROM safety_alert_reviews').get().n, 0);
      assert.equal(upgraded.prepare('SELECT count(*) AS n FROM safety_alert_review_events').get().n, 0);
      assert.deepEqual(upgraded.prepare('PRAGMA foreign_key_check').all(), []);
    } finally { upgraded.close(); }
  }
});
