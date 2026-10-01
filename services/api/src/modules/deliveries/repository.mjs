/** Delivery metadata and proof of handover. Writes join the ride transaction. */
export function createDeliveriesRepository(db) {
  return Object.freeze({
    async find(id) {
      const row = (await db.prepare(`SELECT details_json, dropoff_pin AS dropoffPin, pin_failures AS pinFailures,
        pin_blocked_until AS pinBlockedUntil, verified_at AS verifiedAt, arrived_at AS arrivedAt FROM delivery_orders WHERE ride_id=?`).get(id));
      return row ? { ...row, details: JSON.parse(row.details_json) } : null;
    },
    insert: async (id, details) => (await db.prepare('INSERT INTO delivery_orders(ride_id,details_json) VALUES (?,?)').run(id, JSON.stringify(details))),
    issue: async (id, pin) => (await db.prepare('UPDATE delivery_orders SET dropoff_pin=? WHERE ride_id=?').run(pin, id)),
    arrive: async (id, now) => (await db.prepare('UPDATE delivery_orders SET arrived_at=? WHERE ride_id=? AND arrived_at IS NULL AND verified_at IS NULL').run(now, id)).changes === 1,
    fail: async (id, failures, until) => (await db.prepare('UPDATE delivery_orders SET pin_failures=?,pin_blocked_until=? WHERE ride_id=?').run(failures, until, id)),
    close: async (id, verifiedAt) => (await db.prepare(`UPDATE delivery_orders SET dropoff_pin=NULL,pin_failures=0,pin_blocked_until=NULL,verified_at=? WHERE ride_id=?`).run(verifiedAt, id)),
  });
}
