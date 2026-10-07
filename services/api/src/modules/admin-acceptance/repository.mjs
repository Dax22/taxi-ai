export function createAdminAcceptanceRepository(db){
 const currentSql=`SELECT r.check_key AS checkKey,r.status,r.evidence_ref AS evidenceRef,r.note,r.tester_id AS testerId,
  u.name AS testerName,r.tested_at AS testedAt,r.version,r.updated_at AS updatedAt
  FROM production_acceptance_results r LEFT JOIN users u ON u.id=r.tester_id`;
 return Object.freeze({
  results:()=>db.prepare(`${currentSql} ORDER BY r.check_key`).all(),
  get:key=>db.prepare(`${currentSql} WHERE r.check_key=?`).get(key),
  insert:row=>db.prepare(`INSERT INTO production_acceptance_results
   (check_key,status,evidence_ref,note,tester_id,tested_at,version,updated_at) VALUES (?,?,?,?,?,?,?,?) ON CONFLICT(check_key) DO NOTHING`)
   .run(row.checkKey,row.status,row.evidenceRef,row.note,row.testerId,row.testedAt,row.version,row.updatedAt),
  update:(row,expected)=>db.prepare(`UPDATE production_acceptance_results SET status=?,evidence_ref=?,note=?,tester_id=?,tested_at=?,version=?,updated_at=?
   WHERE check_key=? AND version=?`).run(row.status,row.evidenceRef,row.note,row.testerId,row.testedAt,row.version,row.updatedAt,row.checkKey,expected),
  event:row=>db.prepare(`INSERT INTO production_acceptance_events(id,check_key,status,evidence_ref,note,tester_id,created_at,version)
   VALUES (?,?,?,?,?,?,?,?)`).run(row.id,row.checkKey,row.status,row.evidenceRef,row.note,row.testerId,row.createdAt,row.version),
  history:(limit=50)=>db.prepare(`SELECT e.id,e.check_key AS checkKey,e.status,e.evidence_ref AS evidenceRef,e.note,e.tester_id AS testerId,
   u.name AS testerName,e.created_at AS createdAt,e.version FROM production_acceptance_events e LEFT JOIN users u ON u.id=e.tester_id
   ORDER BY e.created_at DESC,e.id DESC LIMIT ?`).all(limit),
  command:(actorId,key)=>db.prepare('SELECT fingerprint,check_key AS checkKey FROM production_acceptance_commands WHERE actor_id=? AND command_key=?').get(actorId,key),
  saveCommand:(actorId,key,fingerprint,checkKey,now)=>db.prepare(`INSERT INTO production_acceptance_commands(actor_id,command_key,fingerprint,check_key,created_at)
   VALUES (?,?,?,?,?)`).run(actorId,key,fingerprint,checkKey,now),
 });
}
