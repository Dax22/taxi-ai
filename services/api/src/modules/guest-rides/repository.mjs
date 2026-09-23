const columns = `id,ride_id AS rideId,owner_id AS ownerId,token_hash AS tokenHash,session_binding AS sessionBinding,
  active,version,created_at AS createdAt,expires_at AS expiresAt,ended_at AS endedAt,reason`;

/** Owns guest snapshots and capabilities. All writes participate in the caller's transaction. */
export function createGuestRidesRepository(db) {
  return Object.freeze({
    passenger: (rideId) => {
      const row = db.prepare('SELECT snapshot_json AS snapshot FROM guest_ride_passengers WHERE ride_id=?').get(rideId);
      return row ? JSON.parse(row.snapshot) : { kind: 'self' };
    },
    savePassenger(rideId, passenger) {
      if (passenger.kind === 'guest') db.prepare('INSERT INTO guest_ride_passengers(ride_id,snapshot_json) VALUES (?,?)').run(rideId, JSON.stringify(passenger));
    },
    link: (id) => db.prepare(`SELECT ${columns} FROM guest_ride_links WHERE id=?`).get(id) ?? null,
    latest: (rideId) => db.prepare(`SELECT ${columns} FROM guest_ride_links WHERE ride_id=? ORDER BY created_at DESC,rowid DESC LIMIT 1`).get(rideId) ?? null,
    activeLinks: () => db.prepare(`SELECT ${columns} FROM guest_ride_links WHERE active=1`).all(),
    forRide: (rideId) => db.prepare(`SELECT ${columns} FROM guest_ride_links WHERE ride_id=? AND active=1`).all(rideId),
    byToken: (hash) => db.prepare(`SELECT ${columns} FROM guest_ride_links WHERE token_hash=? AND active=1`).get(hash) ?? null,
    count: (rideId) => db.prepare('SELECT count(*) AS n FROM guest_ride_links WHERE ride_id=?').get(rideId).n,
    add({ id, rideId, ownerId, tokenHash, sessionBinding, now, expiresAt }) {
      db.prepare('INSERT INTO guest_ride_links(id,ride_id,owner_id,token_hash,session_binding,created_at,expires_at) VALUES (?,?,?,?,?,?,?)')
        .run(id, rideId, ownerId, tokenHash, sessionBinding, now, expiresAt);
    },
    end(id, now, reason) {
      db.prepare('UPDATE guest_ride_links SET active=0,token_hash=NULL,session_binding=NULL,version=version+1,ended_at=?,reason=? WHERE id=? AND active=1').run(now, reason, id);
    },
    command: (actorId, key) => db.prepare('SELECT fingerprint,link_id AS linkId FROM guest_ride_commands WHERE actor_id=? AND key=?').get(actorId, key) ?? null,
    saveCommand(actorId, key, fingerprint, linkId) {
      db.prepare('INSERT INTO guest_ride_commands(actor_id,key,fingerprint,link_id) VALUES (?,?,?,?)').run(actorId, key, fingerprint, linkId);
    },
  });
}
