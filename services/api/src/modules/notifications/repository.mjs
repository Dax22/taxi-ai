const columns = 'id, user_id AS userId, ride_id AS rideId, kind, mode, created_at AS createdAt, read_at AS readAt';
export function createNotificationsRepository(db) {
  return Object.freeze({
    async closeWork(userId, now) {
      (await db.prepare(`UPDATE push_jobs SET status='dead',next_at=? WHERE status IN ('pending','ticket') AND notification_id IN
        (SELECT id FROM account_notifications WHERE user_id=? AND mode='work')`).run(now,userId));
      (await db.prepare(`UPDATE account_notifications SET read_at=COALESCE(read_at,?) WHERE user_id=? AND mode='work'`).run(now,userId));
    },
    async add({ userId, rideId, kind, mode, eventKey, now }) {
      const result = (await db.prepare(`INSERT OR IGNORE INTO account_notifications(user_id,ride_id,kind,mode,event_key,created_at) VALUES(?,?,?,?,?,?)`)
        .run(userId,rideId,kind,mode,eventKey,now));
      if (!result.changes) return;
      (await db.prepare(`INSERT INTO push_jobs(notification_id,session_id,token,next_at) SELECT ?,session_id,token,? FROM push_registrations WHERE user_id=?`)
        .run(result.lastInsertRowid,now,userId));
    },
    find: async (id) => (await db.prepare(`SELECT ${columns} FROM account_notifications WHERE id=?`).get(id)),
    list: async (userId, before) => (await db.prepare(`SELECT ${columns} FROM account_notifications WHERE user_id=? AND id<? ORDER BY id DESC LIMIT 51`).all(userId,before)),
    unread: async (userId) => (await db.prepare('SELECT count(*) AS n FROM account_notifications WHERE user_id=? AND read_at IS NULL').get(userId)).n,
    read: async (id, now) => (await db.prepare('UPDATE account_notifications SET read_at=COALESCE(read_at,?) WHERE id=?').run(now,id)),
    async register(sessionId,userId,token) {
      (await db.prepare('DELETE FROM push_registrations WHERE session_id=? OR token=?').run(sessionId,token));
      (await db.prepare('INSERT INTO push_registrations(session_id,user_id,token) VALUES(?,?,?)').run(sessionId,userId,token));
    },
    unregister: async (sessionId) => (await db.prepare('DELETE FROM push_registrations WHERE session_id=?').run(sessionId)),
    registered: async (id) => (await db.prepare('SELECT token FROM push_registrations WHERE session_id=?').get(id))?.token ?? null,
    jobActive: async (id) => Boolean((await db.prepare("SELECT 1 FROM push_jobs WHERE id=? AND status IN ('pending','ticket')").get(id))),
    disable: async (token) => (await db.prepare('DELETE FROM push_registrations WHERE token=?').run(token)),
    due: async (now) => (await db.prepare(`SELECT j.id,j.notification_id AS notificationId,j.session_id AS sessionId,j.token,j.status,j.attempts,j.ticket,
      n.user_id AS userId,n.created_at AS createdAt,n.kind FROM push_jobs j JOIN account_notifications n ON n.id=j.notification_id
      WHERE j.status IN ('pending','ticket') AND j.next_at<=? ORDER BY j.id LIMIT 20`).all(now)),
    lease: async (id, now, attempts) => (await db.prepare("UPDATE push_jobs SET attempts=attempts+1,next_at=? WHERE id=? AND attempts=? AND next_at<=? AND status IN ('pending','ticket')").run(now+60_000,id,attempts,now)).changes > 0,
    ownsLease: async (id, attempts) => Boolean(await db.prepare("SELECT 1 FROM push_jobs WHERE id=? AND attempts=? AND status IN ('pending','ticket')").get(id,attempts)),
    finish: async (id,status,nextAt,ticket=null,attempts=null) => (await db.prepare('UPDATE push_jobs SET status=?,next_at=?,ticket=? WHERE id=? AND (? IS NULL OR attempts=?)').run(status,nextAt,ticket,id,attempts,attempts)),
  });
}
