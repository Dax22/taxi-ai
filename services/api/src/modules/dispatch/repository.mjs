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

/** Bounded read-only dispatch projection; no matching writes bypass their owners. */
export function createMatchingRepository(db) {
  const marks = (ids) => ids.map(() => '?').join(',');
  return Object.freeze({
    async driverRows(page, now, sessionNow) {
      const rows = await db.prepare(`SELECT u.id, u.role, d.status, d.vehicle_model AS vehicleModel, d.vehicle_plate AS vehiclePlate,
        a.status AS applicationStatus, a.details_json AS detailsJson, a.verification_json AS verificationJson,
        v.id AS availabilityId, v.mode, v.area_id AS areaId, v.position_json AS positionJson, v.seen_at AS seenAt,
        v.native_session_id AS nativeSessionId,
        EXISTS(SELECT 1 FROM account_capabilities c WHERE c.user_id=u.id AND c.capability='driver') AS driverCapability,
        EXISTS(SELECT 1 FROM account_capabilities c WHERE c.user_id=u.id AND c.capability='customer') AS customerCapability,
        CASE WHEN v.native_session_id IS NOT NULL THEN
          EXISTS(SELECT 1 FROM device_sessions s WHERE s.id=v.native_session_id AND s.user_id=u.id
            AND s.revoked_at IS NULL AND s.expires_at>? AND s.idle_expires_at>?)
          ELSE EXISTS(SELECT 1 FROM sessions s WHERE s.token_hash=v.session_hash AND s.user_id=u.id AND s.expires_at>?) END AS sessionActive,
        EXISTS(SELECT 1 FROM rides r WHERE r.driver_id=u.id AND (r.status='negotiating'
          OR EXISTS(SELECT 1 FROM ride_trips t WHERE t.ride_id=r.id AND t.status NOT IN ('completed','cancelled')))) AS driverBusy,
        EXISTS(SELECT 1 FROM rides r WHERE r.customer_id=u.id AND ((r.status='requested' AND r.request_expires_at>?)
          OR r.status='negotiating' OR (r.status='agreed' AND (NOT EXISTS(SELECT 1 FROM ride_trips t WHERE t.ride_id=r.id)
            OR EXISTS(SELECT 1 FROM ride_trips t WHERE t.ride_id=r.id AND t.status NOT IN ('completed','cancelled')))))) AS customerBusy,
        EXISTS(SELECT 1 FROM eats_orders e WHERE e.courier_id=u.id AND e.status IN ('assigned','picked_up','arrived')) AS eatsBusy
        FROM users u JOIN drivers d ON d.user_id=u.id
        LEFT JOIN driver_applications a ON a.driver_id=u.id
        JOIN driver_availability v ON v.driver_id=u.id AND v.active=1 WHERE u.id IN (${marks(page)})`)
        .all(sessionNow, sessionNow, sessionNow, now, ...page);
      return rows;
    },
    async documents(page) {
      const documents = await db.prepare(`SELECT driver_id AS driverId,kind,expires_on AS expiresOn
        FROM driver_documents WHERE driver_id IN (${marks(page)})`).all(...page);
      return documents;
    },
    async rideRows(page) {
      const rows = await db.prepare(`SELECT r.id, r.customer_id AS customerId, r.pickup_id AS pickupId,
        r.dispatch_region AS dispatchRegion, r.vehicle_category AS vehicleCategory, r.status, r.version,
        r.created_at AS createdAt, r.request_expires_at AS requestExpiresAt,
        q.route_json AS routeJson, d.details_json AS deliveryJson, p.recipient_id AS recipientId
        FROM rides r LEFT JOIN location_quotes q ON q.ride_id=r.id
        LEFT JOIN delivery_orders d ON d.ride_id=r.id
        LEFT JOIN parcel_tracking_links p ON p.ride_id=r.id AND p.active=1
        WHERE r.id IN (${marks(page)})`).all(...page);
      return rows;
    },
    async attemptedRows(page) {
      const rows = await db.prepare(`WITH requested(ride_id,driver_id) AS (VALUES ${page.map(() => '(?,?)').join(',')})
        SELECT o.ride_id AS rideId,o.driver_id AS driverId FROM dispatch_offers o
        JOIN requested p ON p.ride_id=o.ride_id AND p.driver_id=o.driver_id`).all(...page.flatMap(e => [e.rideId, e.driverId]));
      return rows;
    },
  });
}
