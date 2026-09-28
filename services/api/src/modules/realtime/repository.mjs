/** Reads are bounded by connected accounts, never by all application records. */
export function createRealtimeRepository(db) {
  return Object.freeze({
    async revision(userId) {
      const row = await db.prepare('SELECT revision FROM account_revisions WHERE user_id=?').get(userId);
      return String(row?.revision ?? 0);
    },
    async revisions(userIds) {
      const results = new Map();
      for (let offset = 0; offset < userIds.length; offset += 250) {
        const ids = userIds.slice(offset, offset + 250);
        const rows = await db.prepare(`SELECT user_id AS "userId",revision FROM account_revisions WHERE user_id IN (${ids.map(() => '?').join(',')})`).all(...ids);
        for (const row of rows) results.set(row.userId, String(row.revision));
      }
      return results;
    },
    async touch(userIds, now) {
      for (const id of new Set(userIds.filter(Boolean))) await db.prepare(`INSERT INTO account_revisions(user_id,revision,updated_at) VALUES(?,1,?)
        ON CONFLICT(user_id) DO UPDATE SET revision=account_revisions.revision+1,updated_at=excluded.updated_at`).run(id, now);
    },
  });
}
