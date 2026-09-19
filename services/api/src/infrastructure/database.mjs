import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, readFileSync, chmodSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const DEFAULT_DATABASE = fileURLToPath(new URL('../../../../data/taxi-ai.sqlite', import.meta.url));
const migrations = ['001_initial.sql', '002_chat.sql', '003_trip_lifecycle.sql', '004_voice_calls.sql', '005_locations.sql', '006_matching.sql', '007_payments.sql'];
export const SCHEMA_VERSION = migrations.length;

export function transaction(db, run) {
  if (run.constructor.name === 'AsyncFunction') throw new TypeError('Database transactions require synchronous callbacks.');
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = run();
    if (result && typeof result.then === 'function') throw new TypeError('Database transactions cannot return promises.');
    db.exec('COMMIT');
    return result;
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

export function openDatabase(path = process.env.TAXI_AI_DB ?? DEFAULT_DATABASE) {
  if (path !== ':memory:') {
    path = resolve(path);
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  }
  const db = new DatabaseSync(path);
  try {
    if (path !== ':memory:') chmodSync(path, 0o600);
    db.exec('PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000; PRAGMA journal_mode = WAL; PRAGMA synchronous = FULL;');
    transaction(db, () => {
      const version = db.prepare('PRAGMA user_version').get().user_version;
      if (version > migrations.length) throw new Error('This database requires a newer version of Taxi Ai.');
      for (let index = version; index < migrations.length; index++) {
        db.exec(readFileSync(new URL(`../../migrations/${migrations[index]}`, import.meta.url), 'utf8'));
        db.exec(`PRAGMA user_version = ${index + 1}`);
      }
    });
    return db;
  } catch (error) {
    db.close();
    throw error;
  }
}
