const contacts = `id,owner_id AS ownerId,name,phone,active,version,created_at AS createdAt,removed_at AS removedAt`;
const incidents = `id,ride_id AS rideId,reporter_id AS reporterId,kind,note,status,version,snapshot_json AS snapshotJson,
  created_at AS createdAt,updated_at AS updatedAt,acknowledged_by AS acknowledgedBy,resolved_at AS resolvedAt`;
const notices = `id,incident_id AS incidentId,contact_id AS contactId,recipient_name AS recipientName,recipient_phone AS recipientPhone,
  mode,status,version,attempts,created_at AS createdAt,updated_at AS updatedAt`;
const links = `id,ride_id AS rideId,owner_id AS ownerId,token_hash AS tokenHash,session_hash AS sessionHash,native_session_id AS nativeSessionId,active,version,
  created_at AS createdAt,expires_at AS expiresAt,ended_at AS endedAt,reason`;

/** SQL belongs here; every write joins the caller's transaction. */
export function createSafetyRepository(db) {
  return Object.freeze({
    contacts: (owner) => db.prepare(`SELECT ${contacts} FROM trusted_contacts WHERE owner_id=? AND active=1 ORDER BY created_at,id`).all(owner),
    contact: (id) => db.prepare(`SELECT ${contacts} FROM trusted_contacts WHERE id=?`).get(id) ?? null,
    addContact(id, owner, data, now) { db.prepare('INSERT INTO trusted_contacts(id,owner_id,name,phone,created_at) VALUES (?,?,?,?,?)').run(id, owner, data.name, data.phone, now); },
    editContact(id, data) { db.prepare('UPDATE trusted_contacts SET name=?,phone=?,version=version+1 WHERE id=? AND active=1').run(data.name, data.phone, id); },
    removeContact(id, now) { db.prepare('UPDATE trusted_contacts SET active=0,name=NULL,phone=NULL,version=version+1,removed_at=? WHERE id=?').run(now, id); },
    incident: (id) => db.prepare(`SELECT ${incidents} FROM safety_incidents WHERE id=?`).get(id) ?? null,
    rideIncidents: (rideId, reporterId) => db.prepare(`SELECT ${incidents} FROM safety_incidents WHERE ride_id=? AND reporter_id=? ORDER BY created_at DESC,id DESC LIMIT 20`).all(rideId, reporterId),
    incidentCount: (rideId, reporterId) => db.prepare('SELECT count(*) AS n FROM safety_incidents WHERE ride_id=? AND reporter_id=?').get(rideId, reporterId).n,
    openIncident: (rideId, reporterId) => db.prepare(`SELECT id FROM safety_incidents WHERE ride_id=? AND reporter_id=? AND status<>'resolved'`).get(rideId, reporterId),
    listIncidents: (before, status) => db.prepare(`SELECT ${incidents} FROM safety_incidents
      WHERE (?='all' OR status=?) AND (? IS NULL OR created_at<? OR (created_at=? AND id<?)) ORDER BY created_at DESC,id DESC LIMIT 21`)
      .all(status, status, before?.id ?? null, before?.createdAt ?? null, before?.createdAt ?? null, before?.id ?? null),
    addIncident({ id, rideId, reporterId, kind, note, snapshot, now }) {
      db.prepare(`INSERT INTO safety_incidents(id,ride_id,reporter_id,kind,note,snapshot_json,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)`)
        .run(id, rideId, reporterId, kind, note, JSON.stringify(snapshot), now, now);
    },
    reviewIncident(id, status, reviewerId, now) {
      db.prepare(`UPDATE safety_incidents SET status=?,version=version+1,updated_at=?,
        acknowledged_by=COALESCE(acknowledged_by,?),resolved_at=? WHERE id=?`).run(status, now, reviewerId, status === 'resolved' ? now : null, id);
    },
    incidentEvent(id, actor, action, note, version, now) {
      db.prepare('INSERT INTO safety_incident_events(incident_id,actor_id,action,note,version,created_at) VALUES (?,?,?,?,?,?)').run(id, actor, action, note, version, now);
    },
    incidentEvents: (id) => db.prepare(`SELECT id,actor_id AS actorId,action,note,version,created_at AS createdAt FROM safety_incident_events WHERE incident_id=? ORDER BY id`).all(id),
    notifications: (id) => db.prepare(`SELECT ${notices} FROM safety_notifications WHERE incident_id=? ORDER BY id`).all(id),
    notification: (id) => db.prepare(`SELECT ${notices} FROM safety_notifications WHERE id=?`).get(id) ?? null,
    pendingForContact: (id) => db.prepare(`SELECT ${notices} FROM safety_notifications WHERE contact_id=? AND status IN ('queued','failed')`).all(id),
    addNotification(id, incidentId, contact, now) {
      db.prepare(`INSERT INTO safety_notifications(id,incident_id,contact_id,recipient_name,recipient_phone,created_at,updated_at) VALUES (?,?,?,?,?,?,?)`)
        .run(id, incidentId, contact.id, contact.name, contact.phone, now, now);
    },
    updateNotification(id, status, attempts, now) {
      db.prepare('UPDATE safety_notifications SET status=?,attempts=?,version=version+1,updated_at=? WHERE id=?').run(status, attempts, now, id);
    },
    notificationEvent(id, actor, status, attempts, now) {
      db.prepare('INSERT INTO safety_notification_events(notification_id,actor_id,status,attempt,created_at) VALUES (?,?,?,?,?)').run(id, actor, status, attempts, now);
    },
    notificationEvents: (id) => db.prepare(`SELECT id,actor_id AS actorId,status,attempt,created_at AS createdAt FROM safety_notification_events WHERE notification_id=? ORDER BY id`).all(id),
    link: (id) => db.prepare(`SELECT ${links} FROM trip_share_links WHERE id=?`).get(id) ?? null,
    byToken: (hash) => db.prepare(`SELECT ${links} FROM trip_share_links WHERE token_hash=? AND active=1`).get(hash) ?? null,
    currentLink: (owner, rideId) => db.prepare(`SELECT ${links} FROM trip_share_links WHERE owner_id=? AND ride_id=? AND active=1`).get(owner, rideId) ?? null,
    activeLinks: () => db.prepare(`SELECT ${links} FROM trip_share_links WHERE active=1`).all(),
    linksForRide: (id) => db.prepare(`SELECT ${links} FROM trip_share_links WHERE ride_id=? AND active=1`).all(id),
    linkCount: (owner, rideId) => db.prepare('SELECT count(*) AS n FROM trip_share_links WHERE owner_id=? AND ride_id=?').get(owner, rideId).n,
    addLink({ id, rideId, ownerId, tokenHash, sessionHash = null, nativeSessionId = null, now, expiresAt }) {
      db.prepare('INSERT INTO trip_share_links(id,ride_id,owner_id,token_hash,session_hash,native_session_id,created_at,expires_at) VALUES (?,?,?,?,?,?,?,?)').run(id, rideId, ownerId, tokenHash, sessionHash, nativeSessionId, now, expiresAt);
    },
    endLink(id, now, reason) {
      db.prepare('UPDATE trip_share_links SET active=0,token_hash=NULL,session_hash=NULL,native_session_id=NULL,version=version+1,ended_at=?,reason=? WHERE id=? AND active=1').run(now, reason, id);
    },
    command: (actor, key) => db.prepare('SELECT fingerprint,resource_id AS resourceId FROM safety_commands WHERE actor_id=? AND key=?').get(actor, key),
    saveCommand(actor, key, fingerprint, id) { db.prepare('INSERT INTO safety_commands(actor_id,key,fingerprint,resource_id) VALUES (?,?,?,?)').run(actor, key, fingerprint, id); },
  });
}
