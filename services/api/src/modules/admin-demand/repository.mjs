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
  WHEN a.latitude IS NOT NULL AND a.longitude IS NOT NULL THEN 'ng:' || CAST(CAST(FLOOR(a.latitude*20) AS INTEGER) AS TEXT) || ':' || CAST(CAST(FLOOR(a.longitude*20) AS INTEGER) AS TEXT)
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

function serviceClause(category, filter) {
  return filter.service === 'ride' ? ` AND ${category} IN ('standard','suv')`
    : filter.service === 'courier' ? ` AND ${category} IN ('van','truck','motorcycle')` : '';
}
function cohort(filter) {
  return `cohort AS (SELECT r.id,${region(filter)} AS regionKey,r.created_at AS createdAt,
    CASE WHEN r.matched_at IS NOT NULL AND r.matched_at<=$now THEN 1 ELSE 0 END AS matched,
    CASE WHEN r.matched_at>=r.created_at AND r.matched_at<=$now THEN r.matched_at-r.created_at ELSE NULL END AS matchMillis,
    CASE WHEN t.status='completed' THEN 'completed'
      WHEN r.closed_reason='request_expired' OR (r.status='requested' AND r.driver_id IS NULL AND r.request_expires_at<=$now) THEN 'unserved'
      WHEN r.status='cancelled' OR t.status='cancelled' THEN 'cancelled' ELSE 'open' END AS outcome
    FROM rides r LEFT JOIN ride_trips t ON t.ride_id=r.id
    WHERE r.created_at>=$since AND r.created_at<$until${serviceClause('r.vehicle_category', filter)}${filter.region ? ` AND ${region(filter)}=$region` : ''})`;
}
function supply(filter) {
  return `supply AS (SELECT ${driverRegion(filter)} AS regionKey ${eligibleDrivers}${serviceClause(driverCategory, filter)}${filter.region ? ` AND ${driverRegion(filter)}=$region` : ''})`;
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

export function createAdminDemandRepository(db) {
  async function read(sql, values, method = 'get') { return db.prepare(sql)[method](bindings(sql, values)); }
  return Object.freeze({
    async totals(filter, now) {
      return read(`WITH ${cohort(filter)} SELECT ${metrics} FROM cohort`, valuesFor(filter, now));
    },
    async daily(filter, now) {
      return read(`WITH ${cohort(filter)} SELECT CAST(FLOOR((createdAt+3600000)/86400000.0) AS BIGINT) AS day,${metrics}
        FROM cohort GROUP BY day ORDER BY day`, valuesFor(filter, now), 'all');
    },
    async hours(filter, now) {
      return read(`WITH ${cohort(filter)} SELECT CAST(FLOOR((createdAt+3600000)/3600000.0) AS BIGINT)%24 AS hour,${metrics}
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
