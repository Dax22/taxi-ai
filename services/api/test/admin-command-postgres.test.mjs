import test from 'node:test';
import { verifyCombinedReport } from './admin-report-fixtures.mjs';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { openPostgresDatabase } from '../src/infrastructure/postgres.mjs';
import { createApplication } from '../src/application.mjs';
import { createCallConfig } from '../src/infrastructure/call-config.mjs';
import { createMapProvider } from '../src/infrastructure/map-provider.mjs';

const connectionString=process.env.TAXI_AI_TEST_POSTGRES_URL;
test('PostgreSQL admin reporting, moderation and review writes preserve cross-pool visibility and exact amounts',{
 skip:!connectionString&&'Requires the isolated PostgreSQL acceptance database.',timeout:120000,
},async t=>{
 const schema='test_admin_command_'+randomUUID().replaceAll('-',''),pools=[],apps=[];
 const control=await openPostgresDatabase({connectionString,schema,migrate:true,max:1}),now=Date.UTC(2026,0,1,12);
 try{
  for(let index=0;index<2;index++){const db=await openPostgresDatabase({connectionString,schema,max:2});pools.push(db);apps.push(createApplication({db,clock:()=>now,allowSimulation:true,callConfig:createCallConfig({TAXI_AI_CALLS_MODE:'off'}),mapProvider:createMapProvider({env:{TAXI_AI_MAPS_MODE:'off'}}),dispatchConfig:{mode:'legacy'}}));}
  const owner=randomUUID(),customer=randomUUID(),driver=randomUUID(),store=randomUUID(),order=randomUUID(),ride=randomUUID();
  for(const [id,name,role] of [[owner,'Test owner','admin'],[customer,'Test customer','customer'],[driver,'Test driver','driver']]){
   await control.prepare('INSERT INTO users(id,email,name,password_hash,role,created_at) VALUES(?,?,?,?,?,?)').run(id,id+'@fixture.example.test',name,'test-fixture-no-login',role,now);
  }
  for(const userId of [customer,driver])await control.prepare("INSERT INTO account_capabilities(user_id,capability,created_at) VALUES(?,'customer',?)").run(userId,now);
  await control.prepare("INSERT INTO rides(id,customer_id,pickup_id,destination_id,suggested_fare_kobo,status,created_at,updated_at,request_expires_at) VALUES(?,?,'wuse-ii','maitama',100000,'requested',?,?,?)").run(ride,customer,now,now,now+300000);
  await control.prepare("INSERT INTO eats_stores(id,details_json,status,is_open,version,created_at,updated_at) VALUES(?,?,'approved',1,1,?,?)").run(store,JSON.stringify({name:'Test kitchen',areaId:'wuse-ii',sellerType:'restaurant'}),now,now);
  await control.prepare("INSERT INTO eats_memberships(store_id,user_id,role) VALUES(?,?,'owner')").run(store,driver);
  const snapshot={restaurant:{id:store,name:'Test kitchen',areaId:'wuse-ii'},address:{line:'Test address',areaId:'maitama'},lines:[{name:'Test food',quantity:1,priceKobo:625000}],totals:{totalKobo:625000,currency:'NGN'},payment:{method:'test',status:'not_charged'}};
  await control.prepare("INSERT INTO eats_orders(id,store_id,customer_id,status,snapshot_json,events_json,created_at,updated_at) VALUES(?,?,?,'placed',?,'[]',?,?)").run(order,store,customer,JSON.stringify(snapshot),now,now);
  const report=await apps[0].adminTransactions.list({id:owner},{limit:'1'});
  assert.equal(report.summary.total,2);assert.equal(report.items.length,1);assert.ok(report.nextBefore);
  assert.equal(report.summary.groups.find(g=>g.service==='food').amountKobo,'625000');
  const detail=await apps[1].adminTransactions.detail({id:owner},'food',order);assert.equal(detail.item.amountKobo,'625000');assert.equal(detail.contents[0].name,'Test food');
  const key=randomUUID(),payload={subjectType:'account',subjectId:customer,scope:'customer',kind:'suspension',reasonCode:'conduct',reason:'Private test review evidence',notice:'A test restriction is under review.',caseReference:'TEST-PG',expiresAt:now+86400000,reviewAt:now+3600000,confirmation:'CONFIRM'};
  const restriction=await apps[0].accountControls.apply({id:owner},payload,key);
  assert.equal((await apps[1].accountControls.apply({id:owner},payload,key)).replayed,true);
  assert.ok((await apps[1].accounts.profile(customer)).restrictions.scopes.includes('customer'));
  await assert.rejects(apps[1].rides.mutate({userId:customer,action:'create',data:{pickupId:'wuse-ii',destinationId:'maitama'},key:randomUUID()}),{code:'ACCOUNT_RESTRICTED'});
  const notices=await apps[1].accountControls.mine({id:customer});assert.ok(!JSON.stringify(notices).includes('Private test review evidence'));
  await apps[1].accountControls.lift({id:owner},restriction.restriction.id,{expectedVersion:1,reason:'Test PostgreSQL review is complete',confirmation:'REINSTATE'},randomUUID());
  assert.deepEqual((await apps[0].accounts.profile(customer)).restrictions.scopes,[]);
  const task=await apps[0].adminWork.create({id:owner},{entityType:'food',entityId:order,kind:'return_review',title:'Review test return',description:'A test delivery requires a review, not an automatic physical return.',priority:'high'},randomUUID());
  const changes=await Promise.allSettled(apps.map((app,index)=>app.adminWork.update({id:owner},task.item.id,{expectedVersion:1,action:'note',note:'Concurrent test note number '+index},randomUUID())));
  assert.equal(changes.filter(result=>result.status==='fulfilled').length,1);
  assert.equal(changes.find(result=>result.status==='rejected').reason.code,'STALE_VERSION');
  assert.equal((await apps[1].adminWork.detail({id:owner},task.item.id)).events.length,2);
  assert.equal((await control.prepare('SELECT status FROM eats_orders WHERE id=?').get(order)).status,'placed');
  const reportId=(await apps[0].adminInsights.saveReport({id:owner},{title:'Reusable PG report',service:'all',status:'all',from:'',to:''},randomUUID())).id;
  assert.equal((await apps[1].adminInsights.reports({id:owner})).items[0].id,reportId);
  await apps[0].adminTransactions.export({id:owner},{});
  assert.equal((await apps[1].adminInsights.accessAudit({id:owner})).items[0].action,'transactions.export');
  await verifyCombinedReport(control,now); // JSON checkout membership must work in native PostgreSQL too.
 }finally{
  for(const app of apps)await app.realtime.close();
  for(const db of pools)await db.close();
  try{await control.exec(`DROP SCHEMA ${schema} CASCADE`);}finally{await control.close();}
 }
});
