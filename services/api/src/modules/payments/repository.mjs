const columns = `ride_id AS rideId, customer_id AS customerId, driver_id AS driverId,
  amount_kobo AS amountKobo, currency, mode, status, version, current_attempt_id AS currentAttemptId,
  completed_at AS completedAt, updated_at AS updatedAt, paid_at AS paidAt`;
const attemptColumns = `id, ride_id AS rideId, reference, amount_kobo AS amountKobo, currency, provider,
  status, created_at AS createdAt, resolved_at AS resolvedAt`;

/** Owns only payment tables. Writes join the caller's synchronous transaction. */
export function createPaymentsRepository(db) {
  return Object.freeze({
    find: (id) => db.prepare(`SELECT ${columns} FROM payments WHERE ride_id = ?`).get(id) ?? null,
    findAttempt: (id) => db.prepare(`SELECT ${attemptColumns} FROM payment_attempts WHERE id = ?`).get(id) ?? null,
    receipt: (id) => {
      const row = db.prepare('SELECT payload_json FROM payment_receipts WHERE ride_id = ?').get(id);
      return row ? JSON.parse(row.payload_json) : null;
    },
    insert({ rideId, customerId, driverId, amountKobo, completedAt }) {
      db.prepare(`INSERT INTO payments (ride_id, customer_id, driver_id, amount_kobo, completed_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?)`).run(rideId, customerId, driverId, amountKobo, completedAt, completedAt);
    },
    insertAttempt({ id, rideId, reference, amountKobo, currency, now }) {
      db.prepare(`INSERT INTO payment_attempts (id, ride_id, reference, amount_kobo, currency, provider, status, created_at)
        VALUES (?, ?, ?, ?, ?, 'simulator', 'pending', ?)`).run(id, rideId, reference, amountKobo, currency, now);
    },
    start(id, attemptId, version, now) {
      return db.prepare(`UPDATE payments SET status = 'pending', current_attempt_id = ?, version = version + 1, updated_at = ?
        WHERE ride_id = ? AND version = ? AND status IN ('unpaid', 'failed')`).run(attemptId, now, id, version).changes === 1;
    },
    resolveAttempt(id, status, now) {
      return db.prepare(`UPDATE payment_attempts SET status = ?, resolved_at = ? WHERE id = ? AND status = 'pending'`)
        .run(status, now, id).changes === 1;
    },
    settle(id, attemptId, version, status, now) {
      return db.prepare(`UPDATE payments SET status = ?, paid_at = ?, updated_at = ?, version = version + 1
        WHERE ride_id = ? AND current_attempt_id = ? AND version = ? AND status = 'pending'`)
        .run(status, status === 'paid' ? now : null, now, id, attemptId, version).changes === 1;
    },
    saveReceipt(id, attemptId, receipt) {
      db.prepare('INSERT INTO payment_receipts (ride_id, attempt_id, payload_json) VALUES (?, ?, ?)').run(id, attemptId, JSON.stringify(receipt));
    },
    findCommand: (userId, key) => db.prepare(`SELECT fingerprint, ride_id AS rideId, attempt_id AS attemptId
      FROM payment_commands WHERE actor_id = ? AND key = ?`).get(userId, key) ?? null,
    saveCommand(userId, key, fingerprint, rideId, attemptId) {
      db.prepare('INSERT INTO payment_commands (actor_id, key, fingerprint, ride_id, attempt_id) VALUES (?, ?, ?, ?, ?)')
        .run(userId, key, fingerprint, rideId, attemptId);
    },
    list: (driverId, before, limit) => db.prepare(`SELECT ${columns} FROM payments
      WHERE (? IS NULL OR driver_id = ?) AND (? IS NULL OR completed_at < ? OR (completed_at = ? AND ride_id < ?))
      ORDER BY completed_at DESC, ride_id DESC LIMIT ?`)
      .all(driverId, driverId, before?.rideId ?? null, before?.completedAt ?? null, before?.completedAt ?? null, before?.rideId ?? null, limit),
    // Statement.all is available on the supported Node 22.12 baseline.
    totals: (driverId) => db.prepare('SELECT amount_kobo AS amountKobo, status FROM payments WHERE driver_id = ?').all(driverId),
  });
}
