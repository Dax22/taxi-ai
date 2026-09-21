const columns = `id, driver_id AS driverId, active, mode, area_id AS areaId, position_json AS positionJson,
  native_session_id AS nativeSessionId, session_hash AS sessionHash, client_hash AS clientHash, sequence, started_at AS startedAt,
  seen_at AS seenAt, stopped_at AS stoppedAt, reason`;

export function createAvailabilityRepository(db) {
  return Object.freeze({
    find: (id) => db.prepare(`SELECT ${columns} FROM driver_availability WHERE id = ?`).get(id) ?? null,
    current: (id) => db.prepare(`SELECT ${columns} FROM driver_availability WHERE driver_id = ? AND active = 1`).get(id) ?? null,
    active: () => db.prepare(`SELECT ${columns} FROM driver_availability WHERE active = 1`).all(),
    insert({ id, userId, sessionHash, nativeSessionId, clientHash, mode, areaId, position, now }) {
      db.prepare(`INSERT INTO driver_availability (id, driver_id, active, mode, area_id, position_json, session_hash, native_session_id, client_hash, sequence, started_at, seen_at)
        VALUES (?, ?, 1, ?, ?, ?, ?, ?, ?, 1, ?, ?)`).run(id, userId, mode, areaId, position ? JSON.stringify(position) : null, sessionHash, nativeSessionId, clientHash, now, now);
    },
    update(id, sequence, position, now) {
      db.prepare('UPDATE driver_availability SET sequence = ?, position_json = ?, seen_at = ? WHERE id = ? AND active = 1')
        .run(sequence, position ? JSON.stringify(position) : null, now, id);
    },
    stop(id, now, reason) {
      db.prepare(`UPDATE driver_availability SET active = 0, area_id = NULL, position_json = NULL, session_hash = NULL,
        native_session_id = NULL, client_hash = NULL, stopped_at = ?, reason = ? WHERE id = ? AND active = 1`).run(now, reason, id);
    },
    command: (actorId, key) => db.prepare('SELECT fingerprint, availability_id AS id FROM availability_commands WHERE actor_id = ? AND key = ?').get(actorId, key),
    saveCommand(actorId, key, fingerprint, id) {
      db.prepare('INSERT INTO availability_commands (actor_id, key, fingerprint, availability_id) VALUES (?, ?, ?, ?)').run(actorId, key, fingerprint, id);
    },
  });
}
