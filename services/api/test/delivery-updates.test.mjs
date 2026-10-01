import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {asAsyncDatabase} from '../src/infrastructure/async-database.mjs';
import {createDeliveryUpdatesRepository} from '../src/modules/delivery-updates/repository.mjs';
import {createDeliveryUpdatesService} from '../src/modules/delivery-updates/service.mjs';
import {check} from '../src/shared/errors.mjs';

function fixture(t,{enabled=true,registered=true,recipients=1}={}) {
  const raw=new DatabaseSync(':memory:');
  raw.exec(`PRAGMA foreign_keys=ON;
    CREATE TABLE users(id TEXT PRIMARY KEY);
    CREATE TABLE delivery_orders(id TEXT PRIMARY KEY);
    CREATE TABLE device_sessions(id TEXT PRIMARY KEY);
    CREATE TABLE account_revisions(user_id TEXT PRIMARY KEY,revision INTEGER NOT NULL,updated_at INTEGER NOT NULL);`);
  raw.exec(readFileSync(new URL('../migrations/047_delivery_updates.sql',import.meta.url),'utf8'));
  t.after(()=>raw.close());
  let transactionDepth=0;
  const database=asAsyncDatabase(raw),db={...database,transaction:run=>database.transaction(async()=>{
    transactionDepth++;
    try {return await run();} finally {transactionDepth--;}
  })},repository=createDeliveryUpdatesRepository(db);
  const customerId=randomUUID(),recipientId=randomUUID(),targetId=randomUUID(),sessionId=randomUUID();
  raw.prepare('INSERT INTO users(id) VALUES(?)').run(customerId);raw.prepare('INSERT INTO users(id) VALUES(?)').run(recipientId);
  raw.prepare('INSERT INTO device_sessions(id) VALUES(?)').run(sessionId);
  const users=new Map([customerId,recipientId].map(id=>[id,{id,capabilities:['customer'],role:'customer'}]));
  let now=1_000_000,currentPhase='picked_up',allowed=true,currentToken=registered?'ExpoPushToken[fixture_delivery_no_real_destination]':null,estimates=0;
  const sent=[],receipts=[],changed=[],provider={enabled,send:async data=>{sent.push(data);return {status:'ticket',ticket:'fixture-ticket'};},
    receipt:async ticket=>{receipts.push(ticket);return {status:'ok'};}};
  const args={repository,getAccount:async id=>users.get(id),targetIds:async()=>recipients===2?[customerId,recipientId]:[customerId],
    access:async(user,kind,id)=>{check(allowed && id===targetId && users.has(user.id),'NOT_FOUND','No access.');return {screen:kind==='food'?'food-order':user.id===customerId?'journey':'parcels',id};},
    phaseFor:async()=>currentPhase,familyTargets:async()=>currentToken?[{sessionId,token:currentToken}]:[],
    validTarget:async job=>job.sessionId===sessionId && job.token===currentToken,disableTarget:async()=>{currentToken=null;},
    provider,estimateEta:async()=>{estimates++;assert.equal(transactionDepth,0,'routing cannot hold a database transaction');return {durationSeconds:601,source:'road'};},
    unitOfWork:run=>db.transaction(run),tokens:{id:randomUUID},clock:()=>now,onChanged:async ids=>changed.push(...ids)};
  const service=createDeliveryUpdatesService(args),route={from:{lat:9.08,lng:7.4,name:'private kitchen'},to:{lat:9.085,lng:7.405,address:'private recipient'}};
  const publish=overrides=>db.transaction(()=>service.publish({kind:'food',targetId,phase:currentPhase,customerId,eventKey:`food:${targetId}:${currentPhase}`,now,route,...overrides}));
  return {raw,db,repository,service,customerId,recipientId,targetId,sessionId,route,provider,sent,receipts,changed,publish,
    duplicate:overrides=>createDeliveryUpdatesService({...args,...overrides}),advance:ms=>{now+=ms;},phase:phase=>{currentPhase=phase;},
    revoke:()=>{allowed=false;},unregister:()=>{currentToken=null;},replaceToken:()=>{currentToken='ExpoPushToken[replacement_fixture]';},
    estimates:()=>estimates,row:()=>raw.prepare('SELECT * FROM delivery_updates ORDER BY created_at,id LIMIT 1').get(),
    job:()=>raw.prepare('SELECT * FROM delivery_update_push_jobs LIMIT 1').get()};
}

