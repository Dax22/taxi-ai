const storeColumns = `id, status, version, is_open AS isOpen, details_json AS details, review_note AS reviewNote, created_at AS createdAt, updated_at AS updatedAt,
  (SELECT json_object('lat', p.lat, 'lng', p.lng) FROM eats_store_dispatch_points p WHERE p.store_id=eats_stores.id) AS dispatchPoint,
  (SELECT json_extract(m.details_json, '$.photoId') FROM eats_menu m WHERE m.store_id=eats_stores.id AND m.available=1 AND json_extract(m.details_json, '$.photoId') IS NOT NULL ORDER BY m.id LIMIT 1) AS coverPhotoId`;
const orderColumns = `id, store_id AS storeId, customer_id AS customerId, courier_id AS courierId, status, version, snapshot_json AS snapshot,
  courier_json AS courier, pickup_pin AS pickupPin, delivery_pin AS deliveryPin, pin_failures AS pinFailures, pin_blocked_until AS pinBlockedUntil,
  events_json AS events, created_at AS createdAt, updated_at AS updatedAt,
  (SELECT location FROM eats_collection_points WHERE order_id=eats_orders.id) AS collectionPoint`;
const store = (row, deliveryAreas) => {
  if (!row) return null;
  const profile = JSON.parse(row.details);
  return { sellerType: 'restaurant', deliveryEnabled: true, pickupEnabled: false, ...profile, ...row, details: undefined,
    deliveryAreaIds: [...deliveryAreas(profile)], dispatchPoint: row.dispatchPoint ? JSON.parse(row.dispatchPoint) : null, isOpen: Boolean(row.isOpen) };
};
const order = (row) => row ? { ...row, snapshot: JSON.parse(row.snapshot), courier: row.courier ? JSON.parse(row.courier) : null, events: JSON.parse(row.events) } : null;
export function createEatsRepository(db, { deliveryAreas, legacyAreaIds: EATS_LEGACY_AREA_IDS, distanceMeters }) {
  const readStore = (row) => store(row, deliveryAreas);
  return Object.freeze({
    store: (id) => readStore(db.prepare(`SELECT ${storeColumns} FROM eats_stores WHERE id = ?`).get(id)),
    stores(admin = false, { areaId = null, deliveryAreaId = null, openOnly = false, excludeMemberId = null, fulfillment = '' } = {}) {
      // Geographic eligibility runs before the bounded page, so stores in an
      // unrelated state cannot crowd a local kitchen out of discovery.
      return db.prepare(`SELECT ${storeColumns} FROM eats_stores WHERE (? = 1 OR status = 'approved')
        AND (? IS NULL OR json_extract(details_json,'$.areaId')=?)
        AND (?=0 OR is_open=1)
        AND (?<>'pickup' OR COALESCE(json_extract(details_json,'$.pickupEnabled'),0)=1)
        AND (?<>'delivery' OR COALESCE(json_extract(details_json,'$.deliveryEnabled'),1)=1)
        AND (? IS NULL OR id NOT IN (SELECT store_id FROM eats_memberships WHERE user_id=?))
        AND (? IS NULL OR (COALESCE(json_extract(details_json,'$.deliveryEnabled'),1)=1
          AND (EXISTS(SELECT 1 FROM eats_store_dispatch_points p WHERE p.store_id=eats_stores.id) OR json_extract(details_json,'$.areaId') IN (SELECT value FROM json_each(?))) AND (
          EXISTS(SELECT 1 FROM json_each(details_json,'$.deliveryAreaIds') WHERE value=?)
          OR (json_type(details_json,'$.deliveryAreaIds') IS NULL AND (
            (json_extract(details_json,'$.areaId') IN (SELECT value FROM json_each(?)) AND ? IN (SELECT value FROM json_each(?)))
            OR (json_extract(details_json,'$.areaId') NOT IN (SELECT value FROM json_each(?)) AND json_extract(details_json,'$.areaId')=?)
          ))))) ORDER BY created_at DESC, id DESC LIMIT 200`)
        .all(admin ? 1 : 0, areaId, areaId, openOnly ? 1 : 0, fulfillment, fulfillment, excludeMemberId, excludeMemberId, deliveryAreaId, JSON.stringify(EATS_LEGACY_AREA_IDS), deliveryAreaId,
          JSON.stringify(EATS_LEGACY_AREA_IDS), deliveryAreaId, JSON.stringify(EATS_LEGACY_AREA_IDS), JSON.stringify(EATS_LEGACY_AREA_IDS), deliveryAreaId).map(readStore);
    },
    membership: (userId) => db.prepare('SELECT store_id AS storeId, role FROM eats_memberships WHERE user_id = ?').get(userId) ?? null,
    members: (storeId) => db.prepare('SELECT user_id AS userId FROM eats_memberships WHERE store_id = ?').all(storeId),
    review(storeId, reviewerId, decision, reason, reference, now) { db.prepare('INSERT INTO eats_reviews (store_id,reviewer_id,decision,reason,reference,created_at) VALUES (?,?,?,?,?,?)').run(storeId,reviewerId,decision,reason,reference,now); },
    createStore(value, userId, now) {
      const { dispatchPoint, ...profile } = value.details;
      db.prepare(`INSERT INTO eats_stores (id,status,details_json,created_at,updated_at) VALUES (?,'pending',?,?,?)`).run(value.id, JSON.stringify(profile), now, now);
      db.prepare("INSERT INTO eats_memberships (user_id,store_id,role) VALUES (?,?,'owner')").run(userId, value.id);
      if (dispatchPoint) db.prepare('INSERT INTO eats_store_dispatch_points (store_id,lat,lng) VALUES (?,?,?)').run(value.id, dispatchPoint.lat, dispatchPoint.lng);
    },
    saveStore(value) {
      const { id, status, version, isOpen, reviewNote, createdAt, updatedAt, details, addressHidden, coverPhotoId, dispatchPoint, ...profile } = value;
      db.prepare('UPDATE eats_stores SET status=?,version=?,is_open=?,details_json=?,review_note=?,updated_at=? WHERE id=?')
        .run(status, version, isOpen ? 1 : 0, JSON.stringify(profile), reviewNote, updatedAt, id);
      if (dispatchPoint) db.prepare('INSERT INTO eats_store_dispatch_points (store_id,lat,lng) VALUES (?,?,?) ON CONFLICT(store_id) DO UPDATE SET lat=excluded.lat,lng=excluded.lng').run(id, dispatchPoint.lat, dispatchPoint.lng);
      else db.prepare('DELETE FROM eats_store_dispatch_points WHERE store_id=?').run(id);
    },
    menu: (storeId) => db.prepare(`SELECT m.id,m.details_json AS details,p.version AS photoVersion FROM eats_menu m
      LEFT JOIN eats_menu_photos p ON p.item_id=m.id WHERE m.store_id=? ORDER BY m.id`).all(storeId)
      .map((row) => ({ id: row.id, ...JSON.parse(row.details), photoVersion: row.photoVersion ?? null })),
    menuItem: (id) => { const row = db.prepare('SELECT store_id AS storeId,details_json AS details FROM eats_menu WHERE id=?').get(id); return row ? { id, storeId: row.storeId, ...JSON.parse(row.details) } : null; },
    menuPhoto: (itemId) => db.prepare('SELECT store_id AS storeId,content,version FROM eats_menu_photos WHERE item_id=?').get(itemId) ?? null,
    photoBytes: (storeId) => db.prepare('SELECT COALESCE(SUM(size_bytes),0) AS bytes FROM eats_menu_photos WHERE store_id=?').get(storeId).bytes,
    saveMenuPhoto(itemId, storeId, content, version) { db.prepare(`INSERT INTO eats_menu_photos(item_id,store_id,content,size_bytes,version) VALUES (?,?,?,?,?)
      ON CONFLICT(item_id) DO UPDATE SET content=excluded.content,size_bytes=excluded.size_bytes,version=excluded.version`)
      .run(itemId,storeId,content,content.length,version); },
    removeMenuPhoto: (itemId) => db.prepare('DELETE FROM eats_menu_photos WHERE item_id=?').run(itemId),
    saveMenu(id, storeId, item) { db.prepare(`INSERT INTO eats_menu (id,store_id,available,details_json) VALUES (?,?,?,?)
      ON CONFLICT(id) DO UPDATE SET available=excluded.available,details_json=excluded.details_json`).run(id, storeId, item.available ? 1 : 0, JSON.stringify(item)); },
    photo: (id) => { const row = db.prepare('SELECT store_id AS storeId, base64 FROM eats_photos WHERE id=?').get(id); return row ?? null; },
    savePhoto(id, storeId, base64, now) { db.prepare('INSERT INTO eats_photos (id,store_id,base64,created_at) VALUES (?,?,?,?)').run(id,storeId,base64,now); },
    prunePhotos(storeId) { db.prepare("DELETE FROM eats_photos WHERE store_id=? AND id NOT IN (SELECT json_extract(details_json, '$.photoId') FROM eats_menu WHERE store_id=? AND json_extract(details_json, '$.photoId') IS NOT NULL)").run(storeId,storeId); },
    quote: (id) => { const row = db.prepare('SELECT id,customer_id AS customerId,store_id AS storeId,store_version AS storeVersion,snapshot_json AS snapshot,expires_at AS expiresAt,order_id AS orderId FROM eats_quotes WHERE id=?').get(id); return row ? { ...row, snapshot: JSON.parse(row.snapshot) } : null; },
    createQuote(q) { db.prepare('INSERT INTO eats_quotes (id,customer_id,store_id,store_version,snapshot_json,expires_at) VALUES (?,?,?,?,?,?)').run(q.id,q.customerId,q.storeId,q.storeVersion,JSON.stringify(q.snapshot),q.expiresAt); },
    bindQuote(id, orderId) { db.prepare('UPDATE eats_quotes SET order_id=? WHERE id=?').run(orderId,id); },
    checkout: (id) => { const row = db.prepare('SELECT id,customer_id AS customerId,quote_ids_json AS quoteIds FROM eats_checkouts WHERE id=?').get(id); return row ? { ...row, quoteIds: JSON.parse(row.quoteIds) } : null; },
    createCheckout(id, customerId, quoteIds, now) { db.prepare('INSERT INTO eats_checkouts (id,customer_id,quote_ids_json,created_at) VALUES (?,?,?,?)').run(id,customerId,JSON.stringify(quoteIds),now); },
    saveCollectionPoint(orderId, location) { db.prepare('INSERT INTO eats_collection_points (order_id,location) VALUES (?,?) ON CONFLICT(order_id) DO UPDATE SET location=excluded.location').run(orderId,location); },
    order: (id) => order(db.prepare(`SELECT ${orderColumns} FROM eats_orders WHERE id=?`).get(id)),
    orders(userId, scope, before = null) {
      const column = { customer: 'customer_id', store: 'store_id', courier: 'courier_id' }[scope];
      if (scope === 'store') {
        const closed = "(status IN ('delivered','cancelled','rejected'))", cursorClosed = ['delivered', 'cancelled', 'rejected'].includes(before?.status) ? 1 : 0;
        return db.prepare(`SELECT ${orderColumns} FROM eats_orders WHERE store_id=? AND
          (? IS NULL OR ${closed} > ? OR (${closed}=? AND (created_at < ? OR (created_at=? AND id<?))))
          ORDER BY ${closed},created_at DESC,id DESC LIMIT 51`)
          .all(userId,before?.id ?? null,cursorClosed,cursorClosed,before?.createdAt ?? null,before?.createdAt ?? null,before?.id ?? null).map(order);
      }
      return db.prepare(`SELECT ${orderColumns} FROM eats_orders WHERE ${column}=? AND (? IS NULL OR created_at < ? OR (created_at=? AND id<?)) ORDER BY created_at DESC,id DESC LIMIT 51`)
        .all(userId,before?.id ?? null,before?.createdAt ?? null,before?.createdAt ?? null,before?.id ?? null).map(order);
    },
    ready(position, radius, userId) {
      const eligibility = "status='ready' AND COALESCE(json_extract(snapshot_json, '$.fulfillment'), 'delivery')='delivery' AND customer_id<>? AND store_id NOT IN (SELECT store_id FROM eats_memberships WHERE user_id=?)";
      if (position.mode === 'sample') return db.prepare(`SELECT ${orderColumns} FROM eats_orders WHERE ${eligibility}
        AND json_extract(snapshot_json,'$.restaurant.areaId')=? ORDER BY created_at,id LIMIT 100`).all(userId, userId, position.areaId).map(order);

      // The supported Node 22.12 SQLite API has neither user-defined functions
      // nor statement iterators. Read bounded keyset pages, then apply the same
      // exact distance rule used on claim before counting a job toward the cap.
      // This conservative box contains the radius at every Nigerian latitude.
      const point = position.position, latitudeSpan = radius / 110_000;
      const longitudeSpan = latitudeSpan / Math.cos((Math.abs(point.lat) + latitudeSpan) * Math.PI / 180);
      const statement = db.prepare(`SELECT ${orderColumns}, p.lat AS dispatchLat, p.lng AS dispatchLng
        FROM eats_orders JOIN eats_order_dispatch_points p ON p.order_id=eats_orders.id WHERE ${eligibility}
        AND p.lat BETWEEN ? AND ? AND p.lng BETWEEN ? AND ?
        AND (? IS NULL OR created_at>? OR (created_at=? AND id>?)) ORDER BY created_at,id LIMIT 100`);
      const available = []; let cursor = null;
      while (available.length < 100) {
        const candidates = statement.all(userId, userId, point.lat - latitudeSpan, point.lat + latitudeSpan,
          point.lng - longitudeSpan, point.lng + longitudeSpan, cursor?.id ?? null, cursor?.createdAt ?? null, cursor?.createdAt ?? null, cursor?.id ?? null);
        for (const { dispatchLat, dispatchLng, ...row } of candidates) {
          if (distanceMeters(point, { lat: dispatchLat, lng: dispatchLng }) <= radius) available.push(order(row));
          if (available.length === 100) break;
        }
        if (candidates.length < 100) break;
        cursor = candidates.at(-1);
      }
      return available;
    },
    orderDispatchPoint: (id) => db.prepare('SELECT lat,lng FROM eats_order_dispatch_points WHERE order_id=?').get(id) ?? null,
    activeCourier: (id) => db.prepare(`SELECT ${orderColumns} FROM eats_orders WHERE courier_id=? AND status IN ('assigned','picked_up','arrived')`).all(id).map(order),
    hasWork: (id) => Boolean(db.prepare("SELECT 1 FROM eats_orders WHERE courier_id=? AND status IN ('assigned','picked_up','arrived')").get(id)),
    createOrder(o) { db.prepare(`INSERT INTO eats_orders (id,store_id,customer_id,status,snapshot_json,pickup_pin,delivery_pin,events_json,created_at,updated_at)
      VALUES (?,?,?,'placed',?,?,?,?,?,?)`).run(o.id,o.storeId,o.customerId,JSON.stringify(o.snapshot),o.pickupPin,o.deliveryPin,JSON.stringify(o.events),o.createdAt,o.updatedAt);
      if (o.dispatchPoint) db.prepare('INSERT INTO eats_order_dispatch_points (order_id,lat,lng) VALUES (?,?,?)').run(o.id,o.dispatchPoint.lat,o.dispatchPoint.lng);
    },
    saveOrder(o) { db.prepare(`UPDATE eats_orders SET courier_id=?,courier_json=?,status=?,version=?,pickup_pin=?,delivery_pin=?,pin_failures=?,pin_blocked_until=?,events_json=?,updated_at=? WHERE id=?`)
      .run(o.courierId,o.courier ? JSON.stringify(o.courier) : null,o.status,o.version,o.pickupPin,o.deliveryPin,o.pinFailures,o.pinBlockedUntil,JSON.stringify(o.events),o.updatedAt,o.id); },
    command: (id,key) => { const row = db.prepare('SELECT fingerprint,result_json AS result FROM eats_commands WHERE actor_id=? AND key=?').get(id,key); return row ? { ...row, result: JSON.parse(row.result) } : null; },
    saveCommand(id,key,fingerprint,result,now) { db.prepare('INSERT INTO eats_commands (actor_id,key,fingerprint,result_json,created_at) VALUES (?,?,?,?,?)').run(id,key,fingerprint,JSON.stringify(result),now); },
  });
}
