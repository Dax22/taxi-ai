const documentColumns = `id, driver_id AS driverId, kind, name, mime_type AS mimeType,
  size_bytes AS sizeBytes, sha256, expires_on AS expiresOn, created_at AS createdAt`;
function profile(row) {
  const approved = row?.status === 'approved' && row.approved_details ? JSON.parse(row.approved_details).vehicle : null;
  return row ? { id: row.user_id, status: row.status,
    vehicle: { model: row.vehicle_model, plate: row.vehicle_plate,
      ...(approved ? { make: approved.make, modelName: approved.model, year: approved.year, colour: approved.colour, category: approved.category ?? 'standard', payloadKg: approved.payloadKg ?? null } : {}) } } : null;
}
function application(row) {
  return row ? { driverId: row.driver_id, status: row.status, version: row.version,
    details: row.details_json ? JSON.parse(row.details_json) : null, submittedAt: row.submitted_at,
    updatedAt: row.updated_at, reviewedAt: row.reviewed_at, reviewedBy: row.reviewed_by,
    reviewReason: row.review_reason, verification: row.verification_json ? JSON.parse(row.verification_json) : null } : null;
}
function faceCheck(row) {
  return row ? { id: row.id, driverId: row.driver_id, applicationVersion: row.application_version,
    documents: JSON.parse(row.documents_json), consentVersion: row.consent_version, consentedAt: row.consented_at,
    provider: row.provider, status: row.status, reason: row.reason, similarity: row.similarity,
    threshold: row.threshold, startedAt: row.started_at, checkedAt: row.checked_at } : null;
}

