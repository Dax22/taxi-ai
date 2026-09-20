import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDatabase, SCHEMA_VERSION } from '../src/infrastructure/database.mjs';
import { createApplication } from '../src/application.mjs';
import { tokens } from '../src/infrastructure/tokens.mjs';

test('schema six preserves existing records and backfills only completed trips as unpaid simulations', (t) => {
  const folder = mkdtempSync(join(tmpdir(), 'taxi-payments-upgrade-'));
  t.after(() => rmSync(folder, { recursive: true, force: true }));
  const filename = join(folder, 'old.sqlite'), old = new DatabaseSync(filename);
  old.exec('PRAGMA foreign_keys = ON');
  for (const file of ['001_initial.sql', '002_chat.sql', '003_trip_lifecycle.sql', '004_voice_calls.sql', '005_locations.sql', '006_matching.sql']) {
    old.exec(readFileSync(new URL(`../migrations/${file}`, import.meta.url), 'utf8'));
  }
  old.exec('PRAGMA user_version = 6');
  for (const role of ['customer', 'driver']) old.prepare('INSERT INTO users (id, email, name, password_hash, role, created_at) VALUES (?, ?, ?, ?, ?, ?)')
    .run(role, `${role}@example.test`, role, 'fixture-password-hash', role, 1000);
  old.prepare("INSERT INTO drivers (user_id, status, vehicle_model, vehicle_plate) VALUES ('driver', 'approved', 'Test car', 'TEST')").run();
  old.prepare("INSERT INTO sessions (token_hash, user_id, csrf_token, expires_at) VALUES (?, 'customer', 'fixture-csrf', 99999999)").run(tokens.digest('fixture-session'));
  const rides = ['completed', 'completed-route', 'booked', 'cancelled', 'agreement'].map((kind) => ({ id: tokens.id(), kind }));
  for (const { id, kind } of rides) {
    old.prepare(`INSERT INTO rides (id, customer_id, driver_id, pickup_id, destination_id, suggested_fare_kobo, status, version, created_at, matched_at, updated_at)
      VALUES (?, 'customer', 'driver', 'wuse-ii', 'maitama', 450000, ?, 7, 1000, 1100, 1600)`).run(id, kind === 'cancelled' ? 'cancelled' : 'agreed');
    if (kind !== 'agreement') {
      const status = kind.startsWith('completed') ? 'completed' : kind;
      old.prepare(`INSERT INTO ride_trips (ride_id, customer_id, driver_id, status, fare_kobo, booked_at, departed_at, arrived_at, started_at, completed_at, pickup_pin)
        VALUES (?, 'customer', 'driver', ?, 470001, 1200, 1300, 1400, ?, ?, ?)`)
        .run(id, status, status === 'completed' ? 1500 : null, status === 'completed' ? 1600 : null, status === 'booked' ? '123456' : null);
    }
    old.prepare('INSERT INTO chat_messages (id, ride_id, sequence, sender_id, body, created_at) VALUES (?, ?, 1, ?, ?, 1150)')
      .run(tokens.id(), id, 'customer', 'Saved conversation');
  }
  const routed = rides.find((item) => item.kind === 'completed-route');
  old.prepare(`INSERT INTO location_quotes (id, customer_id, created_at, expires_at, route_json, ride_id)
    VALUES (?, 'customer', 900, 900900, ?, ?)`).run(tokens.id(), JSON.stringify({ pickup: { name: 'Saved landmark A' }, destination: { name: 'Saved landmark B' } }), routed.id);
  const tables = old.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all().map((row) => row.name);
  const snapshot = new Map(tables.map((name) => [name, JSON.stringify(old.prepare(`SELECT * FROM ${name}`).all())]));
  old.close();
  const db = openDatabase(filename);
  try {
    assert.equal(db.prepare('PRAGMA user_version').get().user_version, SCHEMA_VERSION);
    for (const table of tables) assert.equal(JSON.stringify(db.prepare(`SELECT * FROM ${table}`).all().map((row) => { if (table === 'rides') delete row.driver_snapshot_json; return row; })), snapshot.get(table), table);
    assert.equal(db.prepare('SELECT count(*) AS n FROM payments').get().n, 2);
    assert.equal(db.prepare('SELECT count(*) AS n FROM payment_attempts').get().n, 0);
    assert.equal(db.prepare('SELECT count(*) AS n FROM payment_receipts').get().n, 0);
    assert.ok(db.prepare('SELECT * FROM payments').all().every((row) => row.status === 'unpaid' && row.amount_kobo === 470001 && row.mode === 'simulation'));
    assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), []);
    const app = createApplication({ db, allowSimulation: true, clock: () => 2000 });
    assert.equal(app.accounts.sessionFor('fixture-session').user.id, 'customer');
    let current = app.payments.command({ userId: 'customer', rideId: routed.id, action: 'start', key: tokens.id(), data: { expectedVersion: 0 } }).payment;
    current = app.payments.command({ userId: 'customer', rideId: routed.id, attemptId: current.attempt.id, action: 'simulate', key: tokens.id(),
      data: { expectedVersion: current.version, outcome: 'success' } }).payment;
    const receipt = app.payments.receipt('customer', routed.id).receipt;
    assert.equal(receipt.pickup, 'Saved landmark A'); assert.equal(receipt.destination, 'Saved landmark B');
    assert.equal(current.status, 'paid'); assert.equal(receipt.amountKobo, 470001);
  } finally { db.close(); }
  const reopened = openDatabase(filename);
  try { assert.equal(reopened.prepare('SELECT count(*) AS n FROM payments').get().n, 2); }
  finally { reopened.close(); }
});
