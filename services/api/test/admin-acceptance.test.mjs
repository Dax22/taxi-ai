import test from 'node:test';import assert from 'node:assert/strict';import {randomUUID} from 'node:crypto';
import {openDatabase,SCHEMA_VERSION} from '../src/infrastructure/database.mjs';
import {asAsyncDatabase} from '../src/infrastructure/async-database.mjs';
import {createAudit} from '../src/infrastructure/audit.mjs';
import {createAdminAcceptanceRepository} from '../src/modules/admin-acceptance/repository.mjs';
import {createAdminAcceptanceService} from '../src/modules/admin-acceptance/service.mjs';
import {effectiveManualResult,manualAcceptanceCheck} from '../src/modules/admin-acceptance/domain.mjs';

test('manual Passed acceptance expires into Needs retest without deleting stored evidence',()=>{
 const check=manualAcceptanceCheck('rides.two_phone_e2e'),testedAt=1_000_000;
 const result=effectiveManualResult(check,{status:'passed',version:1,evidenceRef:'trip:test',note:'Two phones completed.',testerId:'staff',testerName:'Ops',testedAt},testedAt+8*24*60*60_000);
 assert.equal(result.status,'needs_retest');assert.equal(result.storedStatus,'passed');assert.equal(result.stale,true);assert.equal(result.evidenceRef,'trip:test');
});

test('Production Acceptance results are versioned, idempotent and automatic checks cannot be manually overridden',async t=>{
 assert.equal(SCHEMA_VERSION,58);const db=asAsyncDatabase(openDatabase(':memory:'));t.after(()=>db.close());const now=1_800_000_000_000,staff=randomUUID();
 await db.prepare('INSERT INTO users(id,email,name,role,password_hash,created_at) VALUES(?,?,?,?,?,?)').run(staff,'ops@example.test','Ops Tester','customer','unused',now);
 const permissions=new Set(['acceptance.read','acceptance.manage']),repository=createAdminAcceptanceRepository(db),audit=createAudit(db);let serial=0;
 const service=createAdminAcceptanceService({repository,requirePermission:async(_id,p)=>{if(!permissions.has(p))throw Object.assign(new Error('forbidden'),{code:'FORBIDDEN'});},
  automaticChecks:async()=>({'platform.postgres':{passed:true,evidenceRef:'runtime:postgres',note:'healthy'}}),unitOfWork:run=>db.transaction(run),
  tokens:{id:()=>`event-${++serial}`,digest:value=>`digest:${value}`},audit,clock:()=>now});
 const initial=await service.get({id:staff});assert.equal(initial.categories.flatMap(c=>c.items).find(i=>i.key==='platform.postgres').status,'passed');
 const key='fixed-idempotency-key-12345',data={status:'passed',evidenceRef:'trip:acceptance-001',note:'Rider and driver completed the full real-device ride.',expectedVersion:0};
 const first=await service.record({userId:staff,checkKey:'rides.two_phone_e2e',data,key});assert.equal(first.replayed,false);
 const saved=first.categories.flatMap(c=>c.items).find(i=>i.key==='rides.two_phone_e2e');assert.equal(saved.status,'passed');assert.equal(saved.version,1);assert.equal(saved.tester.name,'Ops Tester');
 const replay=await service.record({userId:staff,checkKey:'rides.two_phone_e2e',data,key});assert.equal(replay.replayed,true);assert.equal((await repository.history()).length,1);
 await assert.rejects(service.record({userId:staff,checkKey:'rides.two_phone_e2e',data:{...data,note:'Changed note'},key}),{code:'KEY_REUSED'});
 await assert.rejects(service.record({userId:staff,checkKey:'platform.postgres',data,key:'another-safe-command-key-123'}),{code:'INVALID_INPUT'});
 await assert.rejects(service.record({userId:staff,checkKey:'rides.two_phone_e2e',data:{...data,expectedVersion:0},key:'stale-safe-command-key-123'}),{code:'STALE_VERSION'});
 assert.equal((await db.prepare("SELECT count(*) AS n FROM audit_events WHERE kind='admin.acceptance.result'").get()).n,1);
});

test('read-only acceptance staff can inspect evidence but cannot change results',async()=>{
 const repository={results:async()=>[],history:async()=>[]};
 const service=createAdminAcceptanceService({repository,requirePermission:async(_id,p)=>{if(p==='acceptance.manage')throw Object.assign(new Error('forbidden'),{code:'FORBIDDEN'});},
  automaticChecks:async()=>({}),unitOfWork:run=>run(),tokens:{id:()=> 'id',digest:v=>v},audit:{record:async()=>{}},clock:()=>1_800_000_000_000});
 const view=await service.get({id:'viewer'});assert.equal(view.canManage,false);
 await assert.rejects(service.record({userId:'viewer',checkKey:'rides.two_phone_e2e',data:{status:'failed',evidenceRef:'test:1',note:'Observed failure.',expectedVersion:0},key:'readonly-command-key-123'}),{code:'FORBIDDEN'});
});
