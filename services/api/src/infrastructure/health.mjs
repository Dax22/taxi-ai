import { SCHEMA_VERSION } from './database.mjs';

export function createHealth(db) {
  let draining = false;
  return Object.freeze({
    draining: () => draining,
    beginShutdown() { draining = true; },
    ready() {
      if (draining) return false;
      try { return db.prepare('PRAGMA user_version').get().user_version === SCHEMA_VERSION
        && db.prepare('SELECT count(*) AS n FROM sqlite_master WHERE name = ?').get('users').n === 1; }
      catch { return false; }
    },
  });
}
