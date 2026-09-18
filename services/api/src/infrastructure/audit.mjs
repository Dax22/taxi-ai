/** Infrastructure shared by use cases; each record uses the caller's transaction. */
export function createAudit(db) {
  const insert = db.prepare('INSERT INTO audit_events (actor_id, kind, subject_id, created_at) VALUES (?, ?, ?, ?)');
  return Object.freeze({ record: (actorId, kind, subjectId, now) => insert.run(actorId, kind, subjectId, now) });
}
