// Dedicated staff read model. It joins explicit reporting fields; it never reads
// credentials, PINs, document bytes, private chat or raw location-share records.
const journey = `WITH journey AS (
  SELECT r.id, r.customer_id AS customerId, r.driver_id AS driverId,
    r.created_at AS createdAt, r.updated_at AS updatedAt, r.matched_at AS matchedAt,
    CASE WHEN r.closed_reason='request_expired' OR (r.status='requested' AND r.request_expires_at <= $now)
      THEN 'expired' ELSE COALESCE(t.status,r.status) END AS status,
    r.pickup_id AS pickupId, r.destination_id AS destinationId,
    json_extract(q.route_json,'$.pickup.name') AS pickupName, json_extract(q.route_json,'$.destination.name') AS destinationName,
    c.name AS customerName, COALESCE(json_extract(r.driver_snapshot_json,'$.name'),d.name) AS driverName,
    r.driver_snapshot_json AS driverSnapshotJson,
    COALESCE(t.fare_kobo,(SELECT json_extract(f.payload,'$.amountKobo') FROM fare_events f
      WHERE f.ride_id=r.id AND f.type='propose' AND f.version < (SELECT MAX(a.version) FROM fare_events a WHERE a.ride_id=r.id AND a.type='accept')
      ORDER BY f.version DESC LIMIT 1)) AS fareKobo,
    t.booked_at AS bookedAt, t.completed_at AS completedAt,
    p.status AS paymentStatus, p.mode AS paymentMode, p.paid_at AS paidAt,
    pa.reference AS paymentReference
  FROM rides r JOIN users c ON c.id=r.customer_id LEFT JOIN users d ON d.id=r.driver_id
  LEFT JOIN ride_trips t ON t.ride_id=r.id LEFT JOIN location_quotes q ON q.ride_id=r.id
  LEFT JOIN payments p ON p.ride_id=r.id LEFT JOIN payment_attempts pa ON pa.id=p.current_attempt_id
)`;
const accountColumns = `u.id,u.name,u.email,u.created_at AS createdAt,d.status AS driverStatus,a.status AS reviewStatus,
  (SELECT count(*) FROM rides r WHERE r.customer_id=u.id OR r.driver_id=u.id) AS tripCount`;
const accountJoin = 'FROM users u LEFT JOIN drivers d ON d.user_id=u.id LEFT JOIN driver_applications a ON a.driver_id=u.id';
function tripWhere(filter, now, accountId) {
  const clauses = ['createdAt >= $start', 'createdAt < $end'], params = { now, start: filter.range.start, end: filter.range.end };
  if (accountId) {
    params.accountId = accountId;
    clauses.push(filter.mode === 'customer' ? 'customerId=$accountId' : filter.mode === 'driver' ? 'driverId=$accountId' : '(customerId=$accountId OR driverId=$accountId)');
  }
  if (filter.status !== 'all') { clauses.push('status=$status'); params.status = filter.status; }
  if (filter.payment !== 'all') { clauses.push("COALESCE(paymentStatus,'not_due')=$payment"); params.payment = filter.payment; }
  if (filter.q) {
    params.q = filter.q.toLowerCase();
    clauses.push("(instr(lower(id),$q)>0 OR instr(lower(customerName),$q)>0 OR instr(lower(COALESCE(driverName,'')),$q)>0)");
  }
  return { clauses, params };
}
function paginate(clauses, params, filter, time = 'createdAt', id = 'id') {
  const cursor = filter.before ?? filter.after, sign = filter.after ? '>' : '<';
  if (cursor) { clauses.push(`(${time} ${sign} $cursorTime OR (${time}=$cursorTime AND ${id} ${sign} $cursorId))`); params.cursorTime = cursor.time; params.cursorId = cursor.id; }
  params.limit = filter.limit + 1;
  return `WHERE ${clauses.join(' AND ')} ORDER BY ${time} ${filter.after ? 'ASC' : 'DESC'},${id} ${filter.after ? 'ASC' : 'DESC'} LIMIT $limit`;
}
export function createAdminConsoleRepository(db) {
  return Object.freeze({
    accounts(filter) {
      const clauses = ["u.role<>'admin'"], params = {};
      if (filter.type !== 'all') clauses.push(`d.user_id IS ${filter.type === 'driver' ? 'NOT ' : ''}NULL`);
      if (filter.review !== 'all') { clauses.push('a.status=$review'); params.review = filter.review; }
      if (filter.q) { clauses.push("(instr(lower(u.name),$q)>0 OR instr(lower(u.email),$q)>0 OR instr(u.id,$q)>0 OR instr(lower(COALESCE(d.vehicle_plate,'')),$q)>0)"); params.q = filter.q.toLowerCase(); }
      const suffix = paginate(clauses, params, filter, 'u.created_at', 'u.id');
      return db.prepare(`SELECT ${accountColumns} ${accountJoin} ${suffix}`).all(params);
    },
    account(id) {
      return db.prepare(`SELECT ${accountColumns},d.vehicle_model AS vehicleModel,d.vehicle_plate AS vehiclePlate,
        COALESCE(json_extract(a.details_json,'$.vehicle'),s.vehicle_json) AS vehicleJson ${accountJoin}
        LEFT JOIN driver_vehicle_selections s ON s.driver_id=u.id WHERE u.id=? AND u.role<>'admin'`).get(id) ?? null;
    },
    accountCounts(start, end) {
      return db.prepare(`SELECT count(*) AS total,count(d.user_id) AS drivers,count(*)-count(d.user_id) AS customerOnly,
        COALESCE(sum(u.created_at>=? AND u.created_at<?),0) AS newAccounts,
        COALESCE(sum(a.status='submitted'),0) AS awaitingReview
        ${accountJoin} WHERE u.role<>'admin'`).get(start, end);
    },
    trips(filter, now, accountId = null) {
      const { clauses, params } = tripWhere(filter, now, accountId), suffix = paginate(clauses, params, filter);
      return db.prepare(`${journey} SELECT * FROM journey ${suffix}`).all(params);
    },
    trip(id, now) { return db.prepare(`${journey} SELECT * FROM journey WHERE id=$id`).get({ id, now }) ?? null; },
    *facts(filter, now, accountId = null) {
      let before = null;
      while (true) {
        const { clauses, params } = tripWhere(filter, now, accountId);
        const suffix = paginate(clauses, params, { before, after: null, limit: 999 });
        const rows = db.prepare(`${journey} SELECT id,createdAt,customerId,driverId,status,fareKobo,paymentStatus,paymentMode FROM journey ${suffix}`).all(params);
        for (const row of rows) yield row;
        if (rows.length < 1000) return;
        const last = rows.at(-1); before = { time: last.createdAt, id: last.id };
      }
    },
    activity(id) {
      return db.prepare(`SELECT a.type,a.reason,a.created_at AS createdAt,u.name AS actorName
        FROM ride_activity a JOIN users u ON u.id=a.actor_id WHERE a.ride_id=? ORDER BY a.id`).all(id);
    },
    routes(filter, now) {
      const { clauses, params } = tripWhere(filter, now, null);
      return db.prepare(`${journey} SELECT pickupId,destinationId,pickupName,destinationName,count(*) AS requests,
        sum(status='completed') AS completed FROM journey WHERE ${clauses.join(' AND ')}
        GROUP BY pickupId,destinationId,pickupName,destinationName ORDER BY requests DESC,pickupId,destinationId LIMIT 8`).all(params);
    },
  });
}
