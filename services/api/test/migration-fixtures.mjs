/** Remove only the new, empty feature tables when a test reconstructs an older schema. */
export function removeEatsFixtureTables(db) {
  for (const table of ['eats_commands', 'eats_orders', 'eats_quotes', 'eats_menu', 'eats_reviews', 'eats_memberships', 'eats_stores']) {
    if (db.prepare(`SELECT count(*) AS count FROM ${table}`).get().count) throw new Error(`Cannot downgrade a populated ${table} fixture.`);
    db.exec(`DROP TABLE ${table}`);
  }
}
