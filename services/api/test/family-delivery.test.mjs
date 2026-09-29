import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { asAsyncDatabase } from '../src/infrastructure/async-database.mjs';
import { createFamilyDeliveryRepository } from '../src/modules/family-delivery/repository.mjs';
import { createFamilyDeliveryService } from '../src/modules/family-delivery/service.mjs';
import { createPushProvider } from '../src/infrastructure/push-provider.mjs';

const projectId = '00000000-0000-4000-8000-000000000001';
function fixture(t,{enabled=true,registered=true}={}) {
  const raw = new DatabaseSync(':memory:');
  raw.exec(`PRAGMA foreign_keys=ON; CREATE TABLE users(id TEXT PRIMARY KEY);
    CREATE TABLE family_events(id TEXT PRIMARY KEY,user_id TEXT REFERENCES users(id));
    INSERT INTO users(id) VALUES('observer');`);
  raw.exec(readFileSync(new URL('../migrations/032_family_delivery.sql',import.meta.url),'utf8'));
  t.after(() => raw.close());
  const db=asAsyncDatabase(raw),repository=createFamilyDeliveryRepository(db),sent=[],receipts=[],changes=[];
  const eventId=randomUUID(),token='ExpoPushToken[family_fixture_no_real_destination]',sessionId='fixture-session';
  raw.prepare('INSERT INTO family_events(id,user_id) VALUES(?,?)').run(eventId,'observer');
  let now=1_000_000,allowed=true,currentToken=registered?token:null;
  const provider={enabled,send:async(data)=>{sent.push(data);return {status:'ticket',ticket:'family-ticket'};},
    receipt:async(ticket)=>{receipts.push(ticket);return {status:'ok'};}};
  const args={repository,provider,familyTargets:async()=>currentToken?[{sessionId,token:currentToken}]:[],
    validFamilyTarget:async(job)=>job.userId==='observer' && job.sessionId===sessionId && job.token===currentToken,
    disableTarget:async(value)=>{if (currentToken===value) currentToken=null;},
    dispatchable:async(event,user)=>allowed && event===eventId && user==='observer',
    unitOfWork:run=>db.transaction(run),tokens:{id:randomUUID},clock:()=>now,onChanged:async(user)=>changes.push(user)};
  const service=createFamilyDeliveryService(args);
  return {raw,db,repository,service,eventId,token,sent,receipts,provider,changes,
    duplicate:(overrides={})=>createFamilyDeliveryService({...args,...overrides}),advance:ms=>{now+=ms;},revoke:()=>{allowed=false;},
    unregister:()=>{currentToken=null;},replaceToken:()=>{currentToken='ExpoPushToken[replacement_fixture_destination]';},
    enqueue:()=>db.transaction(()=>service.enqueue(eventId,'observer')),
    row:()=>raw.prepare('SELECT * FROM family_push_jobs').get(),
    delivery:()=>service.deliveryFor(eventId,'observer')};
}

test('family event outbox is transactional, idempotent and keeps provider acceptance separate from human acknowledgment',async(t)=>{
  const f=fixture(t);
  await assert.rejects(f.db.transaction(async()=>{await f.service.enqueue(f.eventId,'observer');throw Error('rollback');}),/rollback/);
  assert.equal(f.row(),undefined);
  await f.enqueue();await f.enqueue();assert.equal(f.raw.prepare('SELECT count(*) AS n FROM family_push_jobs').get().n,1);
  assert.equal((await f.delivery()).status,'queued');assert.equal(f.sent.length,0);
  await f.service.deliverPending();
  assert.deepEqual(f.sent,[{token:f.token,familyEventId:f.eventId}]);
  let status=await f.delivery();assert.equal(status.status,'provider_accepted');assert.ok(status.acceptedAt);
  assert.equal(status.providerConfirmedAt,null);assert.equal(status.deliveredAt,null);
  await f.service.deliverPending();assert.equal(f.receipts.length,0);
  f.advance(15*60_000);await f.service.deliverPending();
  status=await f.delivery();assert.equal(status.status,'provider_accepted');assert.ok(status.providerConfirmedAt);
  assert.equal(status.deliveredAt,null);assert.equal(Object.hasOwn(status,'acknowledgedAt'),false);
  f.advance(15*60_000);await f.service.deliverPending();assert.equal(f.receipts.length,1);assert.equal(f.sent.length,1);
  assert.ok(f.changes.every(id=>id==='observer'));
  assert.equal((await f.service.deliveryFor(f.eventId,'outsider')).status,'saved');
});

test('disabled or unregistered family push stays saved in app and does not replay old events on opt-in',async(t)=>{
  for (const options of [{enabled:false},{registered:false}]) {
    const f=fixture(t,options);await f.enqueue();await f.service.deliverPending();
    assert.equal(f.row(),undefined);assert.equal((await f.delivery()).status,'saved');assert.equal(f.sent.length,0);
    f.provider.enabled=true;await f.service.deliverPending();assert.equal(f.sent.length,0);
  }
});

test('revoked family sharing, device opt-out and reassigned tokens suppress delivery before external I/O',async(t)=>{
  for (const action of ['revoke','unregister','replaceToken']) {
    const f=fixture(t);await f.enqueue();f[action]();await f.service.deliverPending();
    assert.equal(f.sent.length,0,action);assert.equal((await f.delivery()).status,'suppressed',action);
  }
});

