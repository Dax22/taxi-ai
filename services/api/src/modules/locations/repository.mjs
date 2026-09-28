const pageLimit = (value = 200) => Math.max(1, Math.min(200, Number.isSafeInteger(value) ? value : 200));
const quotes = 'id, customer_id AS customerId, created_at AS createdAt, expires_at AS expiresAt, route_json AS routeJson, ride_id AS rideId';
const shares = `id, ride_id AS rideId, driver_id AS driverId, active, session_hash AS sessionHash, client_hash AS clientHash,
  started_at AS startedAt, seen_at AS seenAt, stopped_at AS stoppedAt, sequence, position_json AS positionJson`;
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
    share: async (id) => (await db.prepare(`SELECT ${shares} FROM location_shares WHERE id = ?`).get(id)) ?? null,
    currentShare: async (rideId) => (await db.prepare(`SELECT ${shares} FROM location_shares WHERE ride_id = ? AND active = 1`).get(rideId)) ?? null,
    currentForDriver: async (driverId) => (await db.prepare(`SELECT ${shares} FROM location_shares WHERE driver_id = ? AND active = 1`).get(driverId)) ?? null,
    activePage: async (afterId = '', limit = 200) => (await db.prepare(`SELECT ${shares} FROM location_shares WHERE active = 1 AND id > ? ORDER BY id LIMIT ?`).all(afterId, pageLimit(limit))),
    expired: async (cutoff, limit = 200) => (await db.prepare(`SELECT ${shares} FROM location_shares WHERE active = 1 AND seen_at <= ? ORDER BY seen_at, id LIMIT ?`).all(cutoff, pageLimit(limit))),
    async saveShare({ id, rideId, driverId, sessionHash, clientHash, now }) {
      (await db.prepare(`INSERT INTO location_shares (id, ride_id, driver_id, active, session_hash, client_hash, started_at, seen_at)
        VALUES (?, ?, ?, 1, ?, ?, ?, ?)`).run(id, rideId, driverId, sessionHash, clientHash, now, now));
    },
    async stop(id, now) {
      (await db.prepare(`UPDATE location_shares SET active = 0, position_json = NULL, session_hash = NULL, client_hash = NULL, stopped_at = ? WHERE id = ? AND active = 1`).run(now, id));
    },
    async update(id, sequence, value, now) {
      (await db.prepare('UPDATE location_shares SET sequence = ?, position_json = ?, seen_at = ? WHERE id = ?').run(sequence, JSON.stringify(value), now, id));
    },
    shareCommand: async (actorId, key) => (await db.prepare('SELECT fingerprint, share_id AS id FROM location_share_commands WHERE actor_id = ? AND key = ?').get(actorId, key)),
    async saveShareCommand(actorId, key, fingerprint, id) {
      (await db.prepare('INSERT INTO location_share_commands (actor_id, key, fingerprint, share_id) VALUES (?, ?, ?, ?)').run(actorId, key, fingerprint, id));
    },
  });
}
