const pageLimit = (value = 200) => Math.max(1, Math.min(200, Number.isSafeInteger(value) ? value : 200));
const columns = `id, driver_id AS driverId, active, mode, area_id AS areaId, position_json AS positionJson,
  native_session_id AS nativeSessionId, session_hash AS sessionHash, client_hash AS clientHash, sequence, started_at AS startedAt,
  seen_at AS seenAt, stopped_at AS stoppedAt, reason`;

export function createAvailabilityRepository(db) {
  return Object.freeze({
    find: async (id) => (await db.prepare(`SELECT ${columns} FROM driver_availability WHERE id = ?`).get(id)) ?? null,
    current: async (id) => (await db.prepare(`SELECT ${columns} FROM driver_availability WHERE driver_id = ? AND active = 1`).get(id)) ?? null,
    activePage: async (afterId = '', limit = 200) => (await db.prepare(`SELECT ${columns} FROM driver_availability WHERE active = 1 AND id > ? ORDER BY id LIMIT ?`).all(afterId, pageLimit(limit))),
    expired: async (now, limit = 200) => (await db.prepare(`SELECT ${columns} FROM driver_availability WHERE active = 1 AND expires_at <= ? ORDER BY expires_at, id LIMIT ?`).all(now, pageLimit(limit))),
    async nearby({ mode, areaId, bounds, position, radiusMeters, now, afterId = '', limit = 200 }) {
      if (mode === 'sample') return (await db.prepare(`SELECT ${columns} FROM driver_availability
        WHERE active = 1 AND mode = 'sample' AND area_id = ? AND expires_at > ? AND id > ?
          AND NOT EXISTS (SELECT 1 FROM dispatch_offers pending WHERE pending.driver_id = driver_availability.driver_id
            AND pending.status = 'pending' AND pending.expires_at > ?) ORDER BY id LIMIT ?`)
        .all(areaId, now, afterId, now, pageLimit(limit)));
      // The index uses spheroid geography; widen its envelope slightly so the
      // shared spherical-distance rule, applied by the service, remains decisive.
      if (db.kind === 'postgres') return (await db.prepare(`SELECT ${columns} FROM driver_availability
        WHERE active = 1 AND mode = 'gps' AND ST_DWithin(location, ST_SetSRID(ST_MakePoint(?, ?), 4326)::geography, ?)
          AND expires_at > ? AND id > ?
          AND NOT EXISTS (SELECT 1 FROM dispatch_offers pending WHERE pending.driver_id = driver_availability.driver_id
            AND pending.status = 'pending' AND pending.expires_at > ?) ORDER BY id LIMIT ?`)
        .all(position.lng, position.lat, radiusMeters * 1.01, now, afterId, now, pageLimit(limit)));
      return (await db.prepare(`SELECT ${columns} FROM driver_availability
        WHERE active = 1 AND mode = 'gps' AND latitude BETWEEN ? AND ? AND longitude BETWEEN ? AND ?
          AND expires_at > ? AND id > ?
          AND NOT EXISTS (SELECT 1 FROM dispatch_offers pending WHERE pending.driver_id = driver_availability.driver_id
            AND pending.status = 'pending' AND pending.expires_at > ?) ORDER BY id LIMIT ?`)
        .all(bounds.minLat, bounds.maxLat, bounds.minLng, bounds.maxLng, now, afterId, now, pageLimit(limit)));
    },
    async insert({ id, userId, sessionHash, nativeSessionId, clientHash, mode, areaId, position, expiresAt, now }) {
      (await db.prepare(`INSERT INTO driver_availability (id, driver_id, active, mode, area_id, position_json, session_hash, native_session_id, client_hash, sequence, started_at, seen_at, expires_at, latitude, longitude)
        VALUES (?, ?, 1, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?)`).run(id, userId, mode, areaId, position ? JSON.stringify(position) : null, sessionHash, nativeSessionId, clientHash, now, now, expiresAt, position?.lat ?? null, position?.lng ?? null));
    },
    async update(id, sequence, position, now, expiresAt) {
      (await db.prepare('UPDATE driver_availability SET sequence = ?, position_json = ?, seen_at = ?, expires_at = ?, latitude = ?, longitude = ? WHERE id = ? AND active = 1')
        .run(sequence, position ? JSON.stringify(position) : null, now, expiresAt, position?.lat ?? null, position?.lng ?? null, id));
    },
    async stop(id, now, reason) {
      (await db.prepare(`UPDATE driver_availability SET active = 0, area_id = NULL, position_json = NULL, session_hash = NULL,
        native_session_id = NULL, client_hash = NULL, expires_at = NULL, latitude = NULL, longitude = NULL, stopped_at = ?, reason = ? WHERE id = ? AND active = 1`).run(now, reason, id));
    },
    command: async (actorId, key) => (await db.prepare('SELECT fingerprint, availability_id AS id FROM availability_commands WHERE actor_id = ? AND key = ?').get(actorId, key)),
    async saveCommand(actorId, key, fingerprint, id) {
      (await db.prepare('INSERT INTO availability_commands (actor_id, key, fingerprint, availability_id) VALUES (?, ?, ?, ?)').run(actorId, key, fingerprint, id));
    },
  });
}
