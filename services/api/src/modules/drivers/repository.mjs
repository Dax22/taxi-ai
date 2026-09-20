const documentColumns = `id, driver_id AS driverId, kind, name, mime_type AS mimeType,
  size_bytes AS sizeBytes, sha256, expires_on AS expiresOn, created_at AS createdAt`;
function profile(row) {
  const approved = row?.status === 'approved' && row.approved_details ? JSON.parse(row.approved_details).vehicle : null;
  return row ? { id: row.user_id, status: row.status,
    vehicle: { model: row.vehicle_model, plate: row.vehicle_plate,
      ...(approved ? { make: approved.make, modelName: approved.model, year: approved.year, colour: approved.colour } : {}) } } : null;
}
function application(row) {
  return row ? { driverId: row.driver_id, status: row.status, version: row.version,
    details: row.details_json ? JSON.parse(row.details_json) : null, submittedAt: row.submitted_at,
    updatedAt: row.updated_at, reviewedAt: row.reviewed_at, reviewedBy: row.reviewed_by,
    reviewReason: row.review_reason, verification: row.verification_json ? JSON.parse(row.verification_json) : null } : null;
}

/** All application, document and retry writes join the caller's transaction. */
export function createDriversRepository(db) {
  return Object.freeze({
    find: (id) => profile(db.prepare(`SELECT d.*, CASE WHEN a.status='approved' THEN a.details_json END AS approved_details
      FROM drivers d LEFT JOIN driver_applications a ON a.driver_id=d.user_id WHERE d.user_id = ?`).get(id)),
    list: () => db.prepare(`SELECT d.*, CASE WHEN a.status='approved' THEN a.details_json END AS approved_details
      FROM drivers d JOIN driver_applications a ON a.driver_id=d.user_id
      ORDER BY (a.status='submitted') DESC, a.updated_at DESC, d.user_id LIMIT 100`).all().map(profile),
    insert(id, vehicle, now) {
      db.prepare('INSERT INTO drivers (user_id, vehicle_model, vehicle_plate) VALUES (?, ?, ?)').run(id, vehicle.model, vehicle.plate);
      db.prepare('INSERT INTO driver_applications(driver_id,updated_at) VALUES (?,?)').run(id, now);
      if (vehicle.selection) db.prepare('INSERT INTO driver_vehicle_selections(driver_id,vehicle_json) VALUES (?,?)').run(id, JSON.stringify(vehicle.selection));
    },
    selection(id) {
      const row = db.prepare('SELECT vehicle_json FROM driver_vehicle_selections WHERE driver_id=?').get(id);
      return row ? JSON.parse(row.vehicle_json) : null;
    },
    application: (id) => application(db.prepare('SELECT * FROM driver_applications WHERE driver_id=?').get(id)),
    documents: (id) => db.prepare(`SELECT ${documentColumns} FROM driver_documents WHERE driver_id=? ORDER BY kind`).all(id),
    document: (id) => db.prepare(`SELECT ${documentColumns} FROM driver_documents WHERE id=?`).get(id) ?? null,
    content: (id) => db.prepare('SELECT content FROM driver_documents WHERE id=?').get(id)?.content,
    storageBytes: () => db.prepare('SELECT COALESCE(SUM(size_bytes),0) AS bytes FROM driver_documents').get().bytes,
    removeDocument: (id) => db.prepare('DELETE FROM driver_documents WHERE id=?').run(id),
    insertDocument({ id, driverId, kind, name, mimeType, sizeBytes, sha256, expiresOn, content, now }) {
      db.prepare(`INSERT INTO driver_documents(id,driver_id,kind,name,mime_type,size_bytes,sha256,expires_on,content,created_at)
        VALUES (?,?,?,?,?,?,?,?,?,?)`).run(id, driverId, kind, name, mimeType, sizeBytes, sha256, expiresOn, content, now);
    },
    readDocument(id, reviewerId, now) {
      db.prepare(`INSERT INTO driver_document_reads(document_id,reviewer_id,read_at) VALUES (?,?,?)
        ON CONFLICT(document_id,reviewer_id) DO UPDATE SET read_at=excluded.read_at`).run(id, reviewerId, now);
    },
    readIds: (driverId, reviewerId) => db.prepare(`SELECT r.document_id AS id FROM driver_document_reads r
      JOIN driver_documents d ON d.id=r.document_id WHERE d.driver_id=? AND r.reviewer_id=?`).all(driverId, reviewerId).map((row) => row.id),
    save(app) {
      if (app.details) db.prepare('DELETE FROM driver_vehicle_selections WHERE driver_id=?').run(app.driverId);
      db.prepare(`UPDATE driver_applications SET status=?,version=?,details_json=?,submitted_at=?,updated_at=?,
        reviewed_at=?,reviewed_by=?,review_reason=?,verification_json=? WHERE driver_id=?`).run(app.status, app.version,
        app.details ? JSON.stringify(app.details) : null, app.submittedAt, app.updatedAt, app.reviewedAt,
        app.reviewedBy, app.reviewReason, app.verification ? JSON.stringify(app.verification) : null, app.driverId);
    },
    setProfile(id, status, details, reviewerId, now) {
      db.prepare(`UPDATE drivers SET status=?, reviewed_by=?, reviewed_at=?,
        vehicle_model=COALESCE(?,vehicle_model),vehicle_plate=COALESCE(?,vehicle_plate) WHERE user_id=?`)
        .run(status, reviewerId, reviewerId ? now : null, details ? `${details.vehicle.make} ${details.vehicle.model}` : null,
          details?.vehicle.plate ?? null, id);
    },
    event(driverId, actorId, action, version, payload, now) {
      db.prepare(`INSERT INTO driver_application_events(driver_id,actor_id,action,version,payload_json,created_at)
        VALUES (?,?,?,?,?,?)`).run(driverId, actorId, action, version, JSON.stringify(payload), now);
    },
    events: (id) => db.prepare(`SELECT id,actor_id AS actorId,action,version,payload_json,created_at AS createdAt
      FROM driver_application_events WHERE driver_id=? ORDER BY id DESC LIMIT 100`).all(id)
      .map(({ payload_json, ...row }) => ({ ...row, payload: JSON.parse(payload_json) })),
    command: (actorId, key) => db.prepare(`SELECT fingerprint,driver_id AS driverId FROM driver_application_commands WHERE actor_id=? AND key=?`).get(actorId, key),
    saveCommand(actorId, key, fingerprint, driverId) {
      db.prepare('INSERT INTO driver_application_commands(actor_id,key,fingerprint,driver_id) VALUES (?,?,?,?)').run(actorId, key, fingerprint, driverId);
    },
  });
}
