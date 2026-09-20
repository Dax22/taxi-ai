/** Opaque credentials are hashed before reaching this storage adapter. */
export function createDeviceSessionsRepository(db) {
  const projection = `id, user_id AS userId, name, access_expires_at AS accessExpiresAt,
    created_at AS createdAt, refreshed_at AS refreshedAt, expires_at AS expiresAt,
    idle_expires_at AS idleExpiresAt, revoked_at AS revokedAt`;
  return Object.freeze({
    insert(s) {
      db.prepare(`INSERT INTO device_sessions
        (id,user_id,name,access_hash,access_expires_at,created_at,refreshed_at,expires_at,idle_expires_at)
        VALUES (?,?,?,?,?,?,?,?,?)`).run(s.id,s.userId,s.name,s.accessHash,s.accessExpiresAt,s.createdAt,s.createdAt,s.expiresAt,s.idleExpiresAt);
    },
    insertRefresh: (hash, id) => db.prepare('INSERT INTO device_refresh_tokens (token_hash,session_id) VALUES (?,?)').run(hash,id),
    refresh: (hash) => db.prepare('SELECT session_id AS sessionId, used_at AS usedAt FROM device_refresh_tokens WHERE token_hash=?').get(hash),
    find: (id) => db.prepare(`SELECT ${projection} FROM device_sessions WHERE id=?`).get(id),
    access: (hash) => db.prepare(`SELECT ${projection} FROM device_sessions WHERE access_hash=?`).get(hash),
    list: (id) => db.prepare(`SELECT ${projection} FROM device_sessions WHERE user_id=? ORDER BY created_at DESC,id`).all(id),
    rotate(id, oldHash, accessHash, accessExpiresAt, idleExpiresAt, now) {
      db.prepare('UPDATE device_refresh_tokens SET used_at=? WHERE token_hash=?').run(now,oldHash);
      db.prepare('UPDATE device_sessions SET access_hash=?,access_expires_at=?,idle_expires_at=?,refreshed_at=? WHERE id=?')
        .run(accessHash,accessExpiresAt,idleExpiresAt,now,id);
    },
    revoke: (id, now) => db.prepare('UPDATE device_sessions SET revoked_at=COALESCE(revoked_at,?) WHERE id=?').run(now,id),
    revokeUser: (id, now) => db.prepare('UPDATE device_sessions SET revoked_at=COALESCE(revoked_at,?) WHERE user_id=?').run(now,id),
    purge: (now) => db.prepare('DELETE FROM device_sessions WHERE expires_at<=? OR idle_expires_at<=? OR revoked_at IS NOT NULL').run(now,now),
  });
}
