/** Delivery metadata and proof of handover. Writes join the ride transaction. */
export function createDeliveriesRepository(db) {
  return Object.freeze({
    find(id) {
      const row = db.prepare(`SELECT details_json, dropoff_pin AS dropoffPin, pin_failures AS pinFailures,
        pin_blocked_until AS pinBlockedUntil, verified_at AS verifiedAt FROM delivery_orders WHERE ride_id=?`).get(id);
      return row ? { ...row, details: JSON.parse(row.details_json) } : null;
    },
    insert: (id, details) => db.prepare('INSERT INTO delivery_orders(ride_id,details_json) VALUES (?,?)').run(id, JSON.stringify(details)),
    issue: (id, pin) => db.prepare('UPDATE delivery_orders SET dropoff_pin=? WHERE ride_id=?').run(pin, id),
    fail: (id, failures, until) => db.prepare('UPDATE delivery_orders SET pin_failures=?,pin_blocked_until=? WHERE ride_id=?').run(failures, until, id),
    close: (id, verifiedAt) => db.prepare(`UPDATE delivery_orders SET dropoff_pin=NULL,pin_failures=0,pin_blocked_until=NULL,verified_at=? WHERE ride_id=?`).run(verifiedAt, id),
  });
}
