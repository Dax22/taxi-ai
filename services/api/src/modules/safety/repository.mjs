const contacts = `id,owner_id AS ownerId,name,phone,active,version,created_at AS createdAt,removed_at AS removedAt`;
const incidents = `id,ride_id AS rideId,reporter_id AS reporterId,kind,note,status,version,snapshot_json AS snapshotJson,
  created_at AS createdAt,updated_at AS updatedAt,acknowledged_by AS acknowledgedBy,resolved_at AS resolvedAt`;
const notices = `id,incident_id AS incidentId,contact_id AS contactId,recipient_name AS recipientName,recipient_phone AS recipientPhone,
  mode,status,version,attempts,created_at AS createdAt,updated_at AS updatedAt`;
const links = `id,ride_id AS rideId,owner_id AS ownerId,token_hash AS tokenHash,session_hash AS sessionHash,active,version,
  created_at AS createdAt,expires_at AS expiresAt,ended_at AS endedAt,reason`;

/** SQL belongs here; every write joins the caller's transaction. */
export function createSafetyRepository(db) {
  return Object.freeze({
    contacts: async (owner) => (await db.prepare(`SELECT ${contacts} FROM trusted_contacts WHERE owner_id=? AND active=1 ORDER BY created_at,id`).all(owner)),
    contact: async (id) => (await db.prepare(`SELECT ${contacts} FROM trusted_contacts WHERE id=?`).get(id)) ?? null,
    async addContact(id, owner, data, now) { (await db.prepare('INSERT INTO trusted_contacts(id,owner_id,name,phone,created_at) VALUES (?,?,?,?,?)').run(id, owner, data.name, data.phone, now)); },
    async editContact(id, value) { (await db.prepare('UPDATE trusted_contacts SET name=?,phone=?,version=version+1 WHERE id=? AND active=1').run(value.name, value.phone, id)); },
    async removeContact(id, now) { (await db.prepare('UPDATE trusted_contacts SET active=0,name=NULL,phone=NULL,version=version+1,removed_at=? WHERE id=?').run(now, id)); },
    incident: async (id) => (await db.prepare(`SELECT ${incidents} FROM safety_incidents WHERE id=?`).get(id)) ?? null,
    rideIncidents: async (rideId, reporterId) => (await db.prepare(`SELECT ${incidents} FROM safety_incidents WHERE ride_id=? AND reporter_id=? ORDER BY created_at DESC,id DESC LIMIT 20`).all(rideId, reporterId)),
    incidentCount: async (rideId, reporterId) => (await db.prepare('SELECT count(*) AS n FROM safety_incidents WHERE ride_id=? AND reporter_id=?').get(rideId, reporterId)).n,
    openIncident: async (rideId, reporterId) => (await db.prepare(`SELECT id FROM safety_incidents WHERE ride_id=? AND reporter_id=? AND status<>'resolved'`).get(rideId, reporterId)),
    listIncidents: async (before, status) => (await db.prepare(`SELECT ${incidents} FROM safety_incidents
      WHERE (?='all' OR status=?) AND (? IS NULL OR created_at<? OR (created_at=? AND id<?)) ORDER BY created_at DESC,id DESC LIMIT 21`)
      .all(status, status, before?.id ?? null, before?.createdAt ?? null, before?.createdAt ?? null, before?.id ?? null)),
    async addIncident({ id, rideId, reporterId, kind, note, snapshot, now }) {
      (await db.prepare(`INSERT INTO safety_incidents(id,ride_id,reporter_id,kind,note,snapshot_json,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)`)
        .run(id, rideId, reporterId, kind, note, JSON.stringify(snapshot), now, now));
    },
    async reviewIncident(id, status, reviewerId, now) {
      (await db.prepare(`UPDATE safety_incidents SET status=?,version=version+1,updated_at=?,
        acknowledged_by=COALESCE(acknowledged_by,?),resolved_at=? WHERE id=?`).run(status, now, reviewerId, status === 'resolved' ? now : null, id));
    },
    async incidentEvent(id, actor, action, note, version, now) {
      (await db.prepare('INSERT INTO safety_incident_events(incident_id,actor_id,action,note,version,created_at) VALUES (?,?,?,?,?,?)').run(id, actor, action, note, version, now));
    },
    incidentEvents: async (id) => (await db.prepare(`SELECT id,actor_id AS actorId,action,note,version,created_at AS createdAt FROM safety_incident_events WHERE incident_id=? ORDER BY id`).all(id)),
    notifications: async (id) => (await db.prepare(`SELECT ${notices} FROM safety_notifications WHERE incident_id=? ORDER BY id`).all(id)),
    notification: async (id) => (await db.prepare(`SELECT ${notices} FROM safety_notifications WHERE id=?`).get(id)) ?? null,
    pendingForContact: async (id) => (await db.prepare(`SELECT ${notices} FROM safety_notifications WHERE contact_id=? AND status IN ('queued','failed')`).all(id)),
    async addNotification(id, incidentId, contact, now) {
      (await db.prepare(`INSERT INTO safety_notifications(id,incident_id,contact_id,recipient_name,recipient_phone,created_at,updated_at) VALUES (?,?,?,?,?,?,?)`)
        .run(id, incidentId, contact.id, contact.name, contact.phone, now, now));
    },
    async updateNotification(id, status, attempts, now) {
      (await db.prepare('UPDATE safety_notifications SET status=?,attempts=?,version=version+1,updated_at=? WHERE id=?').run(status, attempts, now, id));
    },
    async notificationEvent(id, actor, status, attempts, now) {
      (await db.prepare('INSERT INTO safety_notification_events(notification_id,actor_id,status,attempt,created_at) VALUES (?,?,?,?,?)').run(id, actor, status, attempts, now));
    },
    notificationEvents: async (id) => (await db.prepare(`SELECT id,actor_id AS actorId,status,attempt,created_at AS createdAt FROM safety_notification_events WHERE notification_id=? ORDER BY id`).all(id)),
    link: async (id) => (await db.prepare(`SELECT ${links} FROM trip_share_links WHERE id=?`).get(id)) ?? null,
    byToken: async (hash) => (await db.prepare(`SELECT ${links} FROM trip_share_links WHERE token_hash=? AND active=1`).get(hash)) ?? null,
    currentLink: async (owner, rideId) => (await db.prepare(`SELECT ${links} FROM trip_share_links WHERE owner_id=? AND ride_id=? AND active=1`).get(owner, rideId)) ?? null,
    activeLinks: async () => (await db.prepare(`SELECT ${links} FROM trip_share_links WHERE active=1`).all()),
    linksForRide: async (id) => (await db.prepare(`SELECT ${links} FROM trip_share_links WHERE ride_id=? AND active=1`).all(id)),
    linkCount: async (owner, rideId) => (await db.prepare('SELECT count(*) AS n FROM trip_share_links WHERE owner_id=? AND ride_id=?').get(owner, rideId)).n,
    async addLink({ id, rideId, ownerId, tokenHash, sessionHash, now, expiresAt }) {
      (await db.prepare('INSERT INTO trip_share_links(id,ride_id,owner_id,token_hash,session_hash,created_at,expires_at) VALUES (?,?,?,?,?,?,?)').run(id, rideId, ownerId, tokenHash, sessionHash, now, expiresAt));
    },
    async endLink(id, now, reason) {
      (await db.prepare('UPDATE trip_share_links SET active=0,token_hash=NULL,session_hash=NULL,version=version+1,ended_at=?,reason=? WHERE id=? AND active=1').run(now, reason, id));
    },
    command: async (actor, key) => (await db.prepare('SELECT fingerprint,resource_id AS resourceId FROM safety_commands WHERE actor_id=? AND key=?').get(actor, key)),
    async saveCommand(actor, key, fingerprint, id) { (await db.prepare('INSERT INTO safety_commands(actor_id,key,fingerprint,resource_id) VALUES (?,?,?,?)').run(actor, key, fingerprint, id)); },
  });
}
