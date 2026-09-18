function profile(row) {
  return row ? { id: row.user_id, status: row.status,
    vehicle: { model: row.vehicle_model, plate: row.vehicle_plate } } : null;
}

export function createDriversRepository(db) {
  return Object.freeze({
    find: (id) => profile(db.prepare('SELECT * FROM drivers WHERE user_id = ?').get(id)),
    list: () => db.prepare("SELECT * FROM drivers ORDER BY (status = 'pending') DESC, rowid DESC LIMIT 100").all().map(profile),
    insert(id, vehicle) {
      db.prepare('INSERT INTO drivers (user_id, vehicle_model, vehicle_plate) VALUES (?, ?, ?)').run(id, vehicle.model, vehicle.plate);
    },
    review(id, decision, reviewerId, now) {
      db.prepare('UPDATE drivers SET status = ?, reviewed_by = ?, reviewed_at = ? WHERE user_id = ?')
        .run(decision, reviewerId, now, id);
    },
  });
}
