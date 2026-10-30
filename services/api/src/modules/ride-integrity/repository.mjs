const columns = `id,ride_id AS rideId,driver_id AS driverId,kind,observed_at AS observedAt,
  arrived_at AS arrivedAt,last_location_at AS lastLocationAt,
  cancellation_actor_id AS cancellationActorId,cancellation_reason AS cancellationReason,
  review_status AS reviewStatus,review_note AS reviewNote,reviewed_by AS reviewedBy,
  reviewed_at AS reviewedAt,version`;

/** SQL-only evidence ports. No driver restriction, fare, or trip mutation exists here. */
export function createRideIntegrityRepository(db) {
  return Object.freeze({
    async gapCandidates(now, arrivalMs, staleMs, toleranceMs) {
      return db.prepare(`SELECT t.ride_id AS rideId,t.driver_id AS driverId,
        t.status,t.arrived_at AS arrivedAt,s.seen_at AS lastLocationAt
        FROM ride_trips t JOIN location_shares s ON s.ride_id=t.ride_id
        WHERE t.status='arrived' AND t.arrived_at<=?
          AND s.sequence > 0
          AND s.seen_at >= t.arrived_at-? AND s.seen_at<=?
          AND s.seen_at=(SELECT MAX(s2.seen_at) FROM location_shares s2 WHERE s2.ride_id=t.ride_id)
          AND NOT EXISTS(SELECT 1 FROM delivery_orders d WHERE d.ride_id=t.ride_id)
          AND NOT EXISTS(SELECT 1 FROM ride_integrity_signals i WHERE i.ride_id=t.ride_id AND i.kind='tracking_gap_after_arrival')
        ORDER BY t.arrived_at,t.ride_id LIMIT 100`).all(now - arrivalMs, toleranceMs, now - staleMs);
    },
    async cancellationCandidates(since) {
      return db.prepare(`SELECT t.ride_id AS rideId,t.driver_id AS driverId,t.status,
        t.arrived_at AS arrivedAt,t.started_at AS startedAt,
        a.created_at AS cancelledAt,a.actor_id AS cancellationActorId,a.reason AS cancellationReason
        FROM ride_trips t JOIN ride_activity a ON a.ride_id=t.ride_id AND a.type='cancelled'
        WHERE t.status='cancelled' AND t.arrived_at IS NOT NULL AND t.started_at IS NULL
          AND a.created_at >= ?
          AND NOT EXISTS(SELECT 1 FROM delivery_orders d WHERE d.ride_id=t.ride_id)
          AND NOT EXISTS(SELECT 1 FROM ride_integrity_signals i WHERE i.ride_id=t.ride_id AND i.kind='cancelled_after_arrival')
        ORDER BY a.created_at,t.ride_id LIMIT 100`).all(since);
    },
    async insert(signal) {
      return (await db.prepare(`INSERT INTO ride_integrity_signals
        (id,ride_id,driver_id,kind,observed_at,arrived_at,last_location_at,cancellation_actor_id,cancellation_reason)
        VALUES (?,?,?,?,?,?,?,?,?) ON CONFLICT(ride_id,kind) DO NOTHING`)
        .run(signal.id,signal.rideId,signal.driverId,signal.kind,signal.observedAt,signal.arrivedAt,
          signal.lastLocationAt,signal.cancellationActorId??null,signal.cancellationReason??null)).changes === 1;
    },
    async list({ state, beforeAt, beforeId, limit }) {
      return db.prepare(`SELECT ${columns} FROM ride_integrity_signals
        WHERE (?='all' OR review_status=?) AND (? IS NULL OR observed_at<? OR (observed_at=? AND id<?))
        ORDER BY observed_at DESC,id DESC LIMIT ?`)
        .all(state,state,beforeAt,beforeAt,beforeAt,beforeId,limit);
    },
    find: async id => (await db.prepare(`SELECT ${columns} FROM ride_integrity_signals WHERE id=?`).get(id)) ?? null,
    command: async (actorId,key) => (await db.prepare('SELECT fingerprint,signal_id AS signalId FROM ride_integrity_review_commands WHERE actor_id=? AND key=?').get(actorId,key)) ?? null,
    async saveCommand(actorId,key,fingerprint,id) {
      await db.prepare('INSERT INTO ride_integrity_review_commands(actor_id,key,fingerprint,signal_id) VALUES (?,?,?,?)').run(actorId,key,fingerprint,id);
    },
    async review({ id, expectedVersion, state, note, actorId, now }) {
      return (await db.prepare(`UPDATE ride_integrity_signals SET review_status=?,review_note=?,reviewed_by=?,reviewed_at=?,version=version+1
        WHERE id=? AND version=?`).run(state,note,actorId,now,id,expectedVersion)).changes===1;
    },
    async purge(before) {
      await db.prepare('DELETE FROM ride_integrity_review_commands WHERE signal_id IN (SELECT id FROM ride_integrity_signals WHERE observed_at<?)').run(before);
      await db.prepare('DELETE FROM ride_integrity_signals WHERE observed_at<?').run(before);
    },
  });
}
