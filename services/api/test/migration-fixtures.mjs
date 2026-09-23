/** Remove only the new, empty feature tables when a test reconstructs an older schema. */
export function removeEatsFixtureTables(db) {
  removeGuestFixtureTables(db);
  for (const table of ['eats_collection_points', 'eats_checkouts', 'eats_photos', 'eats_commands', 'eats_orders', 'eats_quotes', 'eats_menu', 'eats_reviews', 'eats_memberships', 'eats_stores']) {
    if (db.prepare(`SELECT count(*) AS count FROM ${table}`).get().count) throw new Error(`Cannot downgrade a populated ${table} fixture.`);
    db.exec(`DROP TABLE ${table}`);
  }
}

/** Guest tables are introduced after all older downgrade fixtures. */
export function removeGuestFixtureTables(db) {
  for (const table of ['guest_ride_commands', 'guest_ride_links', 'guest_ride_passengers']) {
    if (!db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(table)) continue;
    if (db.prepare(`SELECT count(*) AS count FROM ${table}`).get().count) throw new Error(`Cannot downgrade a populated ${table} fixture.`);
    db.exec(`DROP TABLE ${table}`);
  }
}
