import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDatabase, SCHEMA_VERSION } from '../src/infrastructure/database.mjs';
import { createApplication } from '../src/application.mjs';
import { tokens } from '../src/infrastructure/tokens.mjs';

test('schema seven preserves paid receipts and active trips, snapshots vehicles and never invents verification evidence', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'taxi-onboarding-upgrade-')); t.after(() => rmSync(dir, { recursive: true, force: true }));
  const path = join(dir, 'old.sqlite'), old = new DatabaseSync(path); old.exec('PRAGMA foreign_keys=ON');
  for (const name of ['001_initial', '002_chat', '003_trip_lifecycle', '004_voice_calls', '005_locations', '006_matching', '007_payments']) {
    old.exec(readFileSync(new URL(`../migrations/${name}.sql`, import.meta.url), 'utf8'));
  }
  old.exec('PRAGMA user_version=7');
  const customerId = tokens.id(), driverId = tokens.id();
  for (const [id, role] of [[customerId, 'customer'], [driverId, 'driver']]) {
    old.prepare('INSERT INTO users(id,email,name,password_hash,role,created_at) VALUES (?,?,?,?,?,?)').run(id, `${role}@example.test`, role, 'test-hash', role, 1000);
  }
  old.prepare("INSERT INTO drivers(user_id,status,vehicle_model,vehicle_plate) VALUES (?,'approved','Old vehicle','OLD-001')").run(driverId);
  old.prepare('INSERT INTO sessions(token_hash,user_id,csrf_token,expires_at) VALUES (?,?,?,?)').run(tokens.digest('legacy-session'), driverId, 'legacy-csrf', 10000000);
  const completed = tokens.id(), active = tokens.id(), available = tokens.id();
  for (const [id, status] of [[completed, 'completed'], [active, 'in_progress']]) {
    old.prepare(`INSERT INTO rides(id,customer_id,driver_id,pickup_id,destination_id,suggested_fare_kobo,status,version,created_at,matched_at,updated_at)
      VALUES (?,?,?,'wuse-ii','maitama',450000,'agreed',7,1000,1100,1600)`).run(id, customerId, driverId);
    for (const [version, type, payload] of [
      [1, 'propose', { actorId: driverId, expectedVersion: 0, amountKobo: 470001, channel: 'in_app', validForMs: 120000, now: 1200 }],
      [2, 'accept', { actorId: customerId, expectedVersion: 1, offerId: `${id}:offer:1`, now: 1300 }],
    ]) old.prepare('INSERT INTO fare_events(ride_id,version,type,payload) VALUES (?,?,?,?)').run(id, version, type, JSON.stringify(payload));
    old.prepare(`INSERT INTO ride_trips(ride_id,customer_id,driver_id,status,fare_kobo,booked_at,departed_at,arrived_at,started_at,completed_at)
      VALUES (?,?,?,?,470001,1400,1450,1500,1550,?)`).run(id, customerId, driverId, status, status === 'completed' ? 1600 : null);
  }
  old.prepare(`INSERT INTO rides(id,customer_id,pickup_id,destination_id,suggested_fare_kobo,created_at,updated_at,request_expires_at)
    VALUES (?,?,'wuse-ii','maitama',450000,1500,1500,301500)`).run(available, customerId);
  old.prepare('INSERT INTO payments(ride_id,customer_id,driver_id,amount_kobo,completed_at,updated_at) VALUES (?,?,?,470001,1600,1600)').run(completed, customerId, driverId);
  const attempt = tokens.id();
  old.prepare(`INSERT INTO payment_attempts(id,ride_id,reference,amount_kobo,currency,provider,status,created_at,resolved_at)
    VALUES (?,?,'TEST-PAID',470001,'NGN','simulator','succeeded',1700,1800)`).run(attempt, completed);
  old.prepare("UPDATE payments SET status='paid',version=2,current_attempt_id=?,paid_at=1800 WHERE ride_id=?").run(attempt, completed);
  const receipt = JSON.stringify({ receiptId: 'TEST-RECEIPT', amountKobo: 470001, pickup: 'Wuse II', destination: 'Maitama', mode: 'simulation' });
  old.prepare('INSERT INTO payment_receipts(ride_id,attempt_id,payload_json) VALUES (?,?,?)').run(completed, attempt, receipt);
  const names = old.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all().map((row) => row.name);
  const before = new Map(names.map((name) => [name, JSON.stringify(old.prepare(`SELECT * FROM ${name}`).all())])); old.close();
  const db = openDatabase(path);
  try {
    assert.ok(SCHEMA_VERSION >= 9);
    for (const name of names) {
      const rows = db.prepare(`SELECT * FROM ${name}`).all().map((row) => { if (name === 'rides') delete row.driver_snapshot_json; return row; });
      assert.equal(JSON.stringify(rows), before.get(name), name);
    }
    const app = createApplication({ db, clock: () => 2000, allowSimulation: true }), user = app.accounts.sessionFor('legacy-session').user;
    assert.equal(user.driver.status, 'approved'); assert.equal(user.driver.eligibility.eligible, false); assert.equal(user.driver.eligibility.reviewStatus, 'draft');
    for (const table of ['driver_documents', 'driver_application_events', 'driver_document_reads']) assert.equal(db.prepare(`SELECT count(*) AS n FROM ${table}`).get().n, 0);
    const saved = app.rides.get(user, active); assert.equal(saved.driver.vehicle.plate, 'OLD-001');
    assert.throws(() => app.rides.mutate({ userId: driverId, key: tokens.id(), action: 'claim', id: available, data: { expectedVersion: 0 } }), { code: 'DRIVER_NOT_ELIGIBLE' });
    const finished = app.rides.mutate({ userId: driverId, key: tokens.id(), action: 'complete', id: active, data: { expectedVersion: saved.version } });
    assert.equal(finished.ride.status, 'completed'); assert.equal(db.prepare('SELECT payload_json FROM payment_receipts WHERE ride_id=?').get(completed).payload_json, receipt);
    assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), []);
  } finally { db.close(); }
  const again = openDatabase(path); assert.equal(again.prepare('SELECT count(*) AS n FROM driver_applications').get().n, 1); again.close();
});