test('delivery milestones persist atomically once and enrich map ETA before sending sanitized push',async t=>{
  const f=fixture(t);
  await assert.rejects(f.db.transaction(async()=>{await f.service.publish({kind:'food',targetId:f.targetId,phase:'picked_up',customerId:f.customerId,eventKey:'rollback',now:1_000_000,route:f.route});throw Error('rollback');}),/rollback/);
  assert.equal(f.row(),undefined);assert.equal(f.job(),undefined);
  await f.publish();await f.publish();await f.publish({eventKey:'different retry key'});
  assert.equal(f.raw.prepare('SELECT count(*) AS n FROM delivery_updates').get().n,1);
  assert.equal(f.raw.prepare('SELECT count(*) AS n FROM delivery_update_push_jobs').get().n,1);
  const initial=(await f.service.list(f.customerId)).updates[0];
  assert.equal(initial.etaMinutes,null);assert.match(initial.body,/map-based delivery time is currently unavailable/);
  assert.equal(f.sent.length,0);assert.equal(f.estimates(),0);
  assert.equal(f.row().route_json.includes('private'),false);
  await f.service.deliverPending();
  const saved=await f.service.forTarget(f.customerId,'food',f.targetId);
  assert.equal(saved.etaMinutes,11);assert.match(saved.body,/approximately 11 minutes/);
  assert.equal(f.row().route_json,null);assert.equal(f.row().eta_state,'done');
  assert.deepEqual(f.sent[0],{token:f.job().token,deliveryUpdateId:saved.id,deliveryTitle:saved.title,deliveryBody:saved.body});
  assert.equal(JSON.stringify(saved).includes('route'),true,'only the safe road-route explanatory note contains route');
  for(const field of ['routeJson','userId','eventKey','etaAttempts','token','sessionId']) assert.equal(Object.hasOwn(saved,field),false);
  assert.equal((await f.service.list(f.customerId)).unread,1);
  assert.deepEqual(await f.service.open(f.customerId,saved.id),{target:{screen:'food-order',id:f.targetId}});
  assert.equal((await f.service.list(f.customerId)).unread,0);
});

test('delivery ETA is available in-app with push disabled and later opt-in never replays old milestones',async t=>{
  for(const settings of [{enabled:false},{registered:false}]) {
    const f=fixture(t,settings);await f.publish();await f.service.deliverPending();
    assert.equal((await f.service.forTarget(f.customerId,'food',f.targetId)).etaMinutes,11);
    assert.equal(f.sent.length,0);assert.equal(f.job(),undefined);
    f.provider.enabled=true;await f.service.deliverPending();assert.equal(f.sent.length,0);
  }
});

test('pickup route failure falls back honestly and arrival/delivery supersede obsolete pickup push',async t=>{
  const f=fixture(t);await f.publish();
  await f.duplicate({estimateEta:async()=>{throw Error('private provider failure');}}).deliverPending();
  assert.equal(f.sent.length,1);assert.match(f.sent[0].deliveryBody,/currently unavailable/);
  assert.equal(f.row().route_json,null);
  const g=fixture(t);await g.publish();g.phase('arrived');await g.publish();
  await g.service.deliverPending();assert.equal(g.estimates(),0);assert.equal(g.sent.length,1);
  assert.match(g.sent[0].deliveryBody,/has arrived at the recipient/);
  assert.equal(g.raw.prepare("SELECT status FROM delivery_update_push_jobs j JOIN delivery_updates n ON n.id=j.update_id WHERE n.phase='picked_up'").get().status,'suppressed');
  g.phase('delivered');await g.publish();
  assert.equal((await g.service.forTarget(g.customerId,'food',g.targetId)).phase,'delivered','same-millisecond milestones use lifecycle order');
  await g.service.deliverPending();assert.match(g.sent.at(-1).deliveryBody,/handover has been confirmed/);
});

test('revoked recipients and opted-out or replaced device tokens cannot open or send delivery updates',async t=>{
  for(const method of ['revoke','unregister','replaceToken']) {
    const f=fixture(t);await f.publish();const id=f.row().id;f[method]();await f.service.deliverPending();
    assert.equal(f.sent.length,0,method);assert.equal(f.job().status,'suppressed',method);
    if(method==='revoke') {
      await assert.rejects(f.service.open(f.customerId,id),{code:'NOT_FOUND'});
      assert.deepEqual((await f.service.list(f.customerId)).updates,[]);
      assert.equal((await f.service.list(f.customerId)).unread,0);
    }
  }
  const f=fixture(t);await f.publish();await assert.rejects(f.service.open(f.recipientId,f.row().id),{code:'NOT_FOUND'});
  await assert.rejects(f.service.list(f.recipientId,f.row().id),{code:'INVALID_CURSOR'});
});

