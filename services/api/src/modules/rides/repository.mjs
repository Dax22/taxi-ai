const columns = `id, customer_id AS customerId, driver_id AS driverId,
  pickup_id AS pickupId, destination_id AS destinationId, dispatch_region AS dispatchRegion,
  suggested_fare_kobo AS suggestedFareKobo, vehicle_category AS vehicleCategory, status, version,
  created_at AS createdAt, matched_at AS matchedAt, updated_at AS updatedAt,
  driver_snapshot_json AS driverSnapshotJson, request_expires_at AS requestExpiresAt, closed_reason AS closedReason`;

const tripColumns = `ride_id AS rideId, customer_id AS customerId, driver_id AS driverId, status,
  fare_kobo AS fareKobo, payment_mode AS paymentMode, booked_at AS bookedAt, departed_at AS departedAt, arrived_at AS arrivedAt,
  started_at AS startedAt, completed_at AS completedAt, pickup_pin AS pickupPin,
  pin_failures AS pinFailures, pin_blocked_until AS pinBlockedUntil`;
const activeTrip = "SELECT 1 FROM ride_trips t WHERE t.ride_id = rides.id AND t.status NOT IN ('completed', 'cancelled')";

/** Owns ride, fare, trip, activity and retry SQL. All writes join the caller's transaction. */
export function createRidesRepository(db) {
  return Object.freeze({
    find: async (id) => (await db.prepare(`SELECT ${columns} FROM rides WHERE id = ?`).get(id)) ?? null,
    listFor: async (id, mode = null) => (await db.prepare(`SELECT ${columns} FROM rides WHERE
      ((? IS NULL OR ? = 'customer') AND customer_id = ? OR (? IS NULL OR ? = 'work') AND driver_id = ?)
      ORDER BY (status IN ('requested', 'negotiating') OR EXISTS (${activeTrip})) DESC, created_at DESC, id DESC LIMIT 50`).all(mode, mode, id, mode, mode, id)),
    activeFor: async (id) => (await db.prepare(`SELECT ${columns} FROM rides WHERE (customer_id = ? OR driver_id = ?)
      AND (status IN ('requested', 'negotiating') OR (status='agreed' AND
        (NOT EXISTS (SELECT 1 FROM ride_trips t WHERE t.ride_id=rides.id) OR EXISTS (${activeTrip}))))
      ORDER BY created_at DESC, id DESC`).all(id, id)),
    async listAvailable({ region = null, after = null, limit = 200, now = null } = {}) {
      const clauses = ["status = 'requested'"], args = [];
      if (region !== null) { clauses.push('dispatch_region = ?'); args.push(region); }
      if (now !== null) { clauses.push('request_expires_at > ?'); args.push(now); }
      if (after) { clauses.push('(created_at > ? OR (created_at = ? AND id > ?))'); args.push(after.createdAt, after.createdAt, after.id); }
      return await db.prepare(`SELECT ${columns} FROM rides WHERE ${clauses.join(' AND ')} ORDER BY created_at, id LIMIT ?`)
        .all(...args, Math.max(1, Math.min(200, Number.isSafeInteger(limit) ? limit : 200)));
    },
    expiring: async (now) => (await db.prepare(`SELECT ${columns} FROM rides WHERE status = 'requested' AND request_expires_at <= ? ORDER BY request_expires_at, id LIMIT 200`).all(now)),
    expiringForUser: async (userId, now) => await db.prepare(`SELECT ${columns} FROM rides WHERE customer_id = ?
      AND status = 'requested' AND request_expires_at <= ? ORDER BY request_expires_at, id LIMIT 200`).all(userId, now),
    async expire(id, now) {
      return (await db.prepare(`UPDATE rides SET status = 'cancelled', closed_reason = 'request_expired', version = version + 1, updated_at = ?
        WHERE id = ? AND status = 'requested' AND request_expires_at <= ?`).run(now, id, now)).changes === 1;
    },
    hasHistory: async (id) => Boolean((await db.prepare('SELECT id FROM rides WHERE customer_id = ?').get(id))),
    hasOpenRequest: async (id) => Boolean((await db.prepare(`SELECT id FROM rides WHERE customer_id = ?
      AND (status IN ('requested', 'negotiating') OR EXISTS (${activeTrip}))`).get(id))),
    hasNegotiation: async (id) => Boolean((await db.prepare(`SELECT id FROM rides WHERE driver_id = ?
      AND (status = 'negotiating' OR EXISTS (${activeTrip}))`).get(id))),
    hasCustomerWork: async (id, now) => Boolean((await db.prepare(`SELECT id FROM rides WHERE customer_id=? AND
      ((status='requested' AND request_expires_at>?) OR status='negotiating' OR
        (status='agreed' AND (NOT EXISTS (SELECT 1 FROM ride_trips t WHERE t.ride_id=rides.id) OR EXISTS (${activeTrip}))))`).get(id, now))),
    hasDriverWork: async (id) => Boolean((await db.prepare(`SELECT id FROM rides WHERE driver_id=? AND
      (status='negotiating' OR (status='agreed' AND (NOT EXISTS (SELECT 1 FROM ride_trips t WHERE t.ride_id=rides.id)
        OR EXISTS (${activeTrip}))))`).get(id))),
    async insert({ id, customerId, pickupId, destinationId, suggestedFareKobo, vehicleCategory = 'standard', region, now, expiresAt }) {
      (await db.prepare(`INSERT INTO rides (id, customer_id, pickup_id, destination_id, suggested_fare_kobo, created_at, updated_at, request_expires_at, vehicle_category, dispatch_region)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(id, customerId, pickupId, destinationId, suggestedFareKobo, now, now, expiresAt, vehicleCategory, region));
    },
    async claim({ id, driverId, driverSnapshot, expectedVersion, now }) {
      return (await db.prepare(`UPDATE rides SET driver_id = ?, driver_snapshot_json = ?, matched_at = ?, updated_at = ?, status = 'negotiating',
        version = version + 1 WHERE id = ? AND version = ? AND status = 'requested'`)
        .run(driverId, JSON.stringify(driverSnapshot), now, now, id, expectedVersion)).changes === 1;
    },
    async updateState({ id, status, expectedVersion, now }) {
      return (await db.prepare('UPDATE rides SET status = ?, version = version + 1, updated_at = ? WHERE id = ? AND version = ?')
        .run(status, now, id, expectedVersion)).changes === 1;
    },
    listFareEvents: async (id) => (await db.prepare('SELECT version, type, payload FROM fare_events WHERE ride_id = ? ORDER BY version').all(id))
      .map((event) => ({ ...event, payload: JSON.parse(event.payload) })),
    async appendFareEvent(id, version, type, payload) {
      (await db.prepare('INSERT INTO fare_events (ride_id, version, type, payload) VALUES (?, ?, ?, ?)').run(id, version, type, JSON.stringify(payload)));
    },
    findCommand: async (actorId, key) => (await db.prepare('SELECT fingerprint, ride_id AS rideId, error_code AS errorCode FROM idempotency WHERE actor_id = ? AND key = ?')
      .get(actorId, key)) ?? null,
    async saveCommand(actorId, key, fingerprint, rideId, errorCode = null) {
      (await db.prepare('INSERT INTO idempotency (actor_id, key, fingerprint, ride_id, error_code) VALUES (?, ?, ?, ?, ?)')
        .run(actorId, key, fingerprint, rideId, errorCode));
    },
    findTrip: async (id) => (await db.prepare(`SELECT ${tripColumns} FROM ride_trips WHERE ride_id = ?`).get(id)) ?? null,
    rating: async (id) => (await db.prepare('SELECT stars FROM ride_driver_ratings WHERE ride_id = ?').get(id))?.stars ?? null,
    async saveRating(ride, stars, now) {
      return (await db.prepare('INSERT OR IGNORE INTO ride_driver_ratings (ride_id, customer_id, driver_id, stars, created_at) VALUES (?, ?, ?, ?, ?)')
        .run(ride.id, ride.customerId, ride.driverId, stars, now)).changes === 1;
    },
    async bookTrip({ ride, fareKobo, paymentMode = 'simulation', pin, now }) {
      (await db.prepare(`INSERT INTO ride_trips (ride_id, customer_id, driver_id, status, fare_kobo, payment_mode, booked_at, pickup_pin)
        VALUES (?, ?, ?, 'booked', ?, ?, ?, ?)`).run(ride.id, ride.customerId, ride.driverId, fareKobo, paymentMode, now, pin));
    },
    async updateTrip(id, status, now) {
      // Column names are fixed by the transition vocabulary, never supplied by HTTP.
      const column = { on_way: 'departed_at', arrived: 'arrived_at', in_progress: 'started_at', completed: 'completed_at' }[status];
      const terminalPin = ['in_progress', 'completed', 'cancelled'].includes(status);
      (await db.prepare(`UPDATE ride_trips SET status = ?${column ? `, ${column} = ?` : ''}
        ${terminalPin ? ', pickup_pin = NULL, pin_failures = 0, pin_blocked_until = NULL' : ''} WHERE ride_id = ?`)
        .run(status, ...(column ? [now] : []), id));
    },
    async failPin(id, failures, blockedUntil) {
      (await db.prepare('UPDATE ride_trips SET pin_failures = ?, pin_blocked_until = ? WHERE ride_id = ?').run(failures, blockedUntil, id));
    },
    async appendActivity(id, actorId, type, now, reason = null) {
      (await db.prepare('INSERT INTO ride_activity (ride_id, actor_id, type, reason, created_at) VALUES (?, ?, ?, ?, ?)')
        .run(id, actorId, type, reason, now));
    },
    activity: async (id) => (await db.prepare(`SELECT id, actor_id AS actorId, type, reason, created_at AS createdAt
      FROM ride_activity WHERE ride_id = ? ORDER BY id`).all(id)),
    history: async (userId, before, limit, mode = null) => (await db.prepare(`SELECT ${columns} FROM rides
      WHERE ((? IS NULL OR ? = 'customer') AND customer_id = ? OR (? IS NULL OR ? = 'work') AND driver_id = ?) AND (status = 'cancelled'
        OR EXISTS (SELECT 1 FROM ride_trips t WHERE t.ride_id = rides.id AND t.status = 'completed'))
        AND (? IS NULL OR updated_at < ? OR (updated_at = ? AND id < ?))
      ORDER BY updated_at DESC, id DESC LIMIT ?`)
      .all(mode, mode, userId, mode, mode, userId, before?.id ?? null, before?.updatedAt ?? null, before?.updatedAt ?? null, before?.id ?? null, limit)),
  });
}
