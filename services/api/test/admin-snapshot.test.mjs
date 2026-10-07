import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { saveSnapshot } from '../src/infrastructure/database-snapshot.mjs';
import { harness, participants } from './helpers.mjs';

// The snapshot is a new test file. No operational database path is accepted.
test('backup keeps restrictions, notices, appeals and audit evidence while clearing old sessions only in its copy',async t=>{
 const directory=mkdtempSync(join(tmpdir(),'taxi-admin-snapshot-'));t.after(()=>rmSync(directory,{recursive:true,force:true}));
 const h=await harness(t,{persistent:true}),{admin,customer}=await participants(h,0);
 const result=await admin.post('/api/admin/console/restrictions',{subjectType:'account',subjectId:customer.user.id,scope:'customer',kind:'suspension',reasonCode:'conduct',
  reason:'Evidence preserved in a disposable test backup.',notice:'Your account activity requires a review.',caseReference:'TEST-SNAPSHOT',expiresAt:h.now+86400000,reviewAt:h.now+3600000,confirmation:'CONFIRM'});
 assert.equal(result.status,200,JSON.stringify(result.body));const restrictionId=result.body.restriction.id;
 const appeal=await customer.post('/api/account/notices/'+restrictionId+'/appeal',{body:'Please review this test notice against the preserved evidence.'});assert.equal(appeal.status,200);
 const before=h.db.prepare('SELECT * FROM account_restrictions WHERE id=?').get(restrictionId);
 const path=join(directory,'copy.sqlite');saveSnapshot(h.filename,path,{now:h.now});
 assert.deepEqual(h.db.prepare('SELECT * FROM account_restrictions WHERE id=?').get(restrictionId),before);
 assert.ok(h.db.prepare('SELECT COUNT(*) AS n FROM sessions').get().n>0);
 const copy=new DatabaseSync(path,{readOnly:true});
 try{
  assert.deepEqual(copy.prepare('SELECT * FROM account_restrictions WHERE id=?').get(restrictionId),before);
  assert.equal(copy.prepare('SELECT status FROM restriction_appeals WHERE restriction_id=?').get(restrictionId).status,'submitted');
  assert.equal(copy.prepare('SELECT COUNT(*) AS n FROM restriction_events WHERE restriction_id=?').get(restrictionId).n,2);
  assert.equal(copy.prepare('SELECT COUNT(*) AS n FROM sessions').get().n,0);
  assert.deepEqual(copy.prepare('PRAGMA foreign_key_check').all(),[]);
 }finally{copy.close();}
});
