import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDatabase, SCHEMA_VERSION } from '../src/infrastructure/database.mjs';

test('schema eight upgrades without altering accounts, documents, trip snapshots or paid receipts, and creates no synthetic incidents', (t) => {
  const folder = mkdtempSync(join(tmpdir(), 'taxi-safety-upgrade-')); t.after(() => rmSync(folder, { recursive: true, force: true }));
  const path = join(folder, 'old.sqlite'), old = new DatabaseSync(path); old.exec('PRAGMA foreign_keys=ON');
  for (const name of ['001_initial', '002_chat', '003_trip_lifecycle', '004_voice_calls', '005_locations', '006_matching', '007_payments', '008_driver_onboarding']) {
    old.exec(readFileSync(new URL(`../migrations/${name}.sql`, import.meta.url), 'utf8'));
  }
  old.exec('PRAGMA user_version=8');
  for (const role of ['customer', 'driver', 'admin']) old.prepare('INSERT INTO users(id,email,name,password_hash,role,created_at) VALUES (?,?,?,?,?,1000)')
    .run(role, `${role}@example.test`, role, 'fixture-hash', role);
  old.exec(`INSERT INTO drivers(user_id,status,vehicle_model,vehicle_plate) VALUES ('driver','approved','Old vehicle','OLD-123');
    INSERT INTO driver_applications(driver_id,status,details_json,updated_at,reviewed_by) VALUES ('driver','approved','{"legalName":"Private legacy details"}',1000,'admin');
    INSERT INTO rides(id,customer_id,driver_id,pickup_id,destination_id,suggested_fare_kobo,status,version,created_at,matched_at,updated_at,driver_snapshot_json)
      VALUES ('ride','customer','driver','wuse-ii','maitama',450000,'agreed',7,1000,1100,1600,'{"vehicle":{"plate":"SAVED-PLATE"}}');
    INSERT INTO ride_trips(ride_id,customer_id,driver_id,status,fare_kobo,booked_at,departed_at,arrived_at,started_at,completed_at)
      VALUES ('ride','customer','driver','completed',470001,1400,1450,1500,1550,1600);
    INSERT INTO payments(ride_id,customer_id,driver_id,amount_kobo,completed_at,updated_at) VALUES ('ride','customer','driver',470001,1600,1600);
    INSERT INTO payment_attempts(id,ride_id,reference,amount_kobo,currency,provider,status,created_at,resolved_at)
      VALUES ('attempt','ride','TEST-PAID',470001,'NGN','simulator','succeeded',1700,1800);
    UPDATE payments SET status='paid',version=2,current_attempt_id='attempt',paid_at=1800 WHERE ride_id='ride';
    INSERT INTO payment_receipts(ride_id,attempt_id,payload_json) VALUES ('ride','attempt','{"receiptId":"TEST-PAID","amountKobo":470001}');`);
  const bytes = Buffer.from('private-document-fixture');
  old.prepare(`INSERT INTO driver_documents(id,driver_id,kind,name,mime_type,size_bytes,sha256,content,created_at)
    VALUES ('document','driver','profile_photo','fixture.png','image/png',?,'fixture-sha',?,1000)`).run(bytes.length, bytes);
  const tables = old.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all().map((row) => row.name);
  const before = new Map(tables.map((name) => [name, old.prepare(`SELECT * FROM ${name}`).all()])); old.close();
  for (let round = 0; round < 2; round++) {
    const db = openDatabase(path);
    try {
      assert.ok(SCHEMA_VERSION >= 9); assert.equal(db.prepare('PRAGMA user_version').get().user_version, SCHEMA_VERSION);
      for (const name of tables) assert.deepEqual(db.prepare(`SELECT * FROM ${name}`).all(), before.get(name), name);
      for (const name of ['trusted_contacts', 'safety_incidents', 'safety_incident_events', 'safety_notifications', 'safety_notification_events', 'trip_share_links', 'safety_commands']) {
        assert.equal(db.prepare(`SELECT count(*) AS n FROM ${name}`).get().n, 0, name);
      }
      assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), []);
    } finally { db.close(); }
  }
});
