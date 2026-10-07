const columns = 'id,ride_id AS rideId,actor_id AS actorId,kind,note,created_at AS createdAt,version,command_key AS commandKey,fingerprint';
export function createDeliveryOperationsRepository(db) {
  return Object.freeze({
    events: id => db.prepare(`SELECT ${columns} FROM delivery_exception_events WHERE ride_id=? ORDER BY version LIMIT 100`).all(id),
    command: (actorId, key) => db.prepare(`SELECT ${columns} FROM delivery_exception_events WHERE actor_id=? AND command_key=?`).get(actorId, key),
    append: row => db.prepare(`INSERT INTO delivery_exception_events(id,ride_id,actor_id,kind,note,created_at,version,command_key,fingerprint)
      VALUES(?,?,?,?,?,?,?,?,?)`).run(row.id, row.rideId, row.actorId, row.kind, row.note, row.createdAt, row.version, row.commandKey, row.fingerprint),
    evidence: id => db.prepare(`SELECT ride_id AS rideId,courier_id AS courierId,verified_at AS verifiedAt,
      verification_method AS method,position_recorded AS positionRecorded,position_json AS positionJson FROM delivery_handover_evidence WHERE ride_id=?`).get(id),
  });
}
