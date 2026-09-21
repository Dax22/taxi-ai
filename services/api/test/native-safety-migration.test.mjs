import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDatabase, SCHEMA_VERSION } from '../src/infrastructure/database.mjs';

test('schema seventeen upgrades preserving saved records and web links while enforcing exclusive native/browser bindings', (t) => {
  const folder = mkdtempSync(join(tmpdir(), 'taxi-native-upgrade-')); t.after(() => rmSync(folder, { recursive: true, force: true }));
  const path = join(folder, 'old.sqlite'), old = new DatabaseSync(path), migrations = new URL('../migrations/', import.meta.url);
  old.exec('PRAGMA foreign_keys=ON');
  for (const name of readdirSync(migrations).filter((name) => /^\d{3}_.*\.sql$/.test(name) && Number(name.slice(0, 3)) <= 17).sort()) old.exec(readFileSync(new URL(name, migrations), 'utf8'));
  old.exec('PRAGMA user_version=17');
  old.exec(`INSERT INTO users(id,email,name,password_hash,role,created_at) VALUES ('customer','legacy@example.test','Legacy customer','private-hash','customer',1000);
    INSERT INTO rides(id,customer_id,pickup_id,destination_id,suggested_fare_kobo,status,version,created_at,updated_at)
      VALUES ('ride','customer','wuse-ii','maitama',450000,'requested',0,1000,1000);
    INSERT INTO trusted_contacts(id,owner_id,name,phone,created_at) VALUES ('contact','customer','Legacy friend','+2348000000000',1000);
    INSERT INTO safety_incidents(id,ride_id,reporter_id,kind,note,snapshot_json,created_at,updated_at)
      VALUES ('incident','ride','customer','need_help','Original private note','{}',1000,1000);
    INSERT INTO trip_share_links(id,ride_id,owner_id,token_hash,session_hash,created_at,expires_at)
      VALUES ('web-link','ride','customer','old-hashed-secret','old-cookie-hash',1000,901000);
    INSERT INTO trip_share_links(id,ride_id,owner_id,active,created_at,expires_at,ended_at,reason)
      VALUES ('ended-link','ride','customer',0,1000,901000,2000,'revoked');
    INSERT INTO safety_commands(actor_id,key,fingerprint,resource_id) VALUES ('customer','legacy-command-key','original-fingerprint','web-link');`);
  const tables = old.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all().map((r) => r.name);
  const before = new Map(tables.map((name) => [name, old.prepare(`SELECT * FROM ${name}`).all()])); old.close();
  for (let pass = 0; pass < 2; pass++) {
    const db = openDatabase(path);
    try {
      assert.equal(db.prepare('PRAGMA user_version').get().user_version, SCHEMA_VERSION);
      for (const name of tables) {
        const rows = db.prepare(`SELECT * FROM ${name}`).all().map((row) => {
          if (name === 'trip_share_links') { assert.equal(row.native_session_id, null); delete row.native_session_id; } return row;
        });
        assert.deepEqual(rows, before.get(name), name);
      }
      assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), []);
      assert.throws(() => db.prepare('UPDATE trip_share_links SET native_session_id=? WHERE id=?').run('device-family', 'web-link'));
      assert.throws(() => db.prepare('UPDATE trip_share_links SET session_hash=NULL WHERE id=?').run('web-link'));
      db.prepare('UPDATE trip_share_links SET session_hash=NULL,native_session_id=? WHERE id=?').run('device-family', 'web-link');
      assert.equal(db.prepare('SELECT native_session_id FROM trip_share_links WHERE id=?').get('web-link').native_session_id, 'device-family');
      db.prepare('UPDATE trip_share_links SET session_hash=?,native_session_id=NULL WHERE id=?').run('old-cookie-hash', 'web-link');
    } finally { db.close(); }
  }
});
