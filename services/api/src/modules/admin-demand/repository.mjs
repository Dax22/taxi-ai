// Historical request cohorts and current eligible supply are deliberately separate.
// These projections never select customer identities, addresses, routes or exact GPS.
// The domain supplies its allowed sample IDs as bound values, keeping storage
// independent of the shared booking domain and avoiding SQL-interpolated data.
const sampleNames = (filter) => filter.sampleAreaIds.map((_, index) => `$sample_${index}`);
// Normalize unknown legacy keys before grouping, filtering and limiting. Keeping
// this portable also avoids casting malformed saved text into a PostgreSQL error.
const cellBody = 'substr(r.dispatch_region,4)';
const digitsRemoved = [...'0123456789'].reduce((sql, digit) => `replace(${sql},'${digit}','')`, cellBody);
const region = (filter) => `CASE WHEN substr(r.dispatch_region,1,3)='ng:' AND ${digitsRemoved}=':'
  AND instr(${cellBody},':') BETWEEN 2 AND 5
  AND length(${cellBody})-instr(${cellBody},':') BETWEEN 1 AND 4 THEN r.dispatch_region
  WHEN r.dispatch_region IN (${sampleNames(filter).map((name) => `'sample:' || ${name}`).join(',')}) THEN r.dispatch_region ELSE 'unassigned' END`;
const driverRegion = (filter) => `CASE WHEN a.mode='sample' AND a.area_id IN (${sampleNames(filter).join(',')}) THEN 'sample:' || a.area_id
  WHEN a.latitude IS NOT NULL AND a.longitude IS NOT NULL THEN 'ng:' || CAST(CAST(a.latitude*20 AS INTEGER) AS TEXT) || ':' || CAST(CAST(a.longitude*20 AS INTEGER) AS TEXT)
  ELSE 'unassigned' END`;
const driverCategory = "COALESCE(json_extract(app.details_json,'$.vehicle.category'),'standard')";
const eligibleDrivers = `FROM driver_availability a JOIN drivers d ON d.user_id=a.driver_id
  JOIN users u ON u.id=a.driver_id JOIN driver_applications app ON app.driver_id=a.driver_id
  WHERE a.active=1 AND a.expires_at>$now AND d.status='approved' AND app.status='approved'
  AND app.details_json IS NOT NULL AND app.verification_json IS NOT NULL AND u.role<>'admin'
  AND EXISTS (SELECT 1 FROM account_capabilities cap WHERE cap.user_id=a.driver_id AND cap.capability='driver')
  AND (a.mode='gps' OR $allowSample=1)
  AND (SELECT count(*) FROM driver_documents doc WHERE doc.driver_id=a.driver_id)=5
  AND NOT EXISTS (SELECT 1 FROM driver_documents doc WHERE doc.driver_id=a.driver_id
    AND doc.kind IN ('driving_licence','vehicle_registration','insurance') AND (doc.expires_on IS NULL OR doc.expires_on<$today))
  AND ((a.native_session_id IS NULL AND EXISTS (SELECT 1 FROM sessions s
    WHERE s.token_hash=a.session_hash AND s.user_id=a.driver_id AND s.expires_at>$now))
    OR (a.native_session_id IS NOT NULL AND EXISTS (SELECT 1 FROM device_sessions s
      WHERE s.id=a.native_session_id AND s.user_id=a.driver_id AND s.revoked_at IS NULL
        AND s.expires_at>$now AND s.idle_expires_at>$now)))
  AND NOT EXISTS (SELECT 1 FROM rides busy WHERE (busy.driver_id=a.driver_id OR busy.customer_id=a.driver_id)
    AND (busy.status='negotiating' OR (busy.status='requested' AND busy.request_expires_at>$now)
      OR (busy.status='agreed' AND (NOT EXISTS (SELECT 1 FROM ride_trips done WHERE done.ride_id=busy.id)
        OR EXISTS (SELECT 1 FROM ride_trips ongoing WHERE ongoing.ride_id=busy.id AND ongoing.status IN ('booked','on_way','arrived','in_progress'))))))
  AND NOT EXISTS (SELECT 1 FROM eats_orders job WHERE job.courier_id=a.driver_id AND job.status IN ('assigned','picked_up','arrived'))
  AND NOT EXISTS (SELECT 1 FROM dispatch_offers offer WHERE offer.driver_id=a.driver_id AND offer.status='pending' AND offer.expires_at>$now)`;

