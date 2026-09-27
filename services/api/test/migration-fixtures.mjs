/** Schema 33 derives this new table from preserved legacy administrator identities. */
export function includeExpectedStaffOwners(db, baseline) {
  if (!baseline.has('staff_memberships')) return;
  baseline.set('staff_memberships', db.prepare(`SELECT id AS user_id,'owner' AS role,'active' AS status,
    1 AS version,created_at AS updated_at FROM users WHERE role='admin' ORDER BY id`).all());
}

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
  removeFamilyFixtureTables(db);
  db.exec('DROP INDEX IF EXISTS rides_dispatch_region; DROP INDEX IF EXISTS worker_lease_expiry; DROP TABLE IF EXISTS worker_leases');
  if (db.prepare('PRAGMA table_info(rides)').all().some(row => row.name === 'dispatch_region')) db.exec('ALTER TABLE rides DROP COLUMN dispatch_region');
}

/** Family sharing is opt-in; older fixtures must never discard real consent or trip grants. */
export function removeFamilyFixtureTables(db) {
  removeAdminWorkspaceFixtureTables(db);
  for (const { name } of db.prepare("SELECT name FROM sqlite_master WHERE type='trigger' AND (name LIKE 'family_%' OR name LIKE 'realtime_family_%')").all()) {
    if (!/^(?:realtime_)?family_[a-z_]+$/.test(name)) throw new Error('Unexpected family fixture trigger.');
    db.exec(`DROP TRIGGER ${name}`);
  }
  for (const table of ['family_push_jobs', 'family_commands', 'family_events', 'family_trip_state', 'family_shares', 'family_contacts', 'family_adults']) {
    if (!db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(table)) continue;
    if (db.prepare(`SELECT count(*) AS count FROM ${table}`).get().count) throw new Error(`Cannot downgrade a populated ${table} fixture.`);
    db.exec(`DROP TABLE ${table}`);
  }
}

/** Legacy owner rows are derived from users.role; real staff grants are not disposable fixtures. */
export function removeAdminWorkspaceFixtureTables(db) {
  removeAdminExpansionFixtureTables(db);
  const exists = table => db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(table);
  for (const index of ['admin_ops_ride_queue', 'admin_ops_active_trip', 'admin_ops_offer_cohort', 'admin_ops_eats_delays', 'admin_ops_available_queue']) {
    db.exec(`DROP INDEX IF EXISTS ${index}`);
  }
  for (const table of ['admin_case_commands', 'admin_case_events', 'admin_cases']) {
    if (!exists(table)) continue;
    const count = table === 'admin_cases'
      ? db.prepare('SELECT count(*) AS count FROM admin_cases WHERE incident_id IS NULL').get().count
      : table === 'admin_case_events'
        ? db.prepare("SELECT count(*) AS count FROM admin_case_events WHERE action<>'incident_linked' OR actor_id IS NOT NULL").get().count
        : db.prepare(`SELECT count(*) AS count FROM ${table}`).get().count;
    if (count) throw new Error(`Cannot downgrade a populated ${table} fixture.`);
    db.exec(`DROP TABLE ${table}`);
  }
  for (const table of ['staff_stepups', 'staff_mfa_pending', 'staff_mfa', 'staff_commands', 'staff_access_audit']) {
    if (!exists(table)) continue;
    if (db.prepare(`SELECT count(*) AS count FROM ${table}`).get().count) throw new Error(`Cannot downgrade a populated ${table} fixture.`);
    db.exec(`DROP TABLE ${table}`);
  }
  if (exists('staff_memberships')) {
    const distinctGrants = db.prepare(`SELECT count(*) AS count FROM staff_memberships m JOIN users u ON u.id=m.user_id
      WHERE m.role<>'owner' OR m.status<>'active' OR m.version<>1 OR u.role<>'admin'`).get().count;
    if (distinctGrants) throw new Error('Cannot downgrade a populated staff_memberships fixture.');
    db.exec('DROP TABLE staff_memberships');
  }
}


/** Kemmy setup is account preference state; old-schema fixtures may remove it only while empty. */
export function removeKemmyFixtureTables(db) {
  if (!db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='account_kemmy_setup'").get()) return;
  if (db.prepare('SELECT count(*) AS count FROM account_kemmy_setup').get().count) throw new Error('Cannot downgrade a populated account_kemmy_setup fixture.');
  db.exec('DROP TABLE account_kemmy_setup');
}

/** Announcements are durable staff-authored content; older-schema fixtures may remove only an entirely empty announcement feature. */
export function removeAnnouncementFixtureTables(db) {
  removeKemmyFixtureTables(db);
  const tables = ['announcement_push_jobs','admin_announcement_reads','admin_announcement_commands','admin_announcements'];
  const present = tables.filter(table => db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(table));
  for (const table of present) {
    if (db.prepare(`SELECT count(*) AS count FROM ${table}`).get().count) throw new Error(`Cannot downgrade a populated ${table} fixture.`);
  }
  for (const table of present) db.exec(`DROP TABLE ${table}`);
}

/** Compliance tasks are durable operator work; an older-schema fixture may remove only empty tables. */
export function removeAdminExpansionFixtureTables(db) {
  removeAnnouncementFixtureTables(db);
  const tables = ['parcel_tracking_commands', 'parcel_tracking_links', 'driver_face_checks', 'admin_compliance_commands', 'admin_compliance_events', 'admin_compliance_followups'];
  const present = tables.filter(table => db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(table));
  for (const table of present) {
    if (db.prepare(`SELECT count(*) AS count FROM ${table}`).get().count) throw new Error(`Cannot downgrade a populated ${table} fixture.`);
  }
  for (const table of present) db.exec(`DROP TABLE ${table}`);
  for (const index of ['admin_compliance_due', 'admin_compliance_history', 'admin_compliance_documents', 'admin_compliance_applications']) {
    db.exec(`DROP INDEX IF EXISTS ${index}`);
  }
}
