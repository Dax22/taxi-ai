const columns = `id, customer_id AS customerId, driver_id AS driverId,
  pickup_id AS pickupId, destination_id AS destinationId,
  suggested_fare_kobo AS suggestedFareKobo, vehicle_category AS vehicleCategory, status, version,
  created_at AS createdAt, matched_at AS matchedAt, updated_at AS updatedAt,
  driver_snapshot_json AS driverSnapshotJson, request_expires_at AS requestExpiresAt, closed_reason AS closedReason`;

const tripColumns = `ride_id AS rideId, customer_id AS customerId, driver_id AS driverId, status,
  fare_kobo AS fareKobo, booked_at AS bookedAt, departed_at AS departedAt, arrived_at AS arrivedAt,
  started_at AS startedAt, completed_at AS completedAt, pickup_pin AS pickupPin,
  pin_failures AS pinFailures, pin_blocked_until AS pinBlockedUntil`;
const activeTrip = "SELECT 1 FROM ride_trips t WHERE t.ride_id = rides.id AND t.status NOT IN ('completed', 'cancelled')";

/** Owns ride, fare, trip, activity and retry SQL. All writes join the caller's transaction. */
export function createRidesRepository(db) {
  return Object.freeze({
    find: (id) => db.prepare(`SELECT ${columns} FROM rides WHERE id = ?`).get(id) ?? null,
    listFor: (id, mode = null) => db.prepare(`SELECT ${columns} FROM rides WHERE
      ((? IS NULL OR ? = 'customer') AND customer_id = ? OR (? IS NULL OR ? = 'work') AND driver_id = ?)
      ORDER BY (status IN ('requested', 'negotiating') OR EXISTS (${activeTrip})) DESC, created_at DESC, id DESC LIMIT 50`).all(mode, mode, id, mode, mode, id),
    activeFor: (id) => db.prepare(`SELECT ${columns} FROM rides WHERE (customer_id = ? OR driver_id = ?)
      AND (status IN ('requested', 'negotiating') OR (status='agreed' AND
        (NOT EXISTS (SELECT 1 FROM ride_trips t WHERE t.ride_id=rides.id) OR EXISTS (${activeTrip}))))
      ORDER BY created_at DESC, id DESC`).all(id, id),
    listAvailable: () => db.prepare(`SELECT ${columns} FROM rides WHERE status = 'requested' ORDER BY created_at, id`).all(),
    expiring: (now) => db.prepare(`SELECT ${columns} FROM rides WHERE status = 'requested' AND request_expires_at <= ?`).all(now),
    expire(id, now) {
      db.prepare(`UPDATE rides SET status = 'cancelled', closed_reason = 'request_expired', version = version + 1, updated_at = ?
        WHERE id = ? AND status = 'requested' AND request_expires_at <= ?`).run(now, id, now);
    },
    hasHistory: (id) => Boolean(db.prepare('SELECT id FROM rides WHERE customer_id = ?').get(id)),
    hasOpenRequest: (id) => Boolean(db.prepare(`SELECT id FROM rides WHERE customer_id = ?
      AND (status IN ('requested', 'negotiating') OR EXISTS (${activeTrip}))`).get(id)),
    hasNegotiation: (id) => Boolean(db.prepare(`SELECT id FROM rides WHERE driver_id = ?
      AND (status = 'negotiating' OR EXISTS (${activeTrip}))`).get(id)),
    hasCustomerWork: (id, now) => Boolean(db.prepare(`SELECT id FROM rides WHERE customer_id=? AND
      ((status='requested' AND request_expires_at>?) OR status='negotiating' OR
        (status='agreed' AND (NOT EXISTS (SELECT 1 FROM ride_trips t WHERE t.ride_id=rides.id) OR EXISTS (${activeTrip}))))`).get(id, now)),
    hasDriverWork: (id) => Boolean(db.prepare(`SELECT id FROM rides WHERE driver_id=? AND
      (status='negotiating' OR (status='agreed' AND (NOT EXISTS (SELECT 1 FROM ride_trips t WHERE t.ride_id=rides.id)
        OR EXISTS (${activeTrip}))))`).get(id)),
    insert({ id, customerId, pickupId, destinationId, suggestedFareKobo, vehicleCategory = 'standard', now, expiresAt }) {
      db.prepare(`INSERT INTO rides (id, customer_id, pickup_id, destination_id, suggested_fare_kobo, created_at, updated_at, request_expires_at, vehicle_category)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(id, customerId, pickupId, destinationId, suggestedFareKobo, now, now, expiresAt, vehicleCategory);
    },
    claim({ id, driverId, driverSnapshot, expectedVersion, now }) {
      return db.prepare(`UPDATE rides SET driver_id = ?, driver_snapshot_json = ?, matched_at = ?, updated_at = ?, status = 'negotiating',
        version = version + 1 WHERE id = ? AND version = ? AND status = 'requested'`)
        .run(driverId, JSON.stringify(driverSnapshot), now, now, id, expectedVersion).changes === 1;
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
    findCommand: (actorId, key) => db.prepare('SELECT fingerprint, ride_id AS rideId, error_code AS errorCode FROM idempotency WHERE actor_id = ? AND key = ?')
      .get(actorId, key) ?? null,
    saveCommand(actorId, key, fingerprint, rideId, errorCode = null) {
      db.prepare('INSERT INTO idempotency (actor_id, key, fingerprint, ride_id, error_code) VALUES (?, ?, ?, ?, ?)')
        .run(actorId, key, fingerprint, rideId, errorCode);
    },
    findTrip: (id) => db.prepare(`SELECT ${tripColumns} FROM ride_trips WHERE ride_id = ?`).get(id) ?? null,
    bookTrip({ ride, fareKobo, pin, now }) {
      db.prepare(`INSERT INTO ride_trips (ride_id, customer_id, driver_id, status, fare_kobo, booked_at, pickup_pin)
        VALUES (?, ?, ?, 'booked', ?, ?, ?)`).run(ride.id, ride.customerId, ride.driverId, fareKobo, now, pin);
    },
    updateTrip(id, status, now) {
      // Column names are fixed by the transition vocabulary, never supplied by HTTP.
      const column = { on_way: 'departed_at', arrived: 'arrived_at', in_progress: 'started_at', completed: 'completed_at' }[status];
      const terminalPin = ['in_progress', 'completed', 'cancelled'].includes(status);
      db.prepare(`UPDATE ride_trips SET status = ?${column ? `, ${column} = ?` : ''}
        ${terminalPin ? ', pickup_pin = NULL, pin_failures = 0, pin_blocked_until = NULL' : ''} WHERE ride_id = ?`)
        .run(status, ...(column ? [now] : []), id);
    },
    failPin(id, failures, blockedUntil) {
      db.prepare('UPDATE ride_trips SET pin_failures = ?, pin_blocked_until = ? WHERE ride_id = ?').run(failures, blockedUntil, id);
    },
    appendActivity(id, actorId, type, now, reason = null) {
      db.prepare('INSERT INTO ride_activity (ride_id, actor_id, type, reason, created_at) VALUES (?, ?, ?, ?, ?)')
        .run(id, actorId, type, reason, now);
    },
    activity: (id) => db.prepare(`SELECT id, actor_id AS actorId, type, reason, created_at AS createdAt
      FROM ride_activity WHERE ride_id = ? ORDER BY id`).all(id),
    history: (userId, before, limit, mode = null) => db.prepare(`SELECT ${columns} FROM rides
      WHERE ((? IS NULL OR ? = 'customer') AND customer_id = ? OR (? IS NULL OR ? = 'work') AND driver_id = ?) AND (status = 'cancelled'
        OR EXISTS (SELECT 1 FROM ride_trips t WHERE t.ride_id = rides.id AND t.status = 'completed'))
        AND (? IS NULL OR updated_at < ? OR (updated_at = ? AND id < ?))
      ORDER BY updated_at DESC, id DESC LIMIT ?`)
      .all(mode, mode, userId, mode, mode, userId, before?.id ?? null, before?.updatedAt ?? null, before?.updatedAt ?? null, before?.id ?? null, limit),
  });
}
