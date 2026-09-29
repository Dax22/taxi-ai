const active = "(status='queued' OR (status='provider_accepted' AND provider_confirmed_at IS NULL))";
const columns = `id,event_id AS eventId,user_id AS userId,session_id AS sessionId,token,status,attempts,
  next_at AS nextAt,lease_until AS leaseUntil,ticket,created_at AS createdAt,
  accepted_at AS acceptedAt,provider_confirmed_at AS providerConfirmedAt,delivered_at AS deliveredAt`;

export function createFamilyDeliveryRepository(db) {
  return Object.freeze({
    add: async ({ id, eventId, userId, sessionId, token, now }) =>
      (await db.prepare(`INSERT OR IGNORE INTO family_push_jobs(id,event_id,user_id,session_id,token,next_at,created_at)
        VALUES(?,?,?,?,?,?,?)`).run(id,eventId,userId,sessionId,token,now,now)).changes > 0,
    due: async (now) => db.prepare(`SELECT ${columns} FROM family_push_jobs
      WHERE ${active} AND next_at<=? ORDER BY next_at,id LIMIT 20`).all(now),
    claim: async (id, attempts, now) =>
      (await db.prepare(`UPDATE family_push_jobs SET attempts=attempts+1,next_at=?,lease_until=?
        WHERE id=? AND attempts=? AND next_at<=? AND ${active}`)
        .run(now+60_000,now+60_000,id,attempts,now)).changes > 0,
    ownsLease: async (id, attempts, now) => Boolean(await db.prepare(`SELECT 1 FROM family_push_jobs
      WHERE id=? AND attempts=? AND lease_until>? AND ${active}`).get(id,attempts,now)),
    finish: async ({ id, attempts, status, nextAt, ticket, acceptedAt, providerConfirmedAt, deliveredAt }) =>
      (await db.prepare(`UPDATE family_push_jobs SET status=?,next_at=?,lease_until=0,ticket=?,
        accepted_at=COALESCE(accepted_at,?),provider_confirmed_at=COALESCE(provider_confirmed_at,?),
        delivered_at=COALESCE(delivered_at,?) WHERE id=? AND attempts=? AND ${active}`)
        .run(status,nextAt,ticket,acceptedAt,providerConfirmedAt,deliveredAt,id,attempts)).changes > 0,
    statuses: async (eventId, userId) => db.prepare(`SELECT status,accepted_at AS acceptedAt,
      provider_confirmed_at AS providerConfirmedAt,delivered_at AS deliveredAt
      FROM family_push_jobs WHERE event_id=? AND user_id=?`).all(eventId,userId),
  });
}
