// Compliance projections use current driver capabilities and document metadata.
// No document contents, legal names, licence numbers, phone numbers or home addresses leave this adapter.
const expiringKinds = "('driving_licence','vehicle_registration')";
const expired = `EXISTS (SELECT 1 FROM driver_documents doc WHERE doc.driver_id=a.driver_id AND doc.kind IN ${expiringKinds}
  AND (doc.expires_on IS NULL OR doc.expires_on<$today))`;
const expiring = `EXISTS (SELECT 1 FROM driver_documents doc WHERE doc.driver_id=a.driver_id AND doc.kind IN ${expiringKinds}
  AND doc.expires_on>=$today AND doc.expires_on<$horizon)`;
const missing = "(SELECT count(*) FROM driver_documents doc WHERE doc.driver_id=a.driver_id AND doc.kind IN ('profile_photo','driving_licence','vehicle_registration','vehicle_photo'))<4";
const eligible = `a.status='approved' AND a.details_json IS NOT NULL AND a.verification_json IS NOT NULL AND (json_extract(a.verification_json,'$.method')='admin_exception' OR (NOT (${missing}) AND NOT (${expired})))`;
const columns = `a.driver_id AS id,u.name,d.vehicle_model AS vehicleModel,d.vehicle_plate AS vehiclePlate,
  a.status AS applicationStatus,a.version AS applicationVersion,a.updated_at AS updatedAt,
  f.status AS followupStatus,f.due_at AS dueAt,f.note AS followupNote,f.version AS followupVersion,
  f.application_version AS followupApplicationVersion,f.actor_id AS actorId,actor.name AS actorName,
  f.updated_at AS followupUpdatedAt,f.completed_at AS completedAt`;
const source = `driver_applications a JOIN drivers d ON d.user_id=a.driver_id JOIN users u ON u.id=a.driver_id
  JOIN account_capabilities cap ON cap.user_id=a.driver_id AND cap.capability='driver'
  LEFT JOIN admin_compliance_followups f ON f.driver_id=a.driver_id LEFT JOIN users actor ON actor.id=f.actor_id`;