test('family worker retries temporary failure, disables invalid registration and caps delivery attempts',async(t)=>{
  const f=fixture(t);await f.enqueue();
  f.provider.send=async(data)=>{f.sent.push(data);return {status:'retry'};};
  await f.service.deliverPending();assert.equal(f.row().attempts,1);assert.equal(f.row().status,'queued');
  await f.service.deliverPending();assert.equal(f.sent.length,1);
  f.advance(60_000);f.provider.send=async()=>({status:'unregistered'});await f.service.deliverPending();
  assert.equal((await f.delivery()).status,'failed');
  await f.enqueue();assert.equal(f.raw.prepare('SELECT count(*) AS n FROM family_push_jobs').get().n,1);
  const g=fixture(t);await g.enqueue();g.raw.prepare('UPDATE family_push_jobs SET attempts=8').run();
  await g.service.deliverPending();assert.equal(g.sent.length,0);assert.equal(g.row().status,'failed');
});

test('separate family workers claim once and stale provider replies cannot replace a newer attempt',async(t)=>{
  const f=fixture(t);await f.enqueue();let entered,complete,calls=0;
  const ready=new Promise(resolve=>{entered=resolve;});
  f.provider.send=async()=>{calls++;if(calls===1){entered();return new Promise(resolve=>{complete=resolve;});}
    return {status:'ticket',ticket:'replacement-ticket'};};
  const first=f.service.deliverPending();await ready;const second=f.duplicate();
  await second.deliverPending();assert.equal(calls,1);
  f.advance(60_000);await second.deliverPending();assert.equal(calls,2);
  complete({status:'ticket',ticket:'stale-ticket'});await first;
  assert.equal(f.row().attempts,2);assert.equal(f.row().ticket,'replacement-ticket');
});

test('expired family notices fail without sending, while receipt errors never resend an accepted push',async(t)=>{
  const expired=fixture(t);await expired.enqueue();expired.advance(86_400_000);
  await expired.service.deliverPending();assert.equal(expired.sent.length,0);assert.equal(expired.row().status,'failed');
  const f=fixture(t);await f.enqueue();await f.service.deliverPending();
  f.provider.receipt=async()=>({status:'retry'});f.advance(15*60_000);await f.service.deliverPending();
  assert.equal(f.row().status,'provider_accepted');assert.equal(f.row().provider_confirmed_at,null);
  f.provider.receipt=async()=>({status:'unregistered'});f.advance(15*60_000);await f.service.deliverPending();
  assert.equal(f.row().status,'failed');assert.equal(f.sent.length,1);assert.equal((await f.delivery()).deliveredAt,null);
});

test('revocation during provider I/O prevents late success from restoring sharing or marking delivery',async(t)=>{
  for (const action of ['revoke','unregister','replaceToken']) {
    const f=fixture(t);await f.enqueue();let entered,complete;
    const ready=new Promise(resolve=>{entered=resolve;});
    f.provider.send=async()=>{entered();return new Promise(resolve=>{complete=resolve;});};
    const sending=f.service.deliverPending();await ready;f[action]();
    complete({status:'ticket',ticket:'late-ticket'});await sending;
    assert.equal(f.row().status,'suppressed',action);assert.equal((await f.delivery()).deliveredAt,null);
  }
});

test('family worker shutdown leaves a reclaimable lease without accessing the database after I/O',async(t)=>{
  const f=fixture(t);await f.enqueue();let entered,complete;
  const ready=new Promise(resolve=>{entered=resolve;});
  f.provider.send=async()=>{entered();return new Promise(resolve=>{complete=resolve;});};
  const sending=f.service.deliverPending();await ready;
  let drained=false;const stopping=f.service.stop().then(()=>{drained=true;});
  await Promise.resolve();assert.equal(drained,false,'shutdown must await in-flight provider I/O');
  complete({status:'ticket',ticket:'after-stop'});await Promise.all([sending,stopping]);assert.equal(drained,true);
  assert.equal(f.row().status,'queued');assert.equal(f.row().attempts,1);
  f.advance(60_000);f.provider.send=async()=>({status:'ticket',ticket:'recovered'});await f.duplicate().deliverPending();
  assert.equal(f.row().ticket,'recovered');
});

test('family worker shutdown waits for an authorization read and prevents a later provider send',async(t)=>{
  const f=fixture(t);await f.enqueue();let entered,complete;
  const ready=new Promise(resolve=>{entered=resolve;});
  const worker=f.duplicate({dispatchable:async()=>{entered();return new Promise(resolve=>{complete=resolve;});}});
  const sending=worker.deliverPending();await ready;
  let drained=false;const stopping=worker.stop().then(()=>{drained=true;});
  await Promise.resolve();assert.equal(drained,false,'the database must remain open until authorization and its transaction finish');
  complete(true);await Promise.all([sending,stopping]);
  assert.equal(drained,true);assert.equal(f.sent.length,0);assert.equal(f.row().status,'queued');
});

test('Expo family pushes contain only generic text and a validated opaque event ID, preserving journey routing',async()=>{
  const eventId=randomUUID(),payloads=[];
  const provider=createPushProvider({env:{TAXI_AI_PUSH_ENABLED:'true',TAXI_AI_EXPO_PROJECT_ID:projectId},
    fetchImpl:async(_url,options)=>{payloads.push(JSON.parse(options.body));return Response.json({data:{status:'ok',id:'fixture-ticket'}});}});
  await provider.send({token:'fixture',familyEventId:eventId,arrivalBody:'Must never disclose identity'});
  assert.deepEqual(payloads[0].data,{kind:'family',eventId});
  assert.equal(payloads[0].body,'You have a Family Safety update. Open Taxi Ai to view it.');
  assert.equal(JSON.stringify(payloads[0]).includes('identity'),false);
  assert.deepEqual(await provider.send({token:'fixture',familyEventId:'bad-id'}),{status:'error'});
  assert.equal(payloads.length,1);
  await provider.send({token:'fixture',notificationId:42});assert.deepEqual(payloads[1].data,{notificationId:42});
});
