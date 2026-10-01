const columns = 'token_hash AS tokenHash, kind, job_id AS jobId, share_id AS shareId, driver_id AS driverId, session_id AS sessionId, client_id AS clientId, expires_at AS expiresAt';
export function createBackgroundLocationRepository(db) {
  return {
    find: hash => db.prepare(`SELECT ${columns} FROM background_location_tokens WHERE token_hash=?`).get(hash),
    async replace(row) {
      await db.prepare('DELETE FROM background_location_tokens WHERE driver_id=? AND session_id=?').run(row.driverId, row.sessionId);
      await db.prepare(`INSERT INTO background_location_tokens(token_hash,kind,job_id,share_id,driver_id,session_id,client_id,expires_at)
        VALUES(?,?,?,?,?,?,?,?)`).run(row.tokenHash,row.kind,row.jobId,row.shareId,row.driverId,row.sessionId,row.clientId,row.expiresAt);
    },
    remove: hash => db.prepare('DELETE FROM background_location_tokens WHERE token_hash=?').run(hash),
    prune: now => db.prepare('DELETE FROM background_location_tokens WHERE expires_at<=?').run(now),
  };
}
