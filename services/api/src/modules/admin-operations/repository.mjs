import { floorIntegerSql } from '../../shared/sql-floor.mjs';
// Dedicated bounded operational projections. Never select route/address JSON,
// passenger identities, PINs, document contents or precise vehicle coordinates.
const waitingWhere = "r.status='requested' AND r.driver_id IS NULL AND r.request_expires_at>$now";
const activeWhere = "r.driver_id IS NOT NULL AND r.status IN ('negotiating','agreed') AND (t.status IS NULL OR t.status IN ('booked','on_way','arrived','in_progress'))";
const activeJoin = 'FROM rides r LEFT JOIN ride_trips t ON t.ride_id=r.id';
const driverJoin = `FROM driver_availability a JOIN drivers d ON d.user_id=a.driver_id
  JOIN users u ON u.id=a.driver_id JOIN driver_applications app ON app.driver_id=a.driver_id`;
const driverWhere = `a.active=1 AND a.expires_at>$now AND d.status='approved' AND app.status='approved'
  AND app.details_json IS NOT NULL AND app.verification_json IS NOT NULL AND u.role<>'admin'
  AND EXISTS (SELECT 1 FROM account_capabilities cap WHERE cap.user_id=a.driver_id AND cap.capability='driver')
  AND (a.mode='gps' OR $allowSample=1)
  AND (json_extract(app.verification_json,'$.method')='admin_exception' OR (
    (SELECT count(*) FROM driver_documents doc WHERE doc.driver_id=a.driver_id AND doc.kind IN ('profile_photo','driving_licence','vehicle_registration','vehicle_photo'))=4
    AND NOT EXISTS (SELECT 1 FROM driver_documents doc WHERE doc.driver_id=a.driver_id
      AND doc.kind IN ('driving_licence','vehicle_registration') AND (doc.expires_on IS NULL OR doc.expires_on<$today))))
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
const driverRegion = `CASE WHEN a.mode='sample' THEN 'sample:' || a.area_id
  WHEN a.latitude IS NOT NULL AND a.longitude IS NOT NULL THEN 'ng:' || CAST(${floorIntegerSql('a.latitude*20')} AS TEXT) || ':' || CAST(${floorIntegerSql('a.longitude*20')} AS TEXT)
  ELSE '' END`;
const eatStatus = "e.status IN ('placed','accepted','preparing','ready','assigned','picked_up','arrived')";
const fulfillment = "COALESCE(json_extract(e.snapshot_json,'$.fulfillment'),'delivery')";
const eatThreshold = `CASE e.status WHEN 'placed' THEN CAST($placed AS INTEGER) WHEN 'accepted' THEN COALESCE(CAST(json_extract(e.snapshot_json,'$.restaurant.prepMinutes') AS INTEGER),30)*60+$prepGrace
  WHEN 'preparing' THEN COALESCE(CAST(json_extract(e.snapshot_json,'$.restaurant.prepMinutes') AS INTEGER),30)*60+$prepGrace
  WHEN 'ready' THEN CASE WHEN ${fulfillment}='pickup' THEN CAST($pickupReady AS INTEGER) ELSE CAST($ready AS INTEGER) END
  WHEN 'assigned' THEN CAST($assigned AS INTEGER) WHEN 'picked_up' THEN CAST($pickedUp AS INTEGER) WHEN 'arrived' THEN CAST($arrived AS INTEGER) END`;
const eatWhere = `${eatStatus} AND e.updated_at <= CAST($now AS BIGINT)-(${eatThreshold})*1000`;

function queueQuery(queue) {
  if (queue === 'waiting') return `SELECT r.id,r.created_at AS createdAt,r.updated_at AS updatedAt,r.status,
    r.dispatch_region AS regionKey,r.vehicle_category AS vehicleCategory,r.request_expires_at AS expiresAt,
    CASE WHEN EXISTS (SELECT 1 FROM dispatch_offers o WHERE o.ride_id=r.id AND o.status='pending' AND o.expires_at>$now) THEN 1 ELSE 0 END AS pendingOffer
    FROM rides r WHERE ${waitingWhere}`;
  if (queue === 'active') return `SELECT r.id,r.created_at AS createdAt,r.updated_at AS updatedAt,
    COALESCE(t.status,r.status) AS status,r.dispatch_region AS regionKey,r.vehicle_category AS vehicleCategory,
    COALESCE(json_extract(r.driver_snapshot_json,'$.name'),u.name) AS driverName
    ${activeJoin} JOIN users u ON u.id=r.driver_id WHERE ${activeWhere}`;
  if (queue === 'drivers') return `SELECT a.id,a.started_at AS createdAt,a.seen_at AS updatedAt,'available' AS status,
    ${driverRegion} AS regionKey,u.name AS driverName,COALESCE(json_extract(app.details_json,'$.vehicle.category'),'standard') AS vehicleCategory,
    a.mode,a.expires_at AS expiresAt ${driverJoin} WHERE ${driverWhere}`;
  return `SELECT e.id,e.created_at AS createdAt,e.updated_at AS updatedAt,e.status,
    json_extract(e.snapshot_json,'$.restaurant.areaId') AS regionKey,
    json_extract(e.snapshot_json,'$.restaurant.name') AS storeName,${fulfillment} AS fulfillment,
    ${eatThreshold} AS expectedStageSeconds FROM eats_orders e WHERE ${eatWhere}`;
}

const inputs = (now, allowSimulation, policy) => ({ now, today: new Date(now + 3_600_000).toISOString().slice(0, 10), allowSample: allowSimulation ? 1 : 0,
  placed: policy.placedSeconds, prepGrace: policy.preparationGraceSeconds, ready: policy.readySeconds, pickupReady: policy.pickupReadySeconds,
  assigned: policy.assignedSeconds, pickedUp: policy.pickedUpSeconds, arrived: policy.arrivedSeconds });
// SQLite rejects unused named bindings; use exactly the names present in SQL.
function bindings(sql, values) { return Object.fromEntries([...new Set(sql.match(/\$[A-Za-z_]+/g) ?? [])].map((key) => [key.slice(1), values[key.slice(1)]])); }

export function createAdminOperationsRepository(db) {
  async function read(sql, values, method = 'get') { return db.prepare(sql)[method](bindings(sql, values)); }
  return Object.freeze({
    async counts(now, allowSimulation, policy) {
      const values = inputs(now, allowSimulation, policy);
      const row = await read(`SELECT
        (SELECT count(*) FROM rides r WHERE ${waitingWhere}) AS waitingRequests,
        (SELECT count(*) ${activeJoin} WHERE ${activeWhere}) AS activeTrips,
        (SELECT count(*) ${driverJoin} WHERE ${driverWhere}) AS availableDrivers,
        (SELECT count(*) FROM eats_orders e WHERE ${eatWhere}) AS delayedEats`, values);
      return Object.fromEntries(Object.entries(row).map(([key, value]) => [key, Number(value)]));
    },
    async queue(filter, now, allowSimulation, policy) {
      const clauses = [], values = { ...inputs(now, allowSimulation, policy), limit: filter.limit + 1 };
      if (filter.region) { clauses.push('regionKey=$region'); values.region = filter.region; }
      if (filter.status !== 'all') { clauses.push('status=$status'); values.status = filter.status; }
      if (filter.after) { clauses.push('(createdAt>$time OR (createdAt=$time AND id>$id))'); values.time = filter.after.time; values.id = filter.after.id; }
      return read(`WITH queue AS (${queueQuery(filter.queue)}) SELECT * FROM queue ${clauses.length ? `WHERE ${clauses.join(' AND ')}` : ''}
        ORDER BY createdAt,id LIMIT $limit`, values, 'all');
    },
    async matching(since, now) {
      const offers = await read(`SELECT
        COALESCE(sum(CASE WHEN status='pending' AND expires_at>$now THEN 1 ELSE 0 END),0) AS pending,
        COALESCE(sum(CASE WHEN status='expired' OR (status='pending' AND expires_at<=$now) THEN 1 ELSE 0 END),0) AS expired,
        COALESCE(sum(CASE WHEN status='declined' THEN 1 ELSE 0 END),0) AS declined,
        COALESCE(sum(CASE WHEN status='accepted' THEN 1 ELSE 0 END),0) AS accepted
        FROM dispatch_offers WHERE created_at>=$since AND created_at<=$now`, { since, now });
      const journeys = await read(`SELECT count(*) AS matchedRequests,AVG((matched_at-created_at)/1000.0) AS meanMatchSeconds
        FROM dispatch_journeys WHERE created_at>=$since AND created_at<=$now AND matched_at IS NOT NULL`, { since, now });
      return { ...Object.fromEntries(Object.entries(offers).map(([key, value]) => [key, Number(value)])),
        matchedRequests: Number(journeys.matchedRequests), meanMatchSeconds: journeys.meanMatchSeconds == null ? null : Number(journeys.meanMatchSeconds) };
    },
  });
}
