const columns=`id,user_id AS userId,kind,target_id AS targetId,phase,event_key AS eventKey,title,body,note,
  eta_minutes AS etaMinutes,created_at AS createdAt,read_at AS readAt,route_json AS routeJson,
  eta_state AS etaState,eta_attempts AS etaAttempts,eta_next_at AS etaNextAt,eta_lease_until AS etaLeaseUntil`;
const jobColumns=`j.id,j.update_id AS updateId,j.user_id AS userId,j.session_id AS sessionId,j.token,j.status,j.attempts,
  j.next_at AS nextAt,j.lease_until AS leaseUntil,j.ticket,j.created_at AS createdAt`;
export function createDeliveryUpdatesRepository(db) {
  return Object.freeze({
    async add(value) {
      return (await db.prepare(`INSERT OR IGNORE INTO delivery_updates
        (id,user_id,kind,target_id,phase,event_key,title,body,note,eta_minutes,created_at,route_json,eta_state,eta_next_at)
        VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(value.id,value.userId,value.kind,value.targetId,value.phase,value.eventKey,
        value.title,value.body,value.note,value.etaMinutes,value.now,value.routeJson,value.routeJson ? 'pending' : 'done',value.now)).changes > 0;
    },
    find:async id => await db.prepare(`SELECT ${columns} FROM delivery_updates WHERE id=?`).get(id) ?? null,
    milestone:async(userId,kind,targetId,phase) => await db.prepare(`SELECT ${columns} FROM delivery_updates WHERE user_id=? AND kind=? AND target_id=? AND phase=?`).get(userId,kind,targetId,phase) ?? null,
    latest:async(userId,kind,targetId) => await db.prepare(`SELECT ${columns} FROM delivery_updates WHERE user_id=? AND kind=? AND target_id=?
      ORDER BY created_at DESC,CASE phase WHEN 'delivered' THEN 3 WHEN 'arrived' THEN 2 ELSE 1 END DESC,id DESC LIMIT 1`).get(userId,kind,targetId) ?? null,
    list:async(userId,before=null) => before
      ? await db.prepare(`SELECT ${columns} FROM delivery_updates WHERE user_id=? AND (created_at<? OR (created_at=? AND id<?)) ORDER BY created_at DESC,id DESC LIMIT 51`).all(userId,before.createdAt,before.createdAt,before.id)
      : await db.prepare(`SELECT ${columns} FROM delivery_updates WHERE user_id=? ORDER BY created_at DESC,id DESC LIMIT 51`).all(userId),
    unread:async userId => (await db.prepare('SELECT count(*) AS n FROM delivery_updates WHERE user_id=? AND read_at IS NULL').get(userId)).n,
    read:async(id,now) => await db.prepare('UPDATE delivery_updates SET read_at=COALESCE(read_at,?) WHERE id=?').run(now,id),
    dueEta:async now => await db.prepare(`SELECT ${columns} FROM delivery_updates WHERE eta_state='pending' AND eta_next_at<=? ORDER BY eta_next_at,id LIMIT 20`).all(now),
    claimEta:async(id,attempts,now) => (await db.prepare(`UPDATE delivery_updates SET eta_attempts=eta_attempts+1,eta_next_at=?,eta_lease_until=?
      WHERE id=? AND eta_state='pending' AND eta_attempts=? AND eta_next_at<=?`).run(now+60_000,now+60_000,id,attempts,now)).changes > 0,
    finishEta:async(id,attempts,now,notice) => (await db.prepare(`UPDATE delivery_updates SET title=?,body=?,note=?,eta_minutes=?,route_json=NULL,
      eta_state='done',eta_lease_until=0 WHERE id=? AND eta_state='pending' AND eta_attempts=? AND eta_lease_until>?`)
      .run(notice.title,notice.body,notice.note,notice.etaMinutes,id,attempts,now)).changes > 0,
    addPush:async({id,updateId,userId,sessionId,token,now}) => (await db.prepare(`INSERT OR IGNORE INTO delivery_update_push_jobs
      (id,update_id,user_id,session_id,token,next_at,created_at) VALUES(?,?,?,?,?,?,?)`).run(id,updateId,userId,sessionId,token,now,now)).changes > 0,
    duePush:async now => await db.prepare(`SELECT ${jobColumns} FROM delivery_update_push_jobs j JOIN delivery_updates n ON n.id=j.update_id
      WHERE j.status IN ('queued','ticket') AND j.next_at<=? AND (n.eta_state='done' OR j.status='ticket') ORDER BY j.next_at,j.id LIMIT 20`).all(now),
    claimPush:async(id,attempts,now) => (await db.prepare(`UPDATE delivery_update_push_jobs SET attempts=attempts+1,next_at=?,lease_until=?
      WHERE id=? AND status IN ('queued','ticket') AND attempts=? AND next_at<=?`).run(now+60_000,now+60_000,id,attempts,now)).changes > 0,
    ownsPush:async(id,attempts,now) => Boolean(await db.prepare(`SELECT 1 FROM delivery_update_push_jobs WHERE id=? AND attempts=? AND lease_until>? AND status IN ('queued','ticket')`).get(id,attempts,now)),
    finishPush:async(id,attempts,status,nextAt,ticket=null) => (await db.prepare(`UPDATE delivery_update_push_jobs SET status=?,next_at=?,ticket=?,lease_until=0
      WHERE id=? AND attempts=? AND status IN ('queued','ticket')`).run(status,nextAt,ticket,id,attempts)).changes > 0,
  });
}
