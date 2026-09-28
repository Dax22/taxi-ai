const columns = `id,ride_id AS rideId,owner_id AS ownerId,token_hash AS tokenHash,
  recipient_id AS recipientId,claimed_at AS claimedAt,active,version,created_at AS createdAt,
  expires_at AS expiresAt,ended_at AS endedAt,reason`;

/** Account-bound recipient grants; only hashes of manually shared invitations are stored. */
export function createParcelTrackingRepository(db) {
  return Object.freeze({
    link: async id => await db.prepare(`SELECT ${columns} FROM parcel_tracking_links WHERE id=?`).get(id) ?? null,
    latest: async rideId => await db.prepare(`SELECT ${columns} FROM parcel_tracking_links WHERE ride_id=? ORDER BY sequence DESC LIMIT 1`).get(rideId) ?? null,
    byToken: async hash => await db.prepare(`SELECT ${columns} FROM parcel_tracking_links WHERE token_hash=? AND active=1`).get(hash) ?? null,
    received: async (userId, rideId) => await db.prepare(`SELECT ${columns} FROM parcel_tracking_links WHERE recipient_id=? AND ride_id=? AND active=1`).get(userId, rideId) ?? null,
    listReceived: async userId => await db.prepare(`SELECT ${columns} FROM parcel_tracking_links WHERE recipient_id=? AND active=1 ORDER BY claimed_at DESC,id DESC LIMIT 50`).all(userId),
    count: async rideId => (await db.prepare('SELECT count(*) AS n FROM parcel_tracking_links WHERE ride_id=?').get(rideId)).n,
    async add({ id, rideId, ownerId, tokenHash, now, expiresAt }) {
      await db.prepare(`INSERT INTO parcel_tracking_links(id,ride_id,owner_id,token_hash,created_at,expires_at) VALUES (?,?,?,?,?,?)`)
        .run(id, rideId, ownerId, tokenHash, now, expiresAt);
    },
    async claim(id, userId, now) {
      return (await db.prepare(`UPDATE parcel_tracking_links SET recipient_id=?,claimed_at=?,version=version+1
        WHERE id=? AND active=1 AND recipient_id IS NULL AND expires_at>?`).run(userId, now, id, now)).changes === 1;
    },
    async end(id, now, reason) {
      await db.prepare(`UPDATE parcel_tracking_links SET active=0,token_hash=NULL,version=version+1,ended_at=?,reason=? WHERE id=? AND active=1`).run(now, reason, id);
    },
    command: async (userId, key) => await db.prepare('SELECT fingerprint,link_id AS linkId FROM parcel_tracking_commands WHERE actor_id=? AND key=?').get(userId, key) ?? null,
    async saveCommand(userId, key, fingerprint, linkId) {
      await db.prepare('INSERT INTO parcel_tracking_commands(actor_id,key,fingerprint,link_id) VALUES (?,?,?,?)').run(userId, key, fingerprint, linkId);
    },
  });
}
