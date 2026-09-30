import { openPostgresDatabase } from '../services/api/src/infrastructure/postgres.mjs';

/** Verify a real multi-session server before claiming concurrency evidence. */
export async function requireNativePostgres(connectionString) {
  const clients = [];
  try {
    for (let i = 0; i < 2; i++) clients.push(await openPostgresDatabase({ connectionString, max: 1, verify: false }));
    const identities = await Promise.all(clients.map((db) => db.query('SELECT pg_backend_pid() AS pid,version() AS version')));
    if (identities[0].rows[0].pid === identities[1].rows[0].pid || identities.some((r) => !/^PostgreSQL (1[6-9]|[2-9]\d)\./.test(r.rows[0].version))) {
      throw new Error('This validation requires native PostgreSQL 16+ with independent backends.');
    }
  } finally { await Promise.all(clients.map((db) => db.close())); }
}
