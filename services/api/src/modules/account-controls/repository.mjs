const columns=`id,subject_type AS subjectType,subject_id AS subjectId,scope,kind,status,reason_code AS reasonCode,private_reason AS privateReason,notice,case_reference AS caseReference,expires_at AS expiresAt,review_at AS reviewAt,created_by AS createdBy,updated_by AS updatedBy,created_at AS createdAt,updated_at AS updatedAt,version`;
const active="status='active' AND (expires_at IS NULL OR expires_at>$now)";
const appealColumns='id,restriction_id AS restrictionId,user_id AS userId,body,status,decision_note AS decisionNote,decided_by AS decidedBy,created_at AS createdAt,updated_at AS updatedAt,version';
export function createAccountControlsRepository(db){
 return Object.freeze({
  async target(type,id){
   if(type==='store')return await db.prepare("SELECT s.id,json_extract(s.details_json,'$.name') AS name,m.user_id AS ownerId FROM eats_stores s JOIN eats_memberships m ON m.store_id=s.id WHERE s.id=?").get(id)??null;
   return await db.prepare(`SELECT u.id,u.name,u.role,EXISTS(SELECT 1 FROM account_capabilities c WHERE c.user_id=u.id AND c.capability='driver') AS hasDriver,
    EXISTS(SELECT 1 FROM eats_memberships m WHERE m.user_id=u.id) AS hasStore,
    (SELECT s.role FROM staff_memberships s WHERE s.user_id=u.id AND s.status='active') AS staffRole FROM users u WHERE u.id=?`).get(id)??null;
  },
  async activeAccountScopes(userId,now){return (await db.prepare(`SELECT DISTINCT scope FROM account_restrictions WHERE subject_type='account' AND subject_id=$userId AND kind='suspension' AND ${active}`).all({userId,now})).map(row=>row.scope);},
  async owns(userId,row){return row.subjectType==='account'?row.subjectId===userId:Boolean(await db.prepare('SELECT 1 FROM eats_memberships WHERE user_id=? AND store_id=?').get(userId,row.subjectId));},
  async summary(userId,now){
   return db.prepare(`SELECT ${columns} FROM account_restrictions WHERE ${active}
    AND ((subject_type='account' AND subject_id=$userId) OR (subject_type='store' AND subject_id IN(SELECT store_id FROM eats_memberships WHERE user_id=$userId)))
    ORDER BY created_at DESC,id DESC LIMIT 21`).all({userId,now});
  },
  async mine(userId,before,limit){return db.prepare(`SELECT ${columns} FROM account_restrictions WHERE
   ((subject_type='account' AND subject_id=?) OR (subject_type='store' AND subject_id IN(SELECT store_id FROM eats_memberships WHERE user_id=?)))
   AND (? IS NULL OR created_at<? OR (created_at=? AND id<?)) ORDER BY created_at DESC,id DESC LIMIT ?`).all(userId,userId,before?.id??null,before?.time??null,before?.time??null,before?.id??null,limit+1);},
  async list(f,scopes){const args={limit:f.limit+1},clauses=[];
   clauses.push('scope IN ('+scopes.map((s,i)=>{args['scope'+i]=s;return '$scope'+i;}).join(',')+')');
   if(f.subjectType){clauses.push('subject_type=$type AND subject_id=$id');args.type=f.subjectType;args.id=f.subjectId;}
   if(f.before){clauses.push('(created_at<$time OR (created_at=$time AND id<$beforeId))');args.time=f.before.time;args.beforeId=f.before.id;}
   return db.prepare(`SELECT ${columns} FROM account_restrictions WHERE ${clauses.join(' AND ')} ORDER BY created_at DESC,id DESC LIMIT $limit`).all(args);
  },
  find:async id=>await db.prepare(`SELECT ${columns} FROM account_restrictions WHERE id=?`).get(id)??null,
  events:async id=>db.prepare('SELECT id,actor_id AS actorId,kind,detail_json AS detailJson,created_at AS createdAt FROM restriction_events WHERE restriction_id=? ORDER BY created_at,id LIMIT 201').all(id),
  async activeScope(type,id,scope,now){return await db.prepare(`SELECT ${columns} FROM account_restrictions WHERE subject_type=$type AND subject_id=$id AND scope=$scope AND kind='suspension' AND ${active}`).get({type,id,scope,now})??null;},
  async expired(type,id,now){return db.prepare(`SELECT ${columns} FROM account_restrictions WHERE subject_type=? AND subject_id=? AND status='active' AND expires_at<=?`).all(type,id,now);},
  async insert(r){await db.prepare(`INSERT INTO account_restrictions(id,subject_type,subject_id,scope,kind,status,reason_code,private_reason,notice,case_reference,expires_at,review_at,created_by,updated_by,created_at,updated_at,version)
   VALUES(?,?,?,?,?,'active',?,?,?,?,?,?,?,?,?,?,1)`).run(r.id,r.subjectType,r.subjectId,r.scope,r.kind,r.reasonCode,r.privateReason,r.notice,r.caseReference,r.expiresAt,r.reviewAt,r.actorId,r.actorId,r.now,r.now);},
  async close(id,expected,status,actor,now){return (await db.prepare('UPDATE account_restrictions SET status=?,version=version+1,updated_by=?,updated_at=? WHERE id=? AND version=? AND status=\'active\'').run(status,actor,now,id,expected)).changes===1;},
  async event(r){await db.prepare('INSERT INTO restriction_events(id,restriction_id,actor_id,kind,detail_json,created_at) VALUES(?,?,?,?,?,?)').run(r.id,r.restrictionId,r.actorId,r.kind,JSON.stringify(r.detail),r.now);},
  async impact(type,id,now){
   const ride=type==='store'?0:(await db.prepare(`SELECT COUNT(*) AS n FROM rides r LEFT JOIN ride_trips t ON t.ride_id=r.id WHERE (r.customer_id=? OR r.driver_id=?)
    AND (t.status IN ('booked','on_way','arrived','in_progress') OR (t.status IS NULL AND (r.status IN ('negotiating','agreed') OR (r.status='requested' AND r.request_expires_at>?))))`).get(id,id,now)).n;
   const food=type==='store'?(await db.prepare("SELECT COUNT(*) AS n FROM eats_orders WHERE store_id=? AND status NOT IN ('delivered','cancelled','rejected')").get(id)).n
    :(await db.prepare("SELECT COUNT(*) AS n FROM eats_orders WHERE (customer_id=? OR courier_id=? OR store_id IN(SELECT store_id FROM eats_memberships WHERE user_id=?)) AND status NOT IN ('delivered','cancelled','rejected')").get(id,id,id)).n;
   return {activeJourneys:ride,activeFoodOrders:food,total:ride+food,policy:'Scoped restrictions block new work; active jobs require supervised resolution. All-services suspension refuses to revoke sessions while any linked job is active.'};
  },
  async storeBlocked(storeId,now){return Boolean(await db.prepare(`SELECT 1 FROM account_restrictions r WHERE ${active} AND kind='suspension'
   AND ((subject_type='store' AND subject_id=$storeId AND scope='store') OR (subject_type='account' AND scope IN ('vendor','account') AND subject_id IN(SELECT user_id FROM eats_memberships WHERE store_id=$storeId))) LIMIT 1`).get({storeId,now}));},
  appeal:async restrictionId=>await db.prepare(`SELECT ${appealColumns} FROM restriction_appeals WHERE restriction_id=?`).get(restrictionId)??null,
  async addAppeal(r){await db.prepare("INSERT INTO restriction_appeals(id,restriction_id,user_id,body,status,created_at,updated_at,version) VALUES(?,?,?,?,'submitted',?,?,1)").run(r.id,r.restrictionId,r.userId,r.body,r.now,r.now);},
  async decideAppeal(r){return (await db.prepare("UPDATE restriction_appeals SET status=?,decision_note=?,decided_by=?,updated_at=?,version=version+1 WHERE id=? AND version=? AND status='submitted'").run(r.status,r.note,r.actorId,r.now,r.id,r.expectedVersion)).changes===1;},
  command:async(actor,key)=>await db.prepare('SELECT fingerprint,result_json AS resultJson FROM admin_command_keys WHERE actor_id=? AND command_key=?').get(actor,key)??null,
  async saveCommand(actor,key,fingerprint,result,now){await db.prepare('INSERT INTO admin_command_keys(actor_id,command_key,fingerprint,result_json,created_at) VALUES(?,?,?,?,?)').run(actor,key,fingerprint,JSON.stringify(result),now);},
 });
}
