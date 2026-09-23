import { randomUUID } from 'node:crypto';

const exists = (db, table) => Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(table));
const schemas = {
  ride_driver_ratings: [['ride_id','TEXT'],['customer_id','TEXT'],['driver_id','TEXT'],['stars','INTEGER'],['created_at','INTEGER']],
  eats_menu_photos: [['item_id','TEXT'],['store_id','TEXT'],['content','BLOB'],['size_bytes','INTEGER'],['version','INTEGER']],
};
function validateTable(db, table) {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all().map(({ name, type }) => [name,type]);
  if (JSON.stringify(columns) !== JSON.stringify(schemas[table])) throw new Error(`Unrecognized ${table} schema. Restore a backup and review the migration history.`);
}

/** Versions 20/21 existed on two development branches. Identify the actual schema
 * before choosing a path; never infer a branch from the version number alone. */
export function reconcileLegacyVersion(db, version) {
  if (![20,21].includes(version) || exists(db, 'eats_photos')) return version;
  if (!exists(db, 'ride_driver_ratings') || (version === 21 && !exists(db, 'eats_menu_photos'))
    || exists(db, 'eats_checkouts') || exists(db, 'guest_ride_passengers')) {
    throw new Error('Unrecognized schema-20/21 database. No migration was applied. Review its branch history.');
  }
  validateTable(db, 'ride_driver_ratings');
  if (exists(db, 'eats_menu_photos')) validateTable(db, 'eats_menu_photos');
  return 19;
}

/** Already-applied checkpoint tables are retained, including every rating/photo. */
export function applyIntegrationTable(db, version) {
  const table = ({ 24: 'ride_driver_ratings', 25: 'eats_menu_photos' })[version];
  if (!table || !exists(db, table)) return false;
  validateTable(db, table);
  if (version === 24) db.exec('CREATE INDEX IF NOT EXISTS ride_driver_ratings_driver ON ride_driver_ratings(driver_id, created_at DESC);');
  else db.exec('CREATE INDEX IF NOT EXISTS eats_menu_photos_store ON eats_menu_photos(store_id);');
  return true;
}

export function finishIntegrationMigration(db) {
  const aliases = { vendor: 'food_vendor', private_kitchen: 'home_kitchen' };
  for (const row of db.prepare('SELECT id, details_json FROM eats_stores').all()) {
    const details = JSON.parse(row.details_json);
    if (aliases[details.sellerType]) {
      details.sellerType = aliases[details.sellerType];
      db.prepare('UPDATE eats_stores SET details_json=? WHERE id=?').run(JSON.stringify(details),row.id);
    }
  }
  // Old order snapshots retain private collection details for assigned couriers,
  // while all public/customer projections continue through the privacy filter.
  for (const table of ['eats_orders', 'eats_quotes']) {
    for (const row of db.prepare(`SELECT id, snapshot_json FROM ${table}`).all()) {
      const snapshot = JSON.parse(row.snapshot_json), restaurant = snapshot.restaurant;
      if (restaurant && aliases[restaurant.sellerType]) {
        restaurant.sellerType = aliases[restaurant.sellerType];
        if (table === 'eats_orders' && restaurant.address) db.prepare('INSERT OR IGNORE INTO eats_collection_points(order_id,location) VALUES (?,?)').run(row.id,restaurant.address);
        db.prepare(`UPDATE ${table} SET snapshot_json=? WHERE id=?`).run(JSON.stringify(snapshot),row.id);
      }
    }
  }
  // Give old item-based photos a canonical ID so combined meal search can render
  // them too. Original bytes and photo versions remain available to older clients.
  for (const row of db.prepare('SELECT p.item_id,p.store_id,p.content,m.details_json FROM eats_menu_photos p JOIN eats_menu m ON m.id=p.item_id').all()) {
    const details = JSON.parse(row.details_json);
    if (details.photoId && db.prepare('SELECT 1 FROM eats_photos WHERE id=? AND store_id=?').get(details.photoId,row.store_id)) continue;
    const id = randomUUID();
    db.prepare('INSERT INTO eats_photos(id,store_id,base64,created_at) VALUES (?,?,?,?)').run(id,row.store_id,Buffer.from(row.content).toString('base64'),0);
    details.photoId = id;
    db.prepare('UPDATE eats_menu SET details_json=? WHERE id=?').run(JSON.stringify(details),row.item_id);
  }
}