function bindings(sql, values) {
  return Object.fromEntries([...new Set(sql.match(/\$[A-Za-z_]+/g) ?? [])].map((name) => [name.slice(1), values[name.slice(1)]]));
}
function inputs(filter, now) {
  return { today: new Date(now + 3_600_000).toISOString().slice(0, 10), horizon: new Date(now + 30 * 86_400_000 + 3_600_000).toISOString().slice(0, 10),
    now, q: `%${filter.q.toLowerCase().replace(/[!%_]/g, '!$&')}%`, after: filter.after, limit: filter.limit + 1 };
}
const search = "(LOWER(u.name) LIKE $q ESCAPE '!' OR LOWER(d.vehicle_plate) LIKE $q ESCAPE '!')";
export function createAdminComplianceRepository(db) {
  const read = (sql, values, method = 'all') => db.prepare(sql)[method](bindings(sql, values));
  return Object.freeze({
    async list(filter, now) {
      const clauses = [], values = inputs(filter, now);
      if (filter.q) clauses.push(search);
      const queue = { submitted: "a.status='submitted'", expiring, expired, missing, eligible }[filter.queue];
      if (queue) clauses.push(queue);
      if (filter.followUp === 'open' || filter.followUp === 'done') { clauses.push('f.status=$followup'); values.followup = filter.followUp; }
      if (filter.followUp === 'overdue') clauses.push("f.status='open' AND f.due_at<=$now");
      if (filter.after) clauses.push('a.driver_id>$after');
      return read(`SELECT ${columns} FROM ${source} ${clauses.length ? `WHERE ${clauses.join(' AND ')}` : ''}
        ORDER BY a.driver_id LIMIT $limit`, values);
    },
    async counts(filter, now) {
      const sql = `SELECT count(*) AS "all",COALESCE(sum(CASE WHEN a.status='submitted' THEN 1 ELSE 0 END),0) AS submitted,
        COALESCE(sum(CASE WHEN ${expiring} THEN 1 ELSE 0 END),0) AS expiring,
        COALESCE(sum(CASE WHEN ${expired} THEN 1 ELSE 0 END),0) AS expired,
        COALESCE(sum(CASE WHEN ${missing} THEN 1 ELSE 0 END),0) AS missing,
        COALESCE(sum(CASE WHEN ${eligible} THEN 1 ELSE 0 END),0) AS eligible,
        COALESCE(sum(CASE WHEN f.status='open' THEN 1 ELSE 0 END),0) AS openFollowUps,
        COALESCE(sum(CASE WHEN f.status='open' AND f.due_at<=$now THEN 1 ELSE 0 END),0) AS overdueFollowUps
        FROM ${source} ${filter.q ? `WHERE ${search}` : ''}`;
      return Object.fromEntries(Object.entries(await read(sql, inputs(filter, now), 'get')).map(([key, value]) => [key, Number(value)]));
    },
    get: async (id) => await db.prepare(`SELECT ${columns} FROM ${source} WHERE a.driver_id=?`).get(id) ?? null,
    documents: (id) => db.prepare('SELECT id,kind,expires_on AS expiresOn FROM driver_documents WHERE driver_id=? ORDER BY kind').all(id),
    async review(id) {
      // Reopening an application keeps past review evidence, but its current draft
      // status is not the previous review decision. Read that decision from history.
      const event = await db.prepare(`SELECT action AS decision,created_at AS reviewedAt,json_extract(payload_json,'$.reason') AS reason,
        json_extract(payload_json,'$.verification.reference') AS reference,json_extract(payload_json,'$.verification.method') AS method
        FROM driver_application_events WHERE driver_id=? AND action IN ('approved','approved_exception','rejected','changes_requested') ORDER BY id DESC LIMIT 1`).get(id);
      if (event) return event;
      const row = await db.prepare(`SELECT CASE WHEN status IN ('approved','rejected','changes_requested') THEN status ELSE 'previous_review' END AS decision,
        reviewed_at AS reviewedAt,review_reason AS reason,
        json_extract(verification_json,'$.reference') AS reference,json_extract(verification_json,'$.method') AS method
        FROM driver_applications WHERE driver_id=? AND reviewed_at IS NOT NULL`).get(id);
      return row ?? null;
    },
    applicationHistory: (id) => db.prepare(`SELECT action,version,created_at AS createdAt,
      json_extract(payload_json,'$.reason') AS reason,json_extract(payload_json,'$.verification.reference') AS reference
      FROM driver_application_events WHERE driver_id=? AND action IN ('approved','approved_exception','rejected','changes_requested','submitted','submit','reopen','profile_deleted')
      ORDER BY id DESC LIMIT 50`).all(id),
    async events(id, filter) {
      const values = [id]; let before = '';
      if (filter.before) { before = 'AND (e.created_at<? OR (e.created_at=? AND e.id<?))'; values.push(filter.before.time, filter.before.time, filter.before.id); }
      values.push(filter.limit + 1);
      return db.prepare(`SELECT e.id,e.action,e.note,e.due_at AS dueAt,e.version,e.created_at AS createdAt,e.actor_id AS actorId,u.name AS actorName
        FROM admin_compliance_events e JOIN users u ON u.id=e.actor_id WHERE e.driver_id=? ${before} ORDER BY e.created_at DESC,e.id DESC LIMIT ?`).all(...values);
    },
    async save(row, expected) {
      if (expected === 0) return (await db.prepare(`INSERT INTO admin_compliance_followups(driver_id,status,due_at,note,version,application_version,actor_id,updated_at,completed_at)
        VALUES (?,?,?,?,?,?,?,?,?) ON CONFLICT(driver_id) DO NOTHING`).run(row.id, row.status, row.dueAt, row.note, row.version, row.applicationVersion, row.actorId, row.now, row.completedAt)).changes;
      return (await db.prepare(`UPDATE admin_compliance_followups SET status=?,due_at=?,note=?,version=?,application_version=?,actor_id=?,updated_at=?,completed_at=?
        WHERE driver_id=? AND version=?`).run(row.status, row.dueAt, row.note, row.version, row.applicationVersion, row.actorId, row.now, row.completedAt, row.id, expected)).changes;
    },
    event: (row) => db.prepare(`INSERT INTO admin_compliance_events(id,driver_id,actor_id,action,note,due_at,version,created_at) VALUES (?,?,?,?,?,?,?,?)`)
      .run(row.eventId, row.id, row.actorId, row.action, row.note, row.dueAt, row.version, row.now),
    command: (actorId, key) => db.prepare('SELECT fingerprint,driver_id AS driverId FROM admin_compliance_commands WHERE actor_id=? AND key=?').get(actorId, key),
    saveCommand: (actorId, key, fingerprint, driverId, now) => db.prepare('INSERT INTO admin_compliance_commands(actor_id,key,fingerprint,driver_id,created_at) VALUES (?,?,?,?,?)')
      .run(actorId, key, fingerprint, driverId, now),
  });
}