test('recipient notices are account-bound and session deletion removes stored push tokens',async t=>{
  const f=fixture(t,{recipients:2});await f.publish({kind:'parcel'});
  const customer=(await f.service.list(f.customerId)).updates[0],recipient=(await f.service.list(f.recipientId)).updates[0];
  assert.notEqual(customer.id,recipient.id);assert.equal(recipient.kind,'parcel');
  assert.deepEqual(await f.service.open(f.recipientId,recipient.id),{target:{screen:'parcels',id:f.targetId}});
  await assert.rejects(f.service.open(f.recipientId,customer.id),{code:'NOT_FOUND'});
  f.raw.prepare('DELETE FROM device_sessions WHERE id=?').run(f.sessionId);
  assert.equal(f.raw.prepare('SELECT count(*) AS n FROM delivery_update_push_jobs').get().n,0);
});

test('competing workers lease ETA/push once and provider receipt failures never resend a ticketed push',async t=>{
  const f=fixture(t);await f.publish();let entered,complete;
  const ready=new Promise(resolve=>{entered=resolve;});
  f.provider.send=async data=>{f.sent.push(data);entered();return new Promise(resolve=>{complete=resolve;});};
  const first=f.service.deliverPending();await ready;await f.duplicate().deliverPending();assert.equal(f.sent.length,1);
  complete({status:'ticket',ticket:'fixture-ticket'});await first;
  f.provider.receipt=async ticket=>{f.receipts.push(ticket);return {status:'retry'};};
  f.advance(15*60_000);await f.service.deliverPending();assert.equal(f.sent.length,1);assert.equal(f.receipts.length,1);
  f.phase('delivered');f.provider.receipt=async ticket=>{f.receipts.push(ticket);return {status:'ok'};};
  f.advance(60_000*2);await f.service.deliverPending();assert.equal(f.job().status,'done');assert.equal(f.sent.length,1);
});

test('revocation during route lookup clears coordinates and prevents subsequent push',async t=>{
  const f=fixture(t);await f.publish();let entered,complete;
  const ready=new Promise(resolve=>{entered=resolve;});
  const worker=f.duplicate({estimateEta:async()=>{entered();return new Promise(resolve=>{complete=resolve;});}});
  const running=worker.deliverPending();await ready;f.revoke();complete({source:'road',durationSeconds:600});await running;
  assert.equal(f.sent.length,0);assert.equal(f.row().eta_minutes,null);assert.equal(f.row().route_json,null);assert.equal(f.job().status,'suppressed');
});

test('delivery worker shutdown waits for in-flight I/O and leaves a reclaimable lease',async t=>{
  const f=fixture(t);await f.publish();let entered,complete;
  const ready=new Promise(resolve=>{entered=resolve;});
  const worker=f.duplicate({estimateEta:async()=>{entered();return new Promise(resolve=>{complete=resolve;});}});
  const running=worker.deliverPending();await ready;let drained=false;
  const stopping=worker.stop().then(()=>{drained=true;});await Promise.resolve();assert.equal(drained,false);
  complete({source:'road',durationSeconds:600});await Promise.all([running,stopping]);
  assert.equal(drained,true);assert.equal(f.row().eta_state,'pending');assert.equal(f.sent.length,0);
  f.advance(60_000);await f.service.deliverPending();assert.equal(f.row().eta_state,'done');assert.equal(f.sent.length,1);
});

test('delivery inbox cursor is stable when event timestamps tie and is scoped to its owner',async t=>{
  const f=fixture(t,{enabled:false}),now=1_000_000;
  const ids=[];
  for(let index=0;index<52;index++) {
    const id=randomUUID();ids.push(id);
    await f.repository.add({id,userId:f.customerId,kind:'food',targetId:randomUUID(),phase:'picked_up',
      eventKey:`cursor:${index}`,title:'Kemmy',body:'Saved',note:'',etaMinutes:null,now,routeJson:null});
  }
  const service=f.duplicate({access:async(_user,_kind,id)=>({screen:'food-order',id})});
  const first=await service.list(f.customerId),second=await service.list(f.customerId,first.nextBefore);
  assert.equal(first.updates.length,50);assert.equal(second.updates.length,2);assert.equal(second.nextBefore,null);
  assert.deepEqual([...first.updates,...second.updates].map(row=>row.id),ids.sort().reverse());
  assert.equal(first.unread,52);
  await assert.rejects(service.list(f.customerId,'invalid'),{code:'INVALID_CURSOR'});
});
