import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDatabase } from '../src/infrastructure/database.mjs';
import { openPostgresDatabase } from '../src/infrastructure/postgres.mjs';
import { importSqliteToPostgres } from '../src/infrastructure/postgres-import.mjs';

test('PostgreSQL import preserves saved records and identities, safely repeats and rejects populated targets', { skip: !process.env.TAXI_AI_TEST_POSTGRES_URL }, async () => {
  const directory = await mkdtemp(join(tmpdir(), 'taxi-pg-import-')), file = join(directory, 'snapshot.sqlite');
  const source = openDatabase(file), schema = `import_${randomUUID().replaceAll('-', '')}`;
  const now = Date.now(), content = Buffer.from([0, 255, 128, 42]);
  source.prepare('INSERT INTO users(id,email,name,password_hash,role,created_at) VALUES(?,?,?,?,?,?)').run('driver', 'driver@example.test', 'Driver', 'saved-hash', 'driver', now);
  source.prepare('INSERT INTO drivers(user_id,vehicle_model,vehicle_plate) VALUES(?,?,?)').run('driver', 'Toyota', 'TEST-1');
  source.prepare('INSERT INTO driver_applications(driver_id,updated_at) VALUES(?,?)').run('driver', now);
  source.prepare('INSERT INTO driver_documents(id,driver_id,kind,name,mime_type,size_bytes,sha256,content,created_at) VALUES(?,?,?,?,?,?,?,?,?)')
    .run('document', 'driver', 'profile_photo', 'test.png', 'image/png', content.length, 'saved-digest', content, now);
  source.prepare('INSERT INTO audit_events(id,actor_id,kind,subject_id,created_at) VALUES(?,?,?,?,?)').run(99, 'driver', 'test', 'driver', now);
  source.prepare('INSERT INTO worker_leases(name,owner_id,fencing_token,expires_at) VALUES(?,?,?,?)').run('test-worker', 'old-process', 7, now + 30000);
  source.close();
  const db = await openPostgresDatabase({ connectionString: process.env.TAXI_AI_TEST_POSTGRES_URL, schema, max: 1, migrate: true });
  try {
    await assert.rejects(importSqliteToPostgres(db, file, { onProgress({ table }) {
      if (table === 'driver_documents') throw new Error('Interrupted import fixture');
    } }), /Interrupted import fixture/);
    assert.equal((await db.prepare('SELECT count(*) AS count FROM driver_documents').get()).count, 0);
    assert.equal((await db.prepare('SELECT count(*) AS count FROM taxi_import_history').get()).count, 0);
    const result = await importSqliteToPostgres(db, file);
    assert.equal(result.imported, true); assert.equal(result.counts.users, 1);
    assert.equal((await db.prepare('SELECT password_hash AS passwordHash,created_at AS createdAt FROM users WHERE id=?').get('driver')).createdAt, now);
    assert.deepEqual((await db.prepare('SELECT content FROM driver_documents WHERE id=?').get('document')).content, content);
    const inserted = await db.prepare('INSERT INTO audit_events(actor_id,kind,subject_id,created_at) VALUES(?,?,?,?)').run('driver', 'next', 'driver', now);
    assert.equal(inserted.lastInsertRowid, 100);
    assert.equal((await db.prepare('SELECT fencing_token AS token,expires_at AS expiresAt FROM worker_leases WHERE name=?').get('test-worker')).expiresAt, 0);
    const repeated = await importSqliteToPostgres(db, file); assert.equal(repeated.alreadyImported, true);
    const changed = openDatabase(file); changed.prepare('UPDATE users SET name=? WHERE id=?').run('Changed', 'driver'); changed.close();
    await assert.rejects(importSqliteToPostgres(db, file), /not empty/);
    assert.equal((await db.prepare('SELECT name FROM users WHERE id=?').get('driver')).name, 'Driver');
  } finally {
    await db.exec(`DROP SCHEMA "${schema}" CASCADE`); await db.close(); await rm(directory, { recursive: true, force: true });
  }
});