// A car can carry a passenger or a parcel. The saved delivery record identifies
// the requested service; vehicle category alone cannot classify its demand.
function requestServiceClause(filter) {
  const delivery = 'EXISTS (SELECT 1 FROM delivery_orders delivery WHERE delivery.ride_id=r.id)';
  return filter.service === 'ride' ? ` AND NOT ${delivery}`
    : filter.service === 'courier' ? ` AND ${delivery}` : '';
}
function supplyServiceClause(category, filter) {
  return filter.service === 'ride' ? ` AND ${category} IN ('standard','suv')`
    : filter.service === 'courier' ? ` AND ${category} IN ('standard','van','truck','motorcycle')` : '';
}
function cohort(filter) {
  return `cohort AS (SELECT r.id,${region(filter)} AS regionKey,r.created_at AS createdAt,
    CASE WHEN r.matched_at IS NOT NULL AND r.matched_at<=$now THEN 1 ELSE 0 END AS matched,
    CASE WHEN r.matched_at>=r.created_at AND r.matched_at<=$now THEN r.matched_at-r.created_at ELSE NULL END AS matchMillis,
    CASE WHEN t.status='completed' THEN 'completed'
      WHEN r.closed_reason='request_expired' OR (r.status='requested' AND r.driver_id IS NULL AND r.request_expires_at<=$now) THEN 'unserved'
      WHEN r.status='cancelled' OR t.status='cancelled' THEN 'cancelled' ELSE 'open' END AS outcome
    FROM rides r LEFT JOIN ride_trips t ON t.ride_id=r.id
    WHERE r.created_at>=$since AND r.created_at<$until${requestServiceClause(filter)}${filter.region ? ` AND ${region(filter)}=$region` : ''})`;
}
function supply(filter) {
  return `supply AS (SELECT ${driverRegion(filter)} AS regionKey ${eligibleDrivers}${supplyServiceClause(driverCategory, filter)}${filter.region ? ` AND ${driverRegion(filter)}=$region` : ''})`;
}
const metrics = `count(*) AS requests,COALESCE(sum(matched),0) AS matched,
  COALESCE(sum(CASE WHEN outcome='completed' THEN 1 ELSE 0 END),0) AS completed,
  COALESCE(sum(CASE WHEN outcome='unserved' THEN 1 ELSE 0 END),0) AS unserved,
  COALESCE(sum(CASE WHEN outcome='cancelled' THEN 1 ELSE 0 END),0) AS cancelled,
  COALESCE(sum(CASE WHEN outcome='open' THEN 1 ELSE 0 END),0) AS open,
  count(matchMillis) AS matchedWithTiming,AVG(matchMillis/1000.0) AS meanMatchSeconds`;
function bindings(sql, values) {
  return Object.fromEntries([...new Set(sql.match(/\$[A-Za-z_][A-Za-z_0-9]*/g) ?? [])].map((name) => [name.slice(1), values[name.slice(1)]]));
}
const valuesFor = (filter, now, allowSimulation = false) => ({ ...Object.fromEntries(filter.sampleAreaIds.map((id, index) => [`sample_${index}`, id])),
  since: filter.since, until: filter.until, now, region: filter.region,
  limit: filter.limit + 1, today: new Date(now + 3_600_000).toISOString().slice(0, 10), allowSample: allowSimulation ? 1 : 0 });

