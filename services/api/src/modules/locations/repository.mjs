const quotes = 'id, customer_id AS customerId, created_at AS createdAt, expires_at AS expiresAt, route_json AS routeJson, ride_id AS rideId';
const shares = `id, ride_id AS rideId, driver_id AS driverId, active, session_hash AS sessionHash, client_hash AS clientHash,
  started_at AS startedAt, seen_at AS seenAt, stopped_at AS stoppedAt, sequence, position_json AS positionJson`;
const parseQuote = (row) => row ? { ...row, route: JSON.parse(row.routeJson) } : null;
export function createLocationsRepository(db) {
  return Object.freeze({
    quote: (id) => parseQuote(db.prepare(`SELECT ${quotes} FROM location_quotes WHERE id = ?`).get(id)),
    rideRoute: (id) => parseQuote(db.prepare(`SELECT ${quotes} FROM location_quotes WHERE ride_id = ?`).get(id))?.route ?? null,
    recentQuotes: (userId, since) => db.prepare('SELECT count(*) AS n FROM location_quotes WHERE customer_id = ? AND created_at > ?').get(userId, since).n,
    saveQuote({ id, userId, now, expiresAt, route }) {
      db.prepare('INSERT INTO location_quotes (id, customer_id, created_at, expires_at, route_json) VALUES (?, ?, ?, ?, ?)')
        .run(id, userId, now, expiresAt, JSON.stringify(route));
    },
    bindQuote: (id, rideId) => db.prepare('UPDATE location_quotes SET ride_id = ? WHERE id = ? AND ride_id IS NULL').run(rideId, id).changes === 1,
    quoteCommand: (actorId, key) => db.prepare('SELECT fingerprint, quote_id AS id FROM location_quote_commands WHERE actor_id = ? AND key = ?').get(actorId, key),
    saveQuoteCommand(actorId, key, fingerprint, id) {
      db.prepare('INSERT INTO location_quote_commands (actor_id, key, fingerprint, quote_id) VALUES (?, ?, ?, ?)').run(actorId, key, fingerprint, id);
    },
    pruneQuotes(now) { db.prepare('DELETE FROM location_quotes WHERE ride_id IS NULL AND expires_at < ?').run(now - 60 * 60_000); },
    share: (id) => db.prepare(`SELECT ${shares} FROM location_shares WHERE id = ?`).get(id) ?? null,
    currentShare: (rideId) => db.prepare(`SELECT ${shares} FROM location_shares WHERE ride_id = ? AND active = 1`).get(rideId) ?? null,
    activeShares: () => db.prepare(`SELECT ${shares} FROM location_shares WHERE active = 1`).all(),
    saveShare({ id, rideId, driverId, sessionHash, clientHash, now }) {
      db.prepare(`INSERT INTO location_shares (id, ride_id, driver_id, active, session_hash, client_hash, started_at, seen_at)
        VALUES (?, ?, ?, 1, ?, ?, ?, ?)`).run(id, rideId, driverId, sessionHash, clientHash, now, now);
    },
    stop(id, now) {
      db.prepare(`UPDATE location_shares SET active = 0, position_json = NULL, session_hash = NULL, client_hash = NULL, stopped_at = ? WHERE id = ? AND active = 1`).run(now, id);
    },
    update(id, sequence, value, now) {
      db.prepare('UPDATE location_shares SET sequence = ?, position_json = ?, seen_at = ? WHERE id = ?').run(sequence, JSON.stringify(value), now, id);
    },
    shareCommand: (actorId, key) => db.prepare('SELECT fingerprint, share_id AS id FROM location_share_commands WHERE actor_id = ? AND key = ?').get(actorId, key),
    saveShareCommand(actorId, key, fingerprint, id) {
      db.prepare('INSERT INTO location_share_commands (actor_id, key, fingerprint, share_id) VALUES (?, ?, ?, ?)').run(actorId, key, fingerprint, id);
    },
  });
}
