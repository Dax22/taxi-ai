const cols = `a.id,a.owner_id AS ownerId,a.ride_id AS rideId,a.kind,a.status,a.snapshot_json AS snapshotJson,
 a.signal_json AS signalJson,a.created_at AS createdAt,a.due_at AS dueAt,
 COALESCE(r.state,'open') AS reviewState,COALESCE(r.version,0) AS reviewVersion,r.assignee_id AS assigneeId,r.updated_at AS reviewedAt`;
export function createAdminSafetyAlertsRepository(db) {
  const joins = 'FROM safety_auto_alerts a LEFT JOIN safety_alert_reviews r ON r.alert_id=a.id';
  return Object.freeze({
    async list(f) {
      const where = [], values = [];
      if (f.kind !== 'all') { where.push('a.kind=?'); values.push(f.kind); }
      if (f.state === 'active') where.push("COALESCE(r.state,'open') IN ('open','acknowledged') AND a.status NOT IN ('cancelled','expired')");
      else if (f.state !== 'all') { where.push("COALESCE(r.state,'open')=?"); values.push(f.state); }
      if (f.before) { where.push('(a.created_at<? OR (a.created_at=? AND a.id<?))'); values.push(f.before.createdAt, f.before.createdAt, f.before.id); }
      return await db.prepare(`SELECT ${cols} ${joins} ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY a.created_at DESC,a.id DESC LIMIT 21`).all(...values);
    },
    find: async id => await db.prepare(`SELECT ${cols} ${joins} WHERE a.id=?`).get(id) ?? null,
    jobs: async id => await db.prepare('SELECT id,status,attempts FROM safety_delivery_jobs WHERE alert_id=? ORDER BY id').all(id),
    events: async id => await db.prepare('SELECT id,actor_id AS actorId,action,note,version,created_at AS createdAt FROM safety_alert_review_events WHERE alert_id=? ORDER BY version').all(id),
    command: async (actor, key) => await db.prepare('SELECT alert_id AS alertId,fingerprint FROM safety_alert_review_events WHERE actor_id=? AND command_key=?').get(actor, key) ?? null,
    async save({ id, state, assigneeId, expectedVersion, now }) {
      await db.prepare("INSERT OR IGNORE INTO safety_alert_reviews(alert_id,state,version,updated_at) VALUES (?,'open',0,?)").run(id, now);
      return (await db.prepare('UPDATE safety_alert_reviews SET state=?,assignee_id=?,version=version+1,updated_at=? WHERE alert_id=? AND version=?')
        .run(state, assigneeId, now, id, expectedVersion)).changes === 1;
    },
    async append(e) {
      await db.prepare('INSERT INTO safety_alert_review_events(id,alert_id,actor_id,action,note,version,created_at,command_key,fingerprint) VALUES (?,?,?,?,?,?,?,?,?)')
        .run(e.id, e.alertId, e.actorId, e.action, e.note, e.version, e.now, e.key, e.fingerprint);
    },
  });
}
