/** Remove only the new, empty feature tables when a test reconstructs an older schema. */
export function removeEatsFixtureTables(db) {
  removeGuestFixtureTables(db);
  for (const table of ['ride_driver_ratings', 'eats_menu_photos', 'eats_collection_points', 'eats_checkouts', 'eats_photos', 'eats_commands', 'eats_orders', 'eats_quotes', 'eats_menu', 'eats_reviews', 'eats_memberships', 'eats_stores']) {
    if (db.prepare(`SELECT count(*) AS count FROM ${table}`).get().count) throw new Error(`Cannot downgrade a populated ${table} fixture.`);
    db.exec(`DROP TABLE ${table}`);
  }
}

/** Guest tables are introduced after all older downgrade fixtures. */
export function removeGuestFixtureTables(db) {
  removeNationwideEatsFixtureTables(db);
  for (const table of ['guest_ride_commands', 'guest_ride_links', 'guest_ride_passengers']) {
    if (!db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(table)) continue;
    if (db.prepare(`SELECT count(*) AS count FROM ${table}`).get().count) throw new Error(`Cannot downgrade a populated ${table} fixture.`);
    db.exec(`DROP TABLE ${table}`);
  }
}

/** Private dispatch points are introduced after the guest-ride fixtures. */
export function removeNationwideEatsFixtureTables(db) {
  removeSafetyMonitoringFixtureTables(db);
  for (const table of ['eats_order_dispatch_points', 'eats_store_dispatch_points']) {
    if (!db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(table)) continue;
    if (db.prepare(`SELECT count(*) AS count FROM ${table}`).get().count) throw new Error(`Cannot downgrade a populated ${table} fixture.`);
    db.exec(`DROP TABLE ${table}`);
  }
  db.exec('DROP INDEX IF EXISTS eats_store_area; DROP INDEX IF EXISTS eats_ready_area;');
}

/** Safety monitoring is additive in schema 26; downgrade fixtures must remove its empty tables. */
export function removeSafetyMonitoringFixtureTables(db) {
  removeDispatchFixtureTables(db);
  for (const table of ['safety_delivery_jobs','safety_auto_alerts','safety_monitor_sessions','safety_risk_zones','safety_monitor_commands']) {
    if (!db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(table)) continue;
    if (db.prepare(`SELECT count(*) AS count FROM ${table}`).get().count) throw new Error(`Cannot downgrade a populated ${table} fixture.`);
    db.exec(`DROP TABLE ${table}`);
  }
}

/** Reconstruct schema 26 without removing any original ride or fare records. */
export function removeDispatchFixtureTables(db) {
  removeRealtimeFixtureTables(db);
  for (const table of ['dispatch_commands', 'dispatch_offers', 'dispatch_journeys']) {
    if (!db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(table)) continue;
    // Journey rows are derived measurements written even under the legacy
    // policy. They did not exist in old fixtures; genuine invitations must be
    // empty before a test deliberately reconstructs an older database.
    if (table !== 'dispatch_journeys' && db.prepare(`SELECT count(*) AS count FROM ${table}`).get().count) {
      throw new Error(`Cannot downgrade a populated ${table} fixture.`);
    }
    db.exec(`DROP TABLE ${table}`);
  }
}


/** Revisions are derived invalidations; domain records remain unchanged by this fixture downgrade. */
export function removeRealtimeFixtureTables(db) {
  removeLocationScaleFixtureFields(db);
  for (const { name } of db.prepare("SELECT name FROM sqlite_master WHERE type='trigger' AND name LIKE 'realtime_%'").all()) {
    if (!/^realtime_[a-z_]+$/.test(name)) throw new Error('Unexpected realtime fixture trigger.');
    db.exec(`DROP TRIGGER ${name}`);
  }
  db.exec('DROP TABLE IF EXISTS account_revisions');
}

export function removeLocationScaleFixtureFields(db) {
  removeWorkerScaleFixtureFields(db);
  for (const index of ['availability_expiry_page', 'availability_active_page', 'availability_gps_candidates', 'availability_sample_candidates',
    'location_shares_expiry_page', 'location_shares_active_page', 'location_quotes_prunable']) db.exec(`DROP INDEX IF EXISTS ${index}`);
  const columns = db.prepare('PRAGMA table_info(driver_availability)').all().map(row => row.name);
  for (const column of ['expires_at', 'latitude', 'longitude']) if (columns.includes(column)) db.exec(`ALTER TABLE driver_availability DROP COLUMN ${column}`);
}

export function removeWorkerScaleFixtureFields(db) {
  db.exec('DROP INDEX IF EXISTS rides_dispatch_region; DROP INDEX IF EXISTS worker_lease_expiry; DROP TABLE IF EXISTS worker_leases');
  if (db.prepare('PRAGMA table_info(rides)').all().some(row => row.name === 'dispatch_region')) db.exec('ALTER TABLE rides DROP COLUMN dispatch_region');
}
