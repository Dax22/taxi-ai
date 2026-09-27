const columns = `a.id,a.title,a.body,a.audience,a.priority,a.status,a.version,a.created_by AS createdBy,a.published_by AS publishedBy,
  a.created_at AS createdAt,a.updated_at AS updatedAt,a.published_at AS publishedAt,a.expires_at AS expiresAt`;

const targetCondition = (audience = 'a.audience') => `(
  ${audience}='all'
  OR (${audience}='customers'
    AND EXISTS(SELECT 1 FROM account_capabilities cc WHERE cc.user_id=u.id AND cc.capability='customer')
    AND NOT EXISTS(SELECT 1 FROM account_capabilities dc WHERE dc.user_id=u.id AND dc.capability='driver'))
  OR (${audience}='drivers' AND EXISTS(SELECT 1 FROM account_capabilities d WHERE d.user_id=u.id AND d.capability='driver'))
  OR (${audience}='eats_sellers' AND EXISTS(SELECT 1 FROM eats_memberships e WHERE e.user_id=u.id))
)`;

export function createAnnouncementsRepository(db) {
  return Object.freeze({
    adminList: async () => db.prepare(`SELECT ${columns} FROM admin_announcements a ORDER BY a.created_at DESC,a.id DESC LIMIT 100`).all(),
    find: async (id) => (await db.prepare(`SELECT ${columns} FROM admin_announcements a WHERE a.id=?`).get(id)) ?? null,
    async create(value) {
      await db.prepare(`INSERT INTO admin_announcements
        (id,title,body,audience,priority,status,version,created_by,created_at,updated_at,expires_at)
        VALUES (?,?,?,?,?,'draft',1,?,?,?,?)`)
        .run(value.id,value.title,value.body,value.audience,value.priority,value.createdBy,value.createdAt,value.createdAt,value.expiresAt);
    },
    async publish(id, actorId, expectedVersion, now) {
      return (await db.prepare(`UPDATE admin_announcements SET status='published',version=version+1,published_by=?,published_at=?,updated_at=?
        WHERE id=? AND version=? AND status='draft' AND expires_at>?`).run(actorId,now,now,id,expectedVersion,now)).changes > 0;
    },
    async cancel(id, expectedVersion, now) {
      return (await db.prepare(`UPDATE admin_announcements SET status='cancelled',version=version+1,updated_at=?
        WHERE id=? AND version=? AND status IN ('draft','published')`).run(now,id,expectedVersion)).changes > 0;
    },
    command: async (actorId,key) => (await db.prepare('SELECT fingerprint FROM admin_announcement_commands WHERE actor_id=? AND key=?').get(actorId,key)) ?? null,
    saveCommand: async (actorId,key,fingerprint,now) => db.prepare('INSERT INTO admin_announcement_commands(actor_id,key,fingerprint,created_at) VALUES (?,?,?,?)').run(actorId,key,fingerprint,now),
    async enqueuePush(announcementId, audience, now) {
      await db.prepare(`INSERT INTO announcement_push_jobs(announcement_id,session_id,user_id,token,next_at)
        SELECT ?,p.session_id,p.user_id,p.token,? FROM push_registrations p JOIN users u ON u.id=p.user_id
        WHERE u.role<>'admin' AND ${targetCondition('?')}
        ON CONFLICT(announcement_id,session_id) DO NOTHING`).run(announcementId,now,audience);
    },
    async visible(userId, now) {
      return db.prepare(`SELECT ${columns},r.read_at AS readAt FROM admin_announcements a
        JOIN users u ON u.id=? LEFT JOIN admin_announcement_reads r ON r.announcement_id=a.id AND r.user_id=u.id
        WHERE u.role<>'admin' AND a.status='published' AND a.published_at<=? AND a.expires_at>? AND ${targetCondition()}
        ORDER BY CASE a.priority WHEN 'critical' THEN 0 WHEN 'important' THEN 1 ELSE 2 END,a.published_at DESC,a.id DESC LIMIT 20`)
        .all(userId,now,now);
    },
    async visibleOne(id,userId,now) {
      return (await db.prepare(`SELECT ${columns},r.read_at AS readAt FROM admin_announcements a
        JOIN users u ON u.id=? LEFT JOIN admin_announcement_reads r ON r.announcement_id=a.id AND r.user_id=u.id
        WHERE a.id=? AND u.role<>'admin' AND a.status='published' AND a.published_at<=? AND a.expires_at>? AND ${targetCondition()}`)
        .get(userId,id,now,now)) ?? null;
    },
    markRead: async (id,userId,now) => db.prepare(`INSERT INTO admin_announcement_reads(announcement_id,user_id,read_at) VALUES (?,?,?)
      ON CONFLICT(announcement_id,user_id) DO NOTHING`).run(id,userId,now),
    async cancelPush(id,now) {
      await db.prepare("UPDATE announcement_push_jobs SET status='dead',next_at=? WHERE announcement_id=? AND status IN ('pending','ticket')").run(now,id);
    },
    due: async (now) => db.prepare(`SELECT j.id,j.announcement_id AS announcementId,j.session_id AS sessionId,j.user_id AS userId,j.token,j.status,j.attempts,j.ticket,
      a.title,a.body,a.priority,a.expires_at AS expiresAt,a.status AS announcementStatus
      FROM announcement_push_jobs j JOIN admin_announcements a ON a.id=j.announcement_id
      WHERE j.status IN ('pending','ticket') AND j.next_at<=? ORDER BY j.id LIMIT 20`).all(now),
    jobActive: async (id) => Boolean(await db.prepare("SELECT 1 FROM announcement_push_jobs WHERE id=? AND status IN ('pending','ticket')").get(id)),
    lease: async (id,now,attempts) => (await db.prepare("UPDATE announcement_push_jobs SET attempts=attempts+1,next_at=? WHERE id=? AND attempts=? AND next_at<=? AND status IN ('pending','ticket')")
      .run(now+60_000,id,attempts,now)).changes > 0,
    ownsLease: async (id,attempts) => Boolean(await db.prepare("SELECT 1 FROM announcement_push_jobs WHERE id=? AND attempts=? AND status IN ('pending','ticket')").get(id,attempts)),
    finish: async (id,status,nextAt,ticket=null,attempts=null) => db.prepare('UPDATE announcement_push_jobs SET status=?,next_at=?,ticket=? WHERE id=? AND (? IS NULL OR attempts=?)')
      .run(status,nextAt,ticket,id,attempts,attempts),
  });
}
