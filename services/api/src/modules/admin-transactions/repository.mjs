// Reporting projection only. Never selects passwords, PINs, SDP or document bytes.
const common = `WITH activity AS (
 SELECT r.id,CASE WHEN d.ride_id IS NULL THEN 'ride' ELSE 'courier' END AS service,
 r.customer_id AS customerId,r.driver_id AS workerId,NULL AS storeId,
 c.name AS customerName,w.name AS workerName,NULL AS storeName,
 r.created_at AS createdAt,r.updated_at AS updatedAt,
 CASE WHEN r.closed_reason='request_expired' OR (r.status='requested' AND r.request_expires_at<=$now) THEN 'expired' ELSE COALESCE(t.status,r.status) END AS status,
 r.pickup_id AS pickupArea,r.destination_id AS destinationArea,
 json_extract(q.route_json,'$.pickup.name') AS pickupName,json_extract(q.route_json,'$.destination.name') AS destinationName,
 t.fare_kobo AS amountKobo,r.vehicle_category AS vehicleCategory,
 CASE WHEN cp.id IS NOT NULL THEN COALESCE(json_extract(cp.receipt_json,'$.mode'),CASE WHEN cp.reference LIKE 'TA-TEST-%' THEN 'test' ELSE 'unverified' END) ELSE COALESCE(p.mode,'unconfigured') END AS paymentMode,
 COALESCE(cp.status,p.status,'not_recorded') AS paymentStatus,cp.target_id AS paymentTargetId
 FROM rides r JOIN users c ON c.id=r.customer_id LEFT JOIN users w ON w.id=r.driver_id
 LEFT JOIN ride_trips t ON t.ride_id=r.id LEFT JOIN delivery_orders d ON d.ride_id=r.id
 LEFT JOIN location_quotes q ON q.ride_id=r.id LEFT JOIN payments p ON p.ride_id=r.id
 LEFT JOIN checkout_payments cp ON cp.kind='ride' AND cp.target_id=r.id
 UNION ALL
 SELECT o.id,'food',o.customer_id,o.courier_id,o.store_id,c.name,w.name,json_extract(s.details_json,'$.name'),o.created_at,o.updated_at,o.status,
 json_extract(o.snapshot_json,'$.restaurant.areaId'),json_extract(o.snapshot_json,'$.address.areaId'),
 json_extract(o.snapshot_json,'$.restaurant.name'),NULL,CAST(json_extract(o.snapshot_json,'$.totals.totalKobo') AS BIGINT),NULL,
 CASE WHEN cp.id IS NOT NULL THEN COALESCE(json_extract(cp.receipt_json,'$.mode'),CASE WHEN cp.reference LIKE 'TA-TEST-%' THEN 'test' ELSE 'unverified' END)
 ELSE COALESCE(json_extract(o.snapshot_json,'$.payment.method'),'test') END,
 COALESCE(json_extract(o.snapshot_json,'$.payment.status'),'not_charged'),cp.target_id
 FROM eats_orders o JOIN users c ON c.id=o.customer_id LEFT JOIN users w ON w.id=o.courier_id JOIN eats_stores s ON s.id=o.store_id
 LEFT JOIN checkout_payments cp ON cp.kind='food' AND cp.target_id=json_extract(o.snapshot_json,'$.payment.targetId')
)`;
function where(filter, now, paged = true) {
 const clauses = ['createdAt >= $start','createdAt < $end'], args = { now, start: filter.start, end: filter.end };
 if (filter.service !== 'all') { clauses.push('service=$service'); args.service=filter.service; }
 if (filter.status === 'active') clauses.push("status NOT IN ('completed','delivered','cancelled','rejected','expired')");
 else if(filter.status !== 'all') { clauses.push('status=$status'); args.status=filter.status; }
 if(filter.accountId) { clauses.push('(customerId=$accountId OR workerId=$accountId OR storeId IN (SELECT store_id FROM eats_memberships WHERE user_id=$accountId))'); args.accountId=filter.accountId; }
 if(filter.storeId) { clauses.push('storeId=$storeId'); args.storeId=filter.storeId; }
 for(const field of ['customerId','workerId'])if(filter[field]){clauses.push(field+'=$'+field);args[field]=filter[field];}
 if(filter.participation&&filter.participation!=='all'){
  clauses.push(filter.participation==='customer'?'customerId=$accountId':filter.participation==='worker'?'workerId=$accountId':'storeId IN (SELECT store_id FROM eats_memberships WHERE user_id=$accountId)');
 }
 for(const field of ['paymentMode','paymentStatus','vehicleCategory'])if(filter[field]&&filter[field]!=='all'){clauses.push(field+'=$'+field);args[field]=filter[field];}
 if(filter.area){clauses.push("(instr(lower(COALESCE(pickupArea,'')),$area)>0 OR instr(lower(COALESCE(destinationArea,'')),$area)>0 OR instr(lower(COALESCE(pickupName,'')),$area)>0 OR instr(lower(COALESCE(destinationName,'')),$area)>0)");args.area=filter.area.toLowerCase();}
 if(filter.q) { clauses.push("(instr(lower(id),$q)>0 OR instr(lower(customerName),$q)>0 OR instr(lower(COALESCE(workerName,'')),$q)>0 OR instr(lower(COALESCE(storeName,'')),$q)>0 OR instr(lower(COALESCE(destinationName,destinationArea,'')),$q)>0)"); args.q=filter.q.toLowerCase(); }
 if(paged && filter.before) {
  clauses.push('(createdAt<$cursorTime OR (createdAt=$cursorTime AND (service<$cursorKind OR (service=$cursorKind AND id<$cursorId))))');
  Object.assign(args,{cursorTime:filter.before.createdAt,cursorKind:filter.before.service,cursorId:filter.before.id});
 }
 return { sql:' WHERE '+clauses.join(' AND '), args };
}
export function createAdminTransactionsRepository(db) {
 const list = async(filter,now)=>{const part=where(filter,now);return db.prepare(common+' SELECT * FROM activity'+part.sql+' ORDER BY createdAt DESC,service DESC,id DESC LIMIT $limit').all({...part.args,limit:filter.limit+1});};
 return Object.freeze({
  list,
  async *facts(filter,now) { let before=null; for(;;) { const rows=await list({...filter,before,limit:999},now); for(const row of rows) yield row; if(rows.length<1000)return; const last=rows.at(-1);before={createdAt:last.createdAt,service:last.service,id:last.id}; } },
  async one(kind,id,now) { return await db.prepare(common+' SELECT * FROM activity WHERE service=$kind AND id=$id').get({now,kind,id})??null; },
  async checkout(orderId,now) {
   const group=await db.prepare(`SELECT c.id AS checkoutId,c.quote_ids_json AS quoteIds FROM eats_checkouts c JOIN eats_quotes q ON q.customer_id=c.customer_id WHERE q.order_id=? AND EXISTS(SELECT 1 FROM json_each(c.quote_ids_json) WHERE value=q.id) ORDER BY c.created_at DESC,c.id DESC LIMIT 1`).get(orderId);
   if(!group)return null;
   const orders=await db.prepare(common+" SELECT * FROM activity WHERE service='food' AND id IN(SELECT q.order_id FROM eats_quotes q WHERE q.id IN(SELECT value FROM json_each($quoteIds))) ORDER BY createdAt,id").all({now,quoteIds:group.quoteIds});
   return {id:group.checkoutId,orders};
  },
  async details(kind,id) {
   if(kind==='food')return await db.prepare(`SELECT snapshot_json AS snapshotJson,events_json AS eventsJson,courier_json AS vehicleJson FROM eats_orders WHERE id=?`).get(id);
   return await db.prepare(`SELECT q.route_json AS routeJson,d.details_json AS deliveryJson,r.driver_snapshot_json AS vehicleJson,(SELECT json_extract(g.snapshot_json,'$.name') FROM guest_ride_passengers g WHERE g.ride_id=r.id) AS passengerName,t.booked_at AS bookedAt,t.departed_at AS departedAt,t.arrived_at AS arrivedAt,t.started_at AS startedAt,t.completed_at AS completedAt
    FROM rides r LEFT JOIN location_quotes q ON q.ride_id=r.id LEFT JOIN delivery_orders d ON d.ride_id=r.id LEFT JOIN ride_trips t ON t.ride_id=r.id WHERE r.id=?`).get(id);
  },
  async timeline(id) {return db.prepare('SELECT a.type,a.reason,a.created_at AS createdAt,u.name AS actorName FROM ride_activity a JOIN users u ON u.id=a.actor_id WHERE a.ride_id=? ORDER BY a.id').all(id);},
  async fares(id) { return db.prepare('SELECT version,type,payload FROM fare_events WHERE ride_id=? ORDER BY version').all(id); },
  async calls(id) { return db.prepare('SELECT id,status,created_at AS createdAt,connected_at AS connectedAt,ended_at AS endedAt,reason FROM voice_calls WHERE ride_id=? ORDER BY created_at DESC,id LIMIT 50').all(id); },
  async deliveryEvidence(id) { return await db.prepare('SELECT verified_at AS verifiedAt,verification_method AS method,position_recorded AS locationRecorded FROM delivery_handover_evidence WHERE ride_id=?').get(id)??null; },
  async deliveryEvents(id) {return db.prepare('SELECT id,kind,note,created_at AS createdAt,version FROM delivery_exception_events WHERE ride_id=? ORDER BY version').all(id);},
  async profiles(q,before,limit,type='all') {
   return db.prepare(`SELECT u.id,u.name,u.email,u.created_at AS createdAt,d.status AS driverStatus,d.vehicle_model AS vehicleModel,d.vehicle_plate AS plate,
    a.status AS applicationStatus,EXISTS(SELECT 1 FROM account_capabilities c WHERE c.user_id=u.id AND c.capability='driver') AS driverCapability,
    m.store_id AS storeId,json_extract(s.details_json,'$.name') AS storeName
    FROM users u LEFT JOIN drivers d ON d.user_id=u.id LEFT JOIN driver_applications a ON a.driver_id=u.id
    LEFT JOIN eats_memberships m ON m.user_id=u.id LEFT JOIN eats_stores s ON s.id=m.store_id WHERE u.role<>'admin'
    AND (instr(lower(u.name),?)>0 OR instr(lower(u.email),?)>0 OR instr(u.id,?)>0 OR instr(lower(COALESCE(d.vehicle_plate,'')),?)>0)
    AND (? IS NULL OR u.id>?)
    AND (?='all' OR (?='driver' AND EXISTS(SELECT 1 FROM account_capabilities c WHERE c.user_id=u.id AND c.capability='driver'))
      OR (?='vendor' AND m.store_id IS NOT NULL) OR (?='customer' AND EXISTS(SELECT 1 FROM account_capabilities c WHERE c.user_id=u.id AND c.capability='customer')))
    ORDER BY u.id LIMIT ?`).all(q,q,q,q,before,before,type,type,type,type,limit+1);
  },
  async profile(id) { return await db.prepare(`SELECT u.id,u.name,u.email,u.created_at AS createdAt,EXISTS(SELECT 1 FROM account_email_verifications ev WHERE ev.user_id=u.id AND ev.email=u.email) AS emailVerified,
   d.status AS driverStatus,d.vehicle_model AS vehicleModel,d.vehicle_plate AS plate,a.status AS applicationStatus
   FROM users u LEFT JOIN drivers d ON d.user_id=u.id LEFT JOIN driver_applications a ON a.driver_id=u.id WHERE u.id=? AND u.role<>'admin'`).get(id)??null; },
  async stores(q,before,limit) { return db.prepare(`SELECT s.id,s.status,s.is_open AS isOpen,s.version,s.created_at AS createdAt,s.updated_at AS updatedAt,
   json_extract(s.details_json,'$.name') AS name,json_extract(s.details_json,'$.sellerType') AS sellerType,json_extract(s.details_json,'$.areaId') AS areaId,
   m.user_id AS ownerId,u.name AS ownerName,(SELECT COUNT(*) FROM eats_menu x WHERE x.store_id=s.id AND x.available=1) AS availableItems
   FROM eats_stores s LEFT JOIN eats_memberships m ON m.store_id=s.id LEFT JOIN users u ON u.id=m.user_id
   WHERE (instr(lower(COALESCE(json_extract(s.details_json,'$.name'),'')),?)>0 OR instr(s.id,?)>0) AND (? IS NULL OR s.id>?) ORDER BY s.id LIMIT ?`).all(q,q,before,before,limit+1); },
  async store(id) { return await db.prepare(`SELECT id,status,is_open AS isOpen,version,details_json AS detailsJson,created_at AS createdAt,updated_at AS updatedAt FROM eats_stores WHERE id=?`).get(id)??null; },
  async menu(id) { return db.prepare("SELECT id,available,json_extract(details_json,'$.name') AS name,json_extract(details_json,'$.priceKobo') AS priceKobo,json_extract(details_json,'$.portionsRemaining') AS portionsRemaining FROM eats_menu WHERE store_id=? ORDER BY id").all(id); },
  async dispatch(id,now) {return db.prepare("SELECT CASE WHEN status='pending' AND expires_at<=$now THEN 'expired' ELSE status END AS status,eta_source AS etaSource,COUNT(*) AS count FROM dispatch_offers WHERE ride_id=$id GROUP BY CASE WHEN status='pending' AND expires_at<=$now THEN 'expired' ELSE status END,eta_source ORDER BY status,eta_source").all({now,id});},
  async recordAccess(actorId,kind,subjectId,detail,now) { await db.prepare('INSERT INTO admin_access_events(actor_id,action,subject_id,detail,created_at) VALUES (?,?,?,?,?)').run(actorId,kind,subjectId,JSON.stringify(detail),now); },
 });
}
