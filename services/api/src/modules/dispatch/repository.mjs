const columns = `id,ride_id AS rideId,driver_id AS driverId,availability_id AS availabilityId,status,mode,
  policy_version AS policyVersion,eta_source AS etaSource,pickup_eta_seconds AS pickupEtaSeconds,
  estimated_at AS estimatedAt,created_at AS createdAt,expires_at AS expiresAt,closed_at AS closedAt`;

/** Only this repository owns dispatch persistence. Caller owns the transaction. */
export function createDispatchRepository(db) {
  let regionCursor = '';
  return Object.freeze({
    async activeRegions(now) {
      const select = `SELECT region FROM (
        SELECT dispatch_region AS region FROM rides WHERE status='requested' AND request_expires_at>?
        UNION SELECT r.dispatch_region AS region FROM rides r JOIN dispatch_offers o ON o.ride_id=r.id WHERE o.status='pending'
      ) region_queue WHERE region>? ORDER BY region LIMIT 512`;
      let rows = await db.prepare(select).all(now, regionCursor);
      if (!rows.length && regionCursor) rows = await db.prepare(select).all(now, '');
      regionCursor = rows.at(-1)?.region ?? '';
      return rows.map((row) => row.region);
    },
    find: async (id) => await db.prepare(`SELECT ${columns} FROM dispatch_offers WHERE id=?`).get(id) ?? null,
    pending: (region = null) => db.prepare(`SELECT ${columns} FROM dispatch_offers WHERE status='pending'
      ${region !== null ? 'AND ride_id IN (SELECT id FROM rides WHERE dispatch_region=?)' : ''} ORDER BY created_at,id LIMIT 2048`).all(...(region !== null ? [region] : [])),
    forDriver: async (id) => await db.prepare(`SELECT ${columns} FROM dispatch_offers WHERE driver_id=? AND status='pending'`).get(id) ?? null,
    attempted: async (rideId, driverId) => Boolean(await db.prepare('SELECT 1 FROM dispatch_offers WHERE ride_id=? AND driver_id=?').get(rideId, driverId)),
    async insert(offer) {
      return (await db.prepare(`INSERT OR IGNORE INTO dispatch_offers
        (id,ride_id,driver_id,availability_id,status,mode,policy_version,eta_source,pickup_eta_seconds,estimated_at,created_at,expires_at)
        VALUES (?,?,?,?,'pending',?,?,?,?,?,?,?)`).run(offer.id, offer.rideId, offer.driverId, offer.availabilityId,
        offer.mode, offer.policyVersion, offer.etaSource, offer.pickupEtaSeconds, offer.estimatedAt, offer.createdAt, offer.expiresAt)).changes === 1;
    },
    async close(id, status, now) {
      return (await db.prepare("UPDATE dispatch_offers SET status=?,closed_at=? WHERE id=? AND status='pending'").run(status, now, id)).changes === 1;
    },
    command: (id, key) => db.prepare('SELECT fingerprint,offer_id AS offerId FROM dispatch_commands WHERE actor_id=? AND key=?').get(id, key),
    async saveCommand(id, key, fingerprint, offerId) {
      await db.prepare('INSERT INTO dispatch_commands(actor_id,key,fingerprint,offer_id) VALUES (?,?,?,?)').run(id, key, fingerprint, offerId);
    },
    async observe({ rideId, mode, locationMode, kind, now }) {
      if (kind === 'request') await db.prepare('INSERT OR IGNORE INTO dispatch_journeys(ride_id,mode,location_mode,created_at) VALUES (?,?,?,?)')
        .run(rideId, mode, locationMode, now);
      const column = { claim: 'matched_at', confirm: 'booked_at', depart: 'departed_at', arrive: 'arrived_at', complete: 'completed_at' }[kind];
      if (column) await db.prepare(`UPDATE dispatch_journeys SET ${column}=COALESCE(${column},?) WHERE ride_id=?`).run(now, rideId);
      if (['cancel', 'expired'].includes(kind)) await db.prepare('UPDATE dispatch_journeys SET closed_at=?,outcome=? WHERE ride_id=?')
        .run(now, kind === 'cancel' ? 'cancelled' : 'expired', rideId);
    },
    async metrics(since) {
      const offers = await db.prepare(`SELECT mode,eta_source AS etaSource,status,COUNT(*) AS count,
        AVG(CASE WHEN closed_at IS NOT NULL THEN (closed_at-created_at)/1000.0 END) AS meanResponseSeconds
        FROM dispatch_offers WHERE created_at>=? GROUP BY mode,eta_source,status ORDER BY mode,eta_source,status`).all(since);
      const journeys = await db.prepare(`SELECT mode,location_mode AS locationMode,COUNT(*) AS requests,
        SUM(matched_at IS NOT NULL) AS matched,SUM(CASE WHEN outcome='expired' THEN 1 ELSE 0 END) AS expired,
        SUM(CASE WHEN outcome='cancelled' THEN 1 ELSE 0 END) AS cancelled,SUM(completed_at IS NOT NULL) AS completed,
        AVG((matched_at-created_at)/1000.0) AS meanMatchSeconds,
        AVG(CASE WHEN departed_at IS NOT NULL THEN (arrived_at-departed_at)/1000.0 END) AS meanPickupSeconds,
        SUM(arrived_at IS NOT NULL AND departed_at IS NOT NULL) AS pickupObservations
        FROM dispatch_journeys WHERE created_at>=? GROUP BY mode,location_mode ORDER BY mode,location_mode`).all(since);
      return { offers, journeys, estimates: { roadOffers: offers.filter((o) => o.etaSource === 'road').reduce((n,o) => n + o.count, 0),
        fallbackOffers: offers.filter((o) => o.etaSource === 'distance_fallback').reduce((n,o) => n + o.count, 0) } };
    },
  });
}