// Coverage aggregates GPS into bounded cells in storage. The only location
// values returned are grid indices; route payloads and participant rows stay here.
const quoteCoordinate = (axis, low, high) => `CASE WHEN json_type(q.route_json,'$.pickup.${axis}') IN ('integer','real','number')
  THEN CASE WHEN CAST(json_extract(q.route_json,'$.pickup.${axis}') AS NUMERIC) BETWEEN $${low} AND $${high}
    THEN CAST(json_extract(q.route_json,'$.pickup.${axis}') AS DOUBLE PRECISION) ELSE NULL END ELSE NULL END`;
const liveWaiting = `r.status='requested' AND r.driver_id IS NULL AND r.request_expires_at>$now AND r.created_at<=$now`;
function coverageRecords(filter) {
  return `coverage_requests AS (SELECT
    CASE WHEN substr(r.dispatch_region,1,7)='sample:' THEN 'sample' ELSE 'gps' END AS sourceKind,
    ${quoteCoordinate('lat', 'nationalSouth', 'nationalNorth')} AS lat,
    ${quoteCoordinate('lng', 'nationalWest', 'nationalEast')} AS lng,
    CASE WHEN r.created_at>=$since AND r.created_at<$until THEN 1 ELSE 0 END AS historical,
    CASE WHEN r.driver_id IS NULL AND r.matched_at IS NULL AND (r.closed_reason='request_expired'
      OR (r.status='requested' AND r.request_expires_at<=$now)) THEN 1 ELSE 0 END AS unserved,
    CASE WHEN t.booked_at>=r.created_at AND t.arrived_at>=t.booked_at AND t.arrived_at<=$now
      THEN (t.arrived_at-t.booked_at)/1000.0 ELSE NULL END AS pickupWait,
    CASE WHEN ${liveWaiting} THEN 1 ELSE 0 END AS waiting,
    CASE WHEN ${liveWaiting} THEN ($now-r.created_at)/1000.0 ELSE NULL END AS waitingSeconds,
    0 AS availableDrivers
    FROM rides r LEFT JOIN location_quotes q ON q.ride_id=r.id LEFT JOIN ride_trips t ON t.ride_id=r.id
    WHERE ((r.created_at>=$since AND r.created_at<$until) OR (${liveWaiting}))${requestServiceClause(filter)}),
  coverage_supply AS (SELECT CASE WHEN a.mode='sample' THEN 'sample' ELSE 'gps' END AS sourceKind,
    a.latitude AS lat,a.longitude AS lng,0 AS historical,0 AS unserved,CAST(NULL AS DOUBLE PRECISION) AS pickupWait,
    0 AS waiting,CAST(NULL AS DOUBLE PRECISION) AS waitingSeconds,
    1 AS availableDrivers ${eligibleDrivers}${supplyServiceClause(driverCategory, filter)}),
  coverage_records AS (SELECT * FROM coverage_requests UNION ALL SELECT * FROM coverage_supply),
  located AS (SELECT *,CASE WHEN sourceKind='sample' THEN 'sample'
    WHEN lat IS NULL OR lng IS NULL OR lat<$nationalSouth OR lat>$nationalNorth OR lng<$nationalWest OR lng>$nationalEast THEN 'unlocated'
    WHEN lat<$south OR (lat>=$north AND $north<$nationalNorth) OR lng<$west OR (lng>=$east AND $east<$nationalEast) THEN 'outside' ELSE 'mapped' END AS mapKind FROM coverage_records),
  gridded AS (SELECT *,CASE WHEN mapKind='mapped' THEN CAST(lng/CAST($cellDegrees AS DOUBLE PRECISION) AS INTEGER) ELSE 0 END AS cellX,
    CASE WHEN mapKind='mapped' THEN CAST(lat/CAST($cellDegrees AS DOUBLE PRECISION) AS INTEGER) ELSE 0 END AS cellY FROM located)`;
}

