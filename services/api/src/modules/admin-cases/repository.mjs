const columns = `c.id,c.ride_id AS rideId,c.incident_id AS incidentId,c.category,c.subject,c.description,c.priority,c.status,
  c.assignee_id AS assigneeId,u.name AS assigneeName,c.version,c.created_at AS createdAt,c.updated_at AS updatedAt,
  c.response_due_at AS responseDueAt,c.first_responded_at AS firstRespondedAt,c.resolved_at AS resolvedAt`;
const source = 'admin_cases c LEFT JOIN users u ON u.id=c.assignee_id';

/** Feature-local SQL; callers own transaction and authorisation boundaries. */
export function createAdminCasesRepository(db) {
  return Object.freeze({
    get: async (id) => (await db.prepare(`SELECT ${columns} FROM ${source} WHERE c.id=?`).get(id)) ?? null,
    byIncident: async (id) => (await db.prepare(`SELECT ${columns} FROM ${source} WHERE c.incident_id=?`).get(id)) ?? null,
    async list(filter, categories, userId) {
      const clauses = [`c.category IN (${categories.map(() => '?').join(',')})`], values = [...categories];
      if (filter.category !== 'all') { clauses.push('c.category=?'); values.push(filter.category); }
      if (filter.status !== 'all') { clauses.push('c.status=?'); values.push(filter.status); }
      if (filter.priority !== 'all') { clauses.push('c.priority=?'); values.push(filter.priority); }
      if (filter.assigned === 'me') { clauses.push('c.assignee_id=?'); values.push(userId); }
      if (filter.assigned === 'unassigned') clauses.push('c.assignee_id IS NULL');
      if (filter.before) { clauses.push('(c.created_at<? OR (c.created_at=? AND c.id<?))'); values.push(filter.before.time, filter.before.time, filter.before.id); }
      return await db.prepare(`SELECT ${columns} FROM ${source} WHERE ${clauses.join(' AND ')} ORDER BY c.created_at DESC,c.id DESC LIMIT ?`).all(...values, filter.limit + 1);
    },
    async create(row) {
      return await db.prepare(`INSERT INTO admin_cases(id,ride_id,incident_id,category,subject,description,priority,status,created_at,updated_at,response_due_at)
        VALUES (?,?,?,?,?,?,?,'open',?,?,?)`).run(row.id, row.rideId, row.incidentId ?? null, row.category, row.subject, row.description, row.priority, row.now, row.now, row.responseDueAt);
    },
    async update(id, expectedVersion, next) {
      const result = await db.prepare(`UPDATE admin_cases SET assignee_id=?,status=?,priority=?,response_due_at=?,first_responded_at=?,resolved_at=?,version=version+1,updated_at=?
        WHERE id=? AND version=?`).run(next.assigneeId, next.status, next.priority, next.responseDueAt, next.firstRespondedAt, next.resolvedAt, next.now, id, expectedVersion);
      return result.changes === 1;
    },
    async event({ id, caseId, actorId, action, note, version, now }) {
      await db.prepare('INSERT INTO admin_case_events(id,case_id,actor_id,action,note,version,created_at) VALUES (?,?,?,?,?,?,?)')
        .run(id, caseId, actorId ?? null, action, note, version, now);
    },
    async events(id, filter) {
      const clauses = ['e.case_id=?'], values = [id];
      if (filter.before) { clauses.push('(e.created_at<? OR (e.created_at=? AND e.id<?))'); values.push(filter.before.time, filter.before.time, filter.before.id); }
      return await db.prepare(`SELECT e.id,e.actor_id AS actorId,u.name AS actorName,e.action,e.note,e.version,e.created_at AS createdAt
        FROM admin_case_events e LEFT JOIN users u ON u.id=e.actor_id WHERE ${clauses.join(' AND ')} ORDER BY e.created_at DESC,e.id DESC LIMIT ?`).all(...values, filter.limit + 1);
    },
    command: async (actor, key) => (await db.prepare('SELECT fingerprint,case_id AS caseId FROM admin_case_commands WHERE actor_id=? AND key=?').get(actor, key)) ?? null,
    async saveCommand(actor, key, fingerprint, caseId, now) {
      await db.prepare('INSERT INTO admin_case_commands(actor_id,key,fingerprint,case_id,created_at) VALUES (?,?,?,?,?)').run(actor, key, fingerprint, caseId, now);
    },
  });
}
