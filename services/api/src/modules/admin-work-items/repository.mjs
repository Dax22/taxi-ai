const columns=`id,entity_type AS entityType,entity_id AS entityId,kind,category,title,description,status,priority,assignee_id AS assigneeId,due_at AS dueAt,first_responded_at AS firstRespondedAt,resolved_at AS resolvedAt,created_by AS createdBy,created_at AS createdAt,updated_at AS updatedAt,version`;
export function createAdminWorkRepository(db) {
 return Object.freeze({
  async exists(kind,id){
   if(kind==='account')return Boolean(await db.prepare('SELECT 1 FROM users WHERE id=?').get(id));
   if(kind==='store')return Boolean(await db.prepare('SELECT 1 FROM eats_stores WHERE id=?').get(id));
   if(kind==='food')return Boolean(await db.prepare('SELECT 1 FROM eats_orders WHERE id=?').get(id));
   const delivery = Boolean(await db.prepare('SELECT 1 FROM delivery_orders WHERE ride_id=?').get(id));
   return (kind==='courier')===delivery && Boolean(await db.prepare('SELECT 1 FROM rides WHERE id=?').get(id));
  },
  async list(f){
   const clauses=['category=$category'],args={category:f.category,limit:f.limit+1};
   if(f.status==='active')clauses.push("status NOT IN ('resolved','rejected')");else if(f.status!=='all'){clauses.push('status=$status');args.status=f.status;}
   for(const [key,column] of [['entityType','entity_type'],['entityId','entity_id']])if(f[key]){clauses.push(`${column}=$${key}`);args[key]=f[key];}
   if(f.before){clauses.push('id>$before');args.before=f.before;}
   return db.prepare(`SELECT ${columns} FROM admin_work_items WHERE ${clauses.join(' AND ')} ORDER BY id LIMIT $limit`).all(args);
  },
  async counts(category,now){return db.prepare("SELECT status,COUNT(*) AS count,SUM(CASE WHEN due_at<? AND status NOT IN ('resolved','rejected') THEN 1 ELSE 0 END) AS overdue FROM admin_work_items WHERE category=? GROUP BY status ORDER BY status").all(now,category);},
  find:async id=>await db.prepare(`SELECT ${columns} FROM admin_work_items WHERE id=?`).get(id)??null,
  events:async id=>db.prepare('SELECT id,actor_id AS actorId,action,body,created_at AS createdAt FROM admin_work_events WHERE work_id=? ORDER BY created_at,id LIMIT 201').all(id),
  async insert(row){await db.prepare(`INSERT INTO admin_work_items(id,entity_type,entity_id,kind,category,title,description,status,priority,due_at,created_by,created_at,updated_at,version)
   VALUES(?,?,?,?,?,?,?,'open',?,?,?,?,?,1)`).run(row.id,row.entityType,row.entityId,row.kind,row.category,row.title,row.description,row.priority,row.dueAt,row.createdBy,row.createdAt,row.createdAt);},
  async update(row,expected){return (await db.prepare(`UPDATE admin_work_items SET status=?,assignee_id=?,due_at=?,first_responded_at=?,resolved_at=?,updated_at=?,version=version+1 WHERE id=? AND version=?`).run(row.status,row.assigneeId,row.dueAt,row.firstRespondedAt,row.resolvedAt,row.updatedAt,row.id,expected)).changes===1;},
  async event(row){await db.prepare('INSERT INTO admin_work_events(id,work_id,actor_id,action,body,created_at) VALUES(?,?,?,?,?,?)').run(row.id,row.workId,row.actorId,row.action,row.body,row.createdAt);},
  command:async(actor,key)=>await db.prepare('SELECT fingerprint,result_json AS resultJson FROM admin_command_keys WHERE actor_id=? AND command_key=?').get(actor,key)??null,
  async saveCommand(actor,key,fingerprint,result,now){await db.prepare('INSERT INTO admin_command_keys(actor_id,command_key,fingerprint,result_json,created_at) VALUES(?,?,?,?,?)').run(actor,key,fingerprint,JSON.stringify(result),now);},
 });
}