export function createAdminDemandRepository(db) {
  async function read(sql, values, method = 'get') { return db.prepare(sql)[method](bindings(sql, values)); }
  return Object.freeze({
    async coverage(filter, now, allowSimulation) {
      const values = { ...valuesFor(filter, now, allowSimulation), ...filter.bounds, cellDegrees: filter.cellDegrees,
        nationalSouth: filter.nationalBounds.south, nationalNorth: filter.nationalBounds.north,
        nationalWest: filter.nationalBounds.west, nationalEast: filter.nationalBounds.east };
      return read(`WITH ${coverageRecords(filter)} SELECT mapKind,cellX,cellY,
        COALESCE(sum(historical),0) AS requests,
        COALESCE(sum(CASE WHEN historical=1 THEN unserved ELSE 0 END),0) AS unserved,
        count(CASE WHEN historical=1 THEN pickupWait ELSE NULL END) AS pickupWaitObservations,
        AVG(CASE WHEN historical=1 THEN pickupWait ELSE NULL END) AS meanPickupWaitSeconds,
        COALESCE(sum(waiting),0) AS waitingRequests,COALESCE(sum(availableDrivers),0) AS availableDrivers,
        count(waitingSeconds) AS waitingObservations,AVG(waitingSeconds) AS meanWaitingSeconds,MAX(waitingSeconds) AS maxWaitingSeconds
        FROM gridded GROUP BY mapKind,cellX,cellY ORDER BY mapKind,cellY,cellX`, values, 'all');
    },
    async totals(filter, now) {
      return read(`WITH ${cohort(filter)} SELECT ${metrics} FROM cohort`, valuesFor(filter, now));
    },
    async daily(filter, now) {
      return read(`WITH ${cohort(filter)} SELECT CAST((createdAt+3600000)/86400000.0 AS BIGINT) AS day,${metrics}
        FROM cohort GROUP BY day ORDER BY day`, valuesFor(filter, now), 'all');
    },
    async hours(filter, now) {
      return read(`WITH ${cohort(filter)} SELECT CAST((createdAt+3600000)/3600000.0 AS BIGINT)%24 AS hour,${metrics}
        FROM cohort GROUP BY hour ORDER BY hour`, valuesFor(filter, now), 'all');
    },
    async offers(filter, now) {
      return read(`WITH ${cohort(filter)} SELECT count(*) AS total,
        COALESCE(sum(CASE WHEN o.status='pending' AND o.expires_at>$now THEN 1 ELSE 0 END),0) AS pending,
        COALESCE(sum(CASE WHEN o.status='pending' AND o.expires_at<=$now OR o.status='expired' THEN 1 ELSE 0 END),0) AS expired,
        COALESCE(sum(CASE WHEN o.status='accepted' THEN 1 ELSE 0 END),0) AS accepted,
        COALESCE(sum(CASE WHEN o.status='declined' THEN 1 ELSE 0 END),0) AS declined,
        COALESCE(sum(CASE WHEN o.status='revoked' THEN 1 ELSE 0 END),0) AS revoked
        FROM dispatch_offers o JOIN cohort c ON c.id=o.ride_id WHERE o.created_at<=$now`, valuesFor(filter, now));
    },
    async currentSupply(filter, now, allowSimulation) {
      return read(`WITH ${supply(filter)} SELECT count(*) AS availableDrivers FROM supply`, valuesFor(filter, now, allowSimulation));
    },
    async areas(filter, now, allowSimulation) {
      return read(`WITH ${cohort(filter)},${supply(filter)},
        historical AS (SELECT regionKey,${metrics} FROM cohort GROUP BY regionKey),
        available AS (SELECT regionKey,count(*) AS availableDrivers FROM supply GROUP BY regionKey),
        regions AS (SELECT regionKey FROM historical UNION SELECT regionKey FROM available)
        SELECT regions.regionKey,h.requests,h.matched,h.completed,h.unserved,h.cancelled,h.open,h.matchedWithTiming,h.meanMatchSeconds,
          COALESCE(a.availableDrivers,0) AS availableDrivers
        FROM regions LEFT JOIN historical h ON h.regionKey=regions.regionKey LEFT JOIN available a ON a.regionKey=regions.regionKey
        ORDER BY COALESCE(h.requests,0) DESC,COALESCE(a.availableDrivers,0) DESC,regions.regionKey LIMIT $limit`, valuesFor(filter, now, allowSimulation), 'all');
    },
  });
}