/** All application, document and retry writes join the caller's transaction. */
export function createDriversRepository(db) {
  return Object.freeze({
    find: async (id) => profile((await db.prepare(`SELECT d.*, CASE WHEN a.status='approved' THEN a.details_json END AS approved_details
      FROM drivers d LEFT JOIN driver_applications a ON a.driver_id=d.user_id WHERE d.user_id = ?`).get(id))),
    list: async () => (await db.prepare(`SELECT d.*, CASE WHEN a.status='approved' THEN a.details_json END AS approved_details
      FROM drivers d JOIN driver_applications a ON a.driver_id=d.user_id
      JOIN account_capabilities c ON c.user_id=d.user_id AND c.capability='driver'
      ORDER BY (a.status='submitted') DESC, a.updated_at DESC, d.user_id LIMIT 100`).all()).map(profile),
    async insert(id, vehicle, now) {
      // Accounts checks that no active driver capability exists. Retain old IDs
      // and monotonic versions so history and stale command protection survive.
      (await db.prepare(`INSERT INTO drivers (user_id, vehicle_model, vehicle_plate) VALUES (?, ?, ?)
        ON CONFLICT(user_id) DO UPDATE SET vehicle_model=excluded.vehicle_model,vehicle_plate=excluded.vehicle_plate,
        status='pending',reviewed_by=NULL,reviewed_at=NULL`).run(id, vehicle.model, vehicle.plate));
      (await db.prepare(`INSERT INTO driver_applications(driver_id,updated_at) VALUES (?,?)
        ON CONFLICT(driver_id) DO UPDATE SET version=version+1,updated_at=excluded.updated_at`).run(id, now));
      if (vehicle.selection) (await db.prepare('INSERT INTO driver_vehicle_selections(driver_id,vehicle_json) VALUES (?,?)').run(id, JSON.stringify(vehicle.selection)));
    },
    async remove(id, now) {
      // Minimal rows and audit snapshots anchor historical trips/reviews. Active
      // profile details and current document bytes are removed atomically.
      (await db.prepare('DELETE FROM driver_documents WHERE driver_id=?').run(id));
      (await db.prepare("UPDATE driver_face_checks SET status='superseded' WHERE driver_id=?").run(id));
      (await db.prepare('DELETE FROM driver_vehicle_selections WHERE driver_id=?').run(id));
      (await db.prepare(`UPDATE drivers SET status='pending',vehicle_model='',vehicle_plate='',reviewed_by=NULL,reviewed_at=NULL WHERE user_id=?`).run(id));
      (await db.prepare(`UPDATE driver_applications SET status='draft',version=version+1,details_json=NULL,submitted_at=NULL,
        updated_at=?,reviewed_at=NULL,reviewed_by=NULL,review_reason=NULL,verification_json=NULL WHERE driver_id=?`).run(now,id));
      (await db.prepare(`INSERT INTO driver_application_events(driver_id,actor_id,action,version,payload_json,created_at)
        SELECT driver_id,driver_id,'profile_deleted',version,'{}',? FROM driver_applications WHERE driver_id=?`).run(now,id));
    },
    async selection(id) {
      const row = (await db.prepare('SELECT vehicle_json FROM driver_vehicle_selections WHERE driver_id=?').get(id));
      return row ? JSON.parse(row.vehicle_json) : null;
    },
    application: async (id) => application((await db.prepare('SELECT * FROM driver_applications WHERE driver_id=?').get(id))),
    documents: async (id) => (await db.prepare(`SELECT ${documentColumns} FROM driver_documents WHERE driver_id=? ORDER BY kind`).all(id)),
    document: async (id) => (await db.prepare(`SELECT ${documentColumns} FROM driver_documents WHERE id=?`).get(id)) ?? null,
    content: async (id) => (await db.prepare('SELECT content FROM driver_documents WHERE id=?').get(id))?.content,
    storageBytes: async () => (await db.prepare('SELECT COALESCE(SUM(size_bytes),0) AS bytes FROM driver_documents').get()).bytes,
    removeDocument: async (id) => (await db.prepare('DELETE FROM driver_documents WHERE id=?').run(id)),
    async insertDocument({ id, driverId, kind, name, mimeType, sizeBytes, sha256, expiresOn, content, now }) {
      (await db.prepare(`INSERT INTO driver_documents(id,driver_id,kind,name,mime_type,size_bytes,sha256,expires_on,content,created_at)
        VALUES (?,?,?,?,?,?,?,?,?,?)`).run(id, driverId, kind, name, mimeType, sizeBytes, sha256, expiresOn, content, now));
    },
    async readDocument(id, reviewerId, now) {
      (await db.prepare(`INSERT INTO driver_document_reads(document_id,reviewer_id,read_at) VALUES (?,?,?)
        ON CONFLICT(document_id,reviewer_id) DO UPDATE SET read_at=excluded.read_at`).run(id, reviewerId, now));
    },
    readIds: async (driverId, reviewerId) => (await db.prepare(`SELECT r.document_id AS id FROM driver_document_reads r
      JOIN driver_documents d ON d.id=r.document_id WHERE d.driver_id=? AND r.reviewer_id=?`).all(driverId, reviewerId)).map((row) => row.id),
    async save(app) {
      if (app.details) (await db.prepare('DELETE FROM driver_vehicle_selections WHERE driver_id=?').run(app.driverId));
      (await db.prepare(`UPDATE driver_applications SET status=?,version=?,details_json=?,submitted_at=?,updated_at=?,
        reviewed_at=?,reviewed_by=?,review_reason=?,verification_json=? WHERE driver_id=?`).run(app.status, app.version,
        app.details ? JSON.stringify(app.details) : null, app.submittedAt, app.updatedAt, app.reviewedAt,
        app.reviewedBy, app.reviewReason, app.verification ? JSON.stringify(app.verification) : null, app.driverId));
    },
    async setProfile(id, status, details, reviewerId, now) {
      (await db.prepare(`UPDATE drivers SET status=?, reviewed_by=?, reviewed_at=?,
        vehicle_model=COALESCE(?,vehicle_model),vehicle_plate=COALESCE(?,vehicle_plate) WHERE user_id=?`)
        .run(status, reviewerId, reviewerId ? now : null, details ? `${details.vehicle.make} ${details.vehicle.model}` : null,
          details?.vehicle.plate ?? null, id));
    },
    async event(driverId, actorId, action, version, payload, now) {
      (await db.prepare(`INSERT INTO driver_application_events(driver_id,actor_id,action,version,payload_json,created_at)
        VALUES (?,?,?,?,?,?)`).run(driverId, actorId, action, version, JSON.stringify(payload), now));
    },
    events: async (id) => (await db.prepare(`SELECT id,actor_id AS actorId,action,version,payload_json,created_at AS createdAt
      FROM driver_application_events WHERE driver_id=? ORDER BY id DESC LIMIT 100`).all(id))
      .map(({ payload_json, ...row }) => ({ ...row, payload: JSON.parse(payload_json) })),
    command: async (actorId, key) => (await db.prepare(`SELECT fingerprint,driver_id AS driverId FROM driver_application_commands WHERE actor_id=? AND key=?`).get(actorId, key)),
    async saveCommand(actorId, key, fingerprint, driverId) {
      (await db.prepare('INSERT INTO driver_application_commands(actor_id,key,fingerprint,driver_id) VALUES (?,?,?,?)').run(actorId, key, fingerprint, driverId));
    },
    faceCheck: async (id) => faceCheck(await db.prepare("SELECT * FROM driver_face_checks WHERE driver_id=? AND status<>'superseded'").get(id)),
    faceAttempt: async (id) => faceCheck(await db.prepare('SELECT * FROM driver_face_checks WHERE id=?').get(id)),
    faceAttempts: async (id, since) => (await db.prepare('SELECT * FROM driver_face_checks WHERE driver_id=? AND started_at>=? ORDER BY started_at DESC,id').all(id, since)).map(faceCheck),
    invalidateFaceChecks: async (id) => await db.prepare("UPDATE driver_face_checks SET status='superseded' WHERE driver_id=? AND status<>'superseded'").run(id),
    async insertFaceCheck(row) {
      await db.prepare(`INSERT INTO driver_face_checks(id,driver_id,application_version,documents_json,consent_version,consented_at,
        provider,status,threshold,started_at) VALUES(?,?,?,?,?,?,?,'pending',?,?)`).run(row.id, row.driverId, row.applicationVersion,
        JSON.stringify(row.documents), row.consentVersion, row.consentedAt, row.provider, row.threshold, row.startedAt);
    },
    async completeFaceCheck(id, { status, reason, similarity, checkedAt }) {
      await db.prepare('UPDATE driver_face_checks SET status=?,reason=?,similarity=?,checked_at=? WHERE id=?')
        .run(status, reason, similarity, checkedAt, id);
    },
  });
}
