const columns = `id,ride_id AS rideId,owner_id AS ownerId,command_key AS commandKey,fingerprint,
  expected_json AS expectedJson,result_json AS resultJson,state,model,consent_version AS consentVersion,
  created_at AS createdAt,completed_at AS completedAt,expires_at AS expiresAt`;
export function createVehicleChecksRepository(db) {
  return Object.freeze({
    find: async id => (await db.prepare(`SELECT ${columns} FROM vehicle_photo_checks WHERE id=?`).get(id)),
    command: async (owner,key) => (await db.prepare(`SELECT ${columns} FROM vehicle_photo_checks WHERE owner_id=? AND command_key=?`).get(owner,key)),
    list: async (owner,ride) => (await db.prepare(`SELECT ${columns} FROM vehicle_photo_checks WHERE owner_id=? AND ride_id=? ORDER BY created_at DESC,id DESC LIMIT 5`).all(owner,ride)),
    async limits(owner,ride,since) { return (await db.prepare(`SELECT count(*) AS total,
      sum(CASE WHEN owner_id=? THEN 1 ELSE 0 END) AS actor,
      sum(CASE WHEN owner_id=? AND ride_id=? THEN 1 ELSE 0 END) AS trip,
      sum(CASE WHEN state='pending' THEN 1 ELSE 0 END) AS pending
      FROM vehicle_photo_checks WHERE created_at>?`).get(owner,owner,ride,since)); },
    async add(row) { (await db.prepare(`INSERT INTO vehicle_photo_checks(id,ride_id,owner_id,command_key,fingerprint,expected_json,state,model,consent_version,created_at,expires_at)
      VALUES (?,?,?,?,?,?,'pending',?,?,?,?)`).run(row.id,row.rideId,row.ownerId,row.key,row.fingerprint,JSON.stringify(row.expected),row.model,row.consentVersion,row.now,row.now+86_400_000)); },
    async finish(id,state,result,now) { return (await db.prepare(`UPDATE vehicle_photo_checks SET state=?,result_json=?,completed_at=? WHERE id=? AND state='pending'`)
      .run(state,result ? JSON.stringify(result) : null,now,id)).changes; },
    async sweep(now) {
      (await db.prepare('DELETE FROM vehicle_photo_checks WHERE expires_at<=?').run(now));
      (await db.prepare("UPDATE vehicle_photo_checks SET state='unavailable',completed_at=? WHERE state='pending' AND created_at<=?").run(now,now-60_000));
    },
  });
}
