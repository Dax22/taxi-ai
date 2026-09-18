const columns = `id, customer_id AS customerId, driver_id AS driverId,
  pickup_id AS pickupId, destination_id AS destinationId,
  suggested_fare_kobo AS suggestedFareKobo, status, version,
  created_at AS createdAt, matched_at AS matchedAt, updated_at AS updatedAt`;

/** Owns rides, fare_events and idempotency SQL. Writes join the caller's transaction. */
export function createRidesRepository(db) {
  return Object.freeze({
    find: (id) => db.prepare(`SELECT ${columns} FROM rides WHERE id = ?`).get(id) ?? null,
    listFor: (id) => db.prepare(`SELECT ${columns} FROM rides WHERE customer_id = ? OR driver_id = ?
      ORDER BY created_at DESC, id DESC LIMIT 50`).all(id, id),
    listAvailable: () => db.prepare(`SELECT ${columns} FROM rides WHERE status = 'requested' ORDER BY created_at, id LIMIT 50`).all(),
    hasHistory: (id) => Boolean(db.prepare('SELECT id FROM rides WHERE customer_id = ?').get(id)),
    hasOpenRequest: (id) => Boolean(db.prepare("SELECT id FROM rides WHERE customer_id = ? AND status IN ('requested', 'negotiating')").get(id)),
    hasNegotiation: (id) => Boolean(db.prepare("SELECT id FROM rides WHERE driver_id = ? AND status = 'negotiating'").get(id)),
    insert({ id, customerId, pickupId, destinationId, suggestedFareKobo, now }) {
      db.prepare(`INSERT INTO rides (id, customer_id, pickup_id, destination_id, suggested_fare_kobo, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)`).run(id, customerId, pickupId, destinationId, suggestedFareKobo, now, now);
    },
    claim({ id, driverId, expectedVersion, now }) {
      return db.prepare(`UPDATE rides SET driver_id = ?, matched_at = ?, updated_at = ?, status = 'negotiating',
        version = version + 1 WHERE id = ? AND version = ? AND status = 'requested'`)
        .run(driverId, now, now, id, expectedVersion).changes === 1;
    },
    updateState({ id, status, expectedVersion, now }) {
      return db.prepare('UPDATE rides SET status = ?, version = version + 1, updated_at = ? WHERE id = ? AND version = ?')
        .run(status, now, id, expectedVersion).changes === 1;
    },
    listFareEvents: (id) => db.prepare('SELECT version, type, payload FROM fare_events WHERE ride_id = ? ORDER BY version').all(id)
      .map((event) => ({ ...event, payload: JSON.parse(event.payload) })),
    appendFareEvent(id, version, type, payload) {
      db.prepare('INSERT INTO fare_events (ride_id, version, type, payload) VALUES (?, ?, ?, ?)').run(id, version, type, JSON.stringify(payload));
    },
    findCommand: (actorId, key) => db.prepare('SELECT fingerprint, ride_id AS rideId FROM idempotency WHERE actor_id = ? AND key = ?')
      .get(actorId, key) ?? null,
    saveCommand(actorId, key, fingerprint, rideId) {
      db.prepare('INSERT INTO idempotency (actor_id, key, fingerprint, ride_id) VALUES (?, ?, ?, ?)').run(actorId, key, fingerprint, rideId);
    },
  });
}
