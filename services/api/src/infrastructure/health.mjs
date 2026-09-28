import { SCHEMA_VERSION } from './database.mjs';
import { asAsyncDatabase } from './async-database.mjs';

export function createHealth(db) {
  db = asAsyncDatabase(db);
  let draining = false;
  return Object.freeze({
    draining: () => draining,
    beginShutdown() { draining = true; },
    async ready() {
      if (draining) return false;
      try { return db.kind === 'postgres' ? await db.healthy()
        : (await db.prepare('PRAGMA user_version').get()).user_version === SCHEMA_VERSION
        && (await db.prepare('SELECT count(*) AS n FROM sqlite_master WHERE name = ?').get('users')).n === 1; }
      catch { return false; }
    },
  });
}
