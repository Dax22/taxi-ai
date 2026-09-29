const contactColumns = `id,owner_id AS ownerId,observer_id AS observerId,invited_email AS invitedEmail,status,version,
  created_at AS createdAt,expires_at AS expiresAt,updated_at AS updatedAt`;
const shareColumns = `s.id,s.contact_id AS contactId,s.ride_id AS rideId,s.owner_id AS ownerId,s.observer_id AS observerId,
  s.active,s.version,s.created_at AS createdAt,s.ended_at AS endedAt,s.reason,c.status AS contactStatus,
  t.requested_at AS requestedAt,t.responded_at AS respondedAt,t.response,t.safe_arrival_at AS safeArrivalAt`;
const shareJoin = 'family_shares s JOIN family_contacts c ON c.id=s.contact_id LEFT JOIN family_trip_state t ON t.ride_id=s.ride_id';
const eventColumns = `id,user_id AS userId,contact_id AS contactId,share_id AS shareId,kind,title,created_at AS createdAt,
 acknowledged_at AS acknowledgedAt,dedupe_key AS dedupeKey`;

/** All family writes and account revisions use the owning asynchronous transaction. */
export function createFamilyRepository(db) {
  return Object.freeze({
    async lockUsers(ids) {
      if (db.kind === 'postgres') for (const id of [...new Set(ids.filter(Boolean))].sort())
        await db.prepare('SELECT id FROM users WHERE id=? FOR UPDATE').get(id);
    },
    async lockRide(id) { if (db.kind === 'postgres') await db.prepare('SELECT id FROM rides WHERE id=? FOR UPDATE').get(id); },
    adult: async id => Boolean(await db.prepare('SELECT user_id FROM family_adults WHERE user_id=?').get(id)),
    async confirmAdult(id, now) { await db.prepare('INSERT INTO family_adults(user_id,confirmed_at) VALUES (?,?) ON CONFLICT(user_id) DO NOTHING').run(id, now); },
    contact: async id => await db.prepare(`SELECT ${contactColumns} FROM family_contacts WHERE id=?`).get(id) ?? null,
    contacts: async id => await db.prepare(`SELECT ${contactColumns} FROM family_contacts WHERE owner_id=? OR observer_id=?
      ORDER BY CASE WHEN status='active' THEN 0 WHEN status='pending' THEN 1 ELSE 2 END,created_at DESC,id LIMIT 50`).all(id, id),
    async expireContacts(id, now) { await db.prepare(`UPDATE family_contacts SET status='expired',version=version+1,updated_at=?
      WHERE (owner_id=? OR observer_id=?) AND status='pending' AND expires_at<=?`).run(now, id, id, now); },
    expiredContacts: async now => await db.prepare(`SELECT ${contactColumns} FROM family_contacts WHERE status='pending' AND expires_at<=? ORDER BY expires_at,id LIMIT 200`).all(now),
    async expireContact(id,now) { return (await db.prepare("UPDATE family_contacts SET status='expired',version=version+1,updated_at=? WHERE id=? AND status='pending' AND expires_at<=?").run(now,id,now)).changes===1; },
    countOutgoing: async id => (await db.prepare("SELECT count(*) AS n FROM family_contacts WHERE owner_id=? AND status IN ('pending','active')").get(id)).n,
    countWatching: async id => (await db.prepare("SELECT count(*) AS n FROM family_contacts WHERE observer_id=? AND status='active'").get(id)).n,
    openContact: async (id, email) => await db.prepare(`SELECT ${contactColumns} FROM family_contacts WHERE owner_id=? AND invited_email=? AND status IN ('pending','active')`).get(id,email) ?? null,
    async addContact(row) { await db.prepare(`INSERT INTO family_contacts(id,owner_id,observer_id,invited_email,status,created_at,expires_at,updated_at)
      VALUES (?,?,?,?,'pending',?,?,?)`).run(row.id,row.ownerId,row.observerId,row.email,row.now,row.expiresAt,row.now); },
    async updateContact(id,status,now) { await db.prepare('UPDATE family_contacts SET status=?,version=version+1,updated_at=? WHERE id=?').run(status,now,id); },
    share: async id => await db.prepare(`SELECT ${shareColumns} FROM ${shareJoin} WHERE s.id=?`).get(id) ?? null,
    shares: async (id, now) => await db.prepare(`SELECT ${shareColumns} FROM ${shareJoin} WHERE (s.owner_id=? OR s.observer_id=?)
      AND (s.active=1 OR s.ended_at>?) ORDER BY s.created_at DESC,s.id LIMIT 100`).all(id,id,now-86_400_000),
    rideShares: async rideId => await db.prepare(`SELECT ${shareColumns} FROM ${shareJoin} WHERE s.ride_id=? AND s.active=1`).all(rideId),
    visibleRideShares: async (rideId, now) => await db.prepare(`SELECT ${shareColumns} FROM ${shareJoin} WHERE s.ride_id=? AND c.status='active'
      AND (s.active=1 OR (s.reason='completed' AND s.ended_at>?))`).all(rideId,now-86_400_000),
    contactShares: async contactId => await db.prepare(`SELECT ${shareColumns} FROM ${shareJoin} WHERE s.contact_id=? AND s.active=1`).all(contactId),
    existingShare: async (contactId,rideId) => await db.prepare(`SELECT ${shareColumns} FROM ${shareJoin} WHERE s.contact_id=? AND s.ride_id=? AND s.active=1`).get(contactId,rideId) ?? null,
    async addShare(row) {
      await db.prepare(`INSERT INTO family_shares(id,contact_id,ride_id,owner_id,observer_id,created_at) VALUES (?,?,?,?,?,?)`)
        .run(row.id,row.contactId,row.rideId,row.ownerId,row.observerId,row.now);
      await db.prepare('INSERT INTO family_trip_state(ride_id) VALUES (?) ON CONFLICT(ride_id) DO NOTHING').run(row.rideId);
    },
    async endShare(id,reason,now) { await db.prepare('UPDATE family_shares SET active=0,ended_at=?,reason=?,version=version+1 WHERE id=? AND active=1').run(now,reason,id); },
    async revokeShare(id,now) { await db.prepare("UPDATE family_shares SET active=0,ended_at=?,reason='revoked',version=version+1 WHERE id=?").run(now,id); },
    async updateShares(rideId) { await db.prepare("UPDATE family_shares SET version=version+1 WHERE ride_id=? AND (active=1 OR reason='completed')").run(rideId); },
    async requestCheckIn(rideId,now) { await db.prepare('UPDATE family_trip_state SET requested_at=? WHERE ride_id=?').run(now,rideId); },
    async respond(rideId,response,now) { await db.prepare(`UPDATE family_trip_state SET response=?,responded_at=?,safe_arrival_at=CASE WHEN ?='arrived' THEN ? ELSE safe_arrival_at END WHERE ride_id=?`).run(response,now,response,now,rideId); },
    events: async id => await db.prepare(`SELECT ${eventColumns} FROM family_events WHERE user_id=? ORDER BY created_at DESC,id DESC LIMIT 100`).all(id),
    event: async id => await db.prepare(`SELECT ${eventColumns} FROM family_events WHERE id=?`).get(id) ?? null,
    async addEvent(row) { return (await db.prepare(`INSERT INTO family_events(id,user_id,contact_id,share_id,kind,title,created_at,dedupe_key)
      VALUES (?,?,?,?,?,?,?,?) ON CONFLICT(user_id,dedupe_key) DO NOTHING`).run(row.id,row.userId,row.contactId,row.shareId,row.kind,row.title,row.now,row.dedupeKey)).changes===1; },
    async acknowledge(id,now) { await db.prepare('UPDATE family_events SET acknowledged_at=COALESCE(acknowledged_at,?) WHERE id=?').run(now,id); },
    command: async (id,key) => await db.prepare('SELECT fingerprint FROM family_commands WHERE actor_id=? AND key=?').get(id,key) ?? null,
    async saveCommand(id,key,fingerprint,now) { await db.prepare('INSERT INTO family_commands(actor_id,key,fingerprint,created_at) VALUES (?,?,?,?)').run(id,key,fingerprint,now); },
  });
}
