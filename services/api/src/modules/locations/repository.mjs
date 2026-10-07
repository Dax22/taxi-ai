const pageLimit = (value = 200) => Math.max(1, Math.min(200, Number.isSafeInteger(value) ? value : 200));
const quotes = 'id, customer_id AS customerId, created_at AS createdAt, expires_at AS expiresAt, route_json AS routeJson, ride_id AS rideId';
const parseQuote = (row) => row ? { ...row, route: JSON.parse(row.routeJson) } : null;
export function createLocationsRepository(db) {
  return Object.freeze({
    quote: async (id) => parseQuote((await db.prepare(`SELECT ${quotes} FROM location_quotes WHERE id = ?`).get(id))),
    rideRoute: async (id) => parseQuote((await db.prepare(`SELECT ${quotes} FROM location_quotes WHERE ride_id = ?`).get(id)))?.route ?? null,
    recentQuotes: async (userId, since) => (await db.prepare('SELECT count(*) AS n FROM location_quotes WHERE customer_id = ? AND created_at > ?').get(userId, since)).n,
    async saveQuote({ id, userId, now, expiresAt, route }) {
      (await db.prepare('INSERT INTO location_quotes (id, customer_id, created_at, expires_at, route_json) VALUES (?, ?, ?, ?, ?)')
        .run(id, userId, now, expiresAt, JSON.stringify(route)));
    },
    bindQuote: async (id, rideId) => (await db.prepare('UPDATE location_quotes SET ride_id = ? WHERE id = ? AND ride_id IS NULL').run(rideId, id)).changes === 1,
    quoteCommand: async (actorId, key) => (await db.prepare('SELECT fingerprint, quote_id AS id FROM location_quote_commands WHERE actor_id = ? AND key = ?').get(actorId, key)),
    async saveQuoteCommand(actorId, key, fingerprint, id) {
      (await db.prepare('INSERT INTO location_quote_commands (actor_id, key, fingerprint, quote_id) VALUES (?, ?, ?, ?)').run(actorId, key, fingerprint, id));
    },
    async pruneQuotes(now, limit = 200) { (await db.prepare(`DELETE FROM location_quotes WHERE id IN
      (SELECT id FROM location_quotes WHERE ride_id IS NULL AND expires_at < ? ORDER BY expires_at, id LIMIT ?)`).run(now - 60 * 60_000, pageLimit(limit))); },
    ...trackingRepository(db, false),
  });
}

/** Both job types use the same storage contract and lease engine; table names are
 * fixed here, never supplied by requests. */
function trackingRepository(db, food) {
  const table = food ? 'eats_location_shares' : 'location_shares';
  const commands = food ? 'eats_location_commands' : 'location_share_commands';
  const resourceColumn = food ? 'order_id' : 'ride_id';
  const resourceKind = food ? 'food' : 'ride';
  const shares = `id, ${resourceColumn} AS rideId, driver_id AS driverId, active, session_hash AS sessionHash, client_hash AS clientHash,
    started_at AS startedAt, seen_at AS seenAt, stopped_at AS stoppedAt, sequence, position_json AS positionJson`;
  return {
    share: async (id) => (await db.prepare(`SELECT ${shares} FROM ${table} WHERE id = ?`).get(id)) ?? null,
    currentShare: async (rideId) => (await db.prepare(`SELECT ${shares} FROM ${table} WHERE ${resourceColumn} = ? AND active = 1`).get(rideId)) ?? null,
    currentForDriver: async (driverId) => (await db.prepare(`SELECT ${shares} FROM ${table} WHERE driver_id = ? AND active = 1`).get(driverId)) ?? null,
    activePage: async (afterId = '', limit = 200) => (await db.prepare(`SELECT ${shares} FROM ${table} WHERE active = 1 AND id > ? ORDER BY id LIMIT ?`).all(afterId, pageLimit(limit))),
    expired: async (cutoff, limit = 200) => (await db.prepare(`SELECT ${shares} FROM ${table} WHERE active = 1 AND seen_at <= ? ORDER BY seen_at, id LIMIT ?`).all(cutoff, pageLimit(limit))),
    async saveShare({ id, rideId, driverId, sessionHash, clientHash, now }) {
      return (await db.prepare(`INSERT INTO ${table} (id, ${resourceColumn}, driver_id, active, session_hash, client_hash, started_at, seen_at)
        VALUES (?, ?, ?, 1, ?, ?, ?, ?) ON CONFLICT DO NOTHING`).run(id, rideId, driverId, sessionHash, clientHash, now, now)).changes === 1;
    },
    async stop(id, now) {
      (await db.prepare(`UPDATE ${table} SET active = 0, position_json = NULL, session_hash = NULL, client_hash = NULL, stopped_at = ? WHERE id = ? AND active = 1`).run(now, id));
    },
    async update(id, sequence, value, now) {
      (await db.prepare(`UPDATE ${table} SET sequence = ?, position_json = ?, seen_at = ? WHERE id = ?`).run(sequence, JSON.stringify(value), now, id));
    },
    async recordEvidence({ shareId, rideId, driverId, sequence, value, now, force = false }) {
      const last = await db.prepare(`SELECT captured_at AS capturedAt FROM investigation_location_evidence
        WHERE resource_kind=? AND share_id=? ORDER BY captured_at DESC,sequence DESC LIMIT 1`).get(resourceKind, shareId);
      if (!force && last && value.capturedAt < Number(last.capturedAt) + 15_000) return false;
      return (await db.prepare(`INSERT INTO investigation_location_evidence
        (resource_kind,transaction_id,share_id,driver_id,sequence,latitude,longitude,accuracy_meters,captured_at,recorded_at)
        VALUES (?,?,?,?,?,?,?,?,?,?) ON CONFLICT(resource_kind,share_id,sequence) DO NOTHING`)
        .run(resourceKind, rideId, shareId, driverId, sequence, value.lat, value.lng, value.accuracy, value.capturedAt, now)).changes === 1;
    },
    async pruneEvidence(before) {
      await db.prepare('DELETE FROM investigation_location_evidence WHERE resource_kind=? AND recorded_at<?').run(resourceKind, before);
    },
    shareCommand: async (actorId, key) => (await db.prepare(`SELECT fingerprint, share_id AS id FROM ${commands} WHERE actor_id = ? AND key = ?`).get(actorId, key)),
    async saveShareCommand(actorId, key, fingerprint, id) {
      (await db.prepare(`INSERT INTO ${commands} (actor_id, key, fingerprint, share_id) VALUES (?, ?, ?, ?)`).run(actorId, key, fingerprint, id));
    },
  };
}
export function createFoodTrackingRepository(db) {
  return Object.freeze({ ...trackingRepository(db, true), pruneQuotes: async () => {} });
}
