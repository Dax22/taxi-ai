const columns = 'name,owner_id AS ownerId,fencing_token AS token,expires_at AS expiresAt';

/** Fences survive restarts. Never delete lease rows: token monotonicity matters. */
export function createWorkerCoordinationRepository(db) {
  return Object.freeze({
    async now() {
      const expression = db.kind === 'postgres' ? 'FLOOR(EXTRACT(EPOCH FROM clock_timestamp()) * 1000)::bigint'
        : "CAST((julianday('now')-2440587.5)*86400000 AS INTEGER)";
      return Number((await db.prepare(`SELECT ${expression} AS now`).get()).now);
    },
    acquire: (name, ownerId, now, until) => db.prepare(`INSERT INTO worker_leases(name,owner_id,fencing_token,expires_at)
      VALUES (?,?,1,?) ON CONFLICT(name) DO UPDATE SET owner_id=excluded.owner_id,
      fencing_token=worker_leases.fencing_token+1,expires_at=excluded.expires_at
      WHERE worker_leases.expires_at<=? RETURNING ${columns}`).get(name, ownerId, until, now),
    async renew(lease, now, until) {
      return (await db.prepare('UPDATE worker_leases SET expires_at=? WHERE name=? AND owner_id=? AND fencing_token=? AND expires_at>?')
        .run(until, lease.name, lease.ownerId, lease.token, now)).changes === 1;
    },
    async release(lease) {
      return (await db.prepare('UPDATE worker_leases SET expires_at=0 WHERE name=? AND owner_id=? AND fencing_token=?')
        .run(lease.name, lease.ownerId, lease.token)).changes === 1;
    },
    async guard(lease, now) {
      // UPDATE obtains a row lock until the caller's transaction commits. Merely
      // reading the token would permit a takeover between checking and writing.
      return (await db.prepare('UPDATE worker_leases SET expires_at=expires_at WHERE name=? AND owner_id=? AND fencing_token=? AND expires_at>?')
        .run(lease.name, lease.ownerId, lease.token, now)).changes === 1;
    },
  });
}
