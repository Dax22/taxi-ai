import test from 'node:test';
import assert from 'node:assert/strict';
import { harness, participants, requestRide, claimRide } from './helpers.mjs';
import { createApplication } from '../src/application.mjs';
import { createPushProvider } from '../src/infrastructure/push-provider.mjs';
import { createNotificationsRepository } from '../src/modules/notifications/repository.mjs';
import { transaction } from '../src/infrastructure/database.mjs';
const projectId='00000000-0000-4000-8000-000000000001',token='ExpoPushToken[fixture_no_real_destination]';
async function fixture(t){
  const h=await harness(t),{customer,driver}=await participants(h);
  const sent=[],receipts=[];
  const provider={enabled:true,projectId,send:async(data)=>{sent.push(data);return{status:'ticket',ticket:'fixture-ticket'};},receipt:async(ticket)=>{receipts.push(ticket);return{status:'ok'};}};
  const app=createApplication({db:h.db,clock:()=>h.now,allowSimulation:true,pushProvider:provider});
  const credentials=app.devices.issue(customer.user.id,'Test device').credentials;
  app.notifications.register(customer.user.id,credentials.sessionId,{token,projectId});
  const ride=await claimRide(driver,await requestRide(customer));
  return{h,customer,driver,app,credentials,provider,ride,sent,receipts};
}
test('push jobs persist separately from transactions, await receipts and contain no journey or message contents',async(t)=>{
  const f=await fixture(t);assert.equal(f.sent.length,0);
  const row=f.h.db.prepare('SELECT status FROM push_jobs').get();assert.equal(row.status,'pending');
  await f.app.notifications.deliverPending();assert.equal(f.sent.length,1);assert.deepEqual(Object.keys(f.sent[0]).sort(),['notificationId','token']);
  assert.equal(f.h.db.prepare('SELECT status FROM push_jobs').get().status,'ticket');
  await f.app.notifications.deliverPending();assert.equal(f.sent.length,1);
  f.h.advance(15*60_000);await f.app.notifications.deliverPending();assert.equal(f.receipts.length,1);
  assert.equal(f.h.db.prepare('SELECT status FROM push_jobs').get().status,'done');
});

test('temporary provider failures retry from the outbox, concurrent workers are guarded, and invalid tokens are disabled',async(t)=>{
  const f=await fixture(t);let calls=0,resolve;
  f.provider.send=()=>{calls++;return new Promise((r)=>{resolve=r;});};
  const first=f.app.notifications.deliverPending();await f.app.notifications.deliverPending();assert.equal(calls,1);
  resolve({status:'retry'});await first;assert.equal(f.h.db.prepare('SELECT status FROM push_jobs').get().status,'pending');
  f.h.advance(60_000);f.provider.send=async()=>{calls++;return{status:'unregistered'};};await f.app.notifications.deliverPending();
  assert.equal(calls,2);assert.equal(f.h.db.prepare('SELECT count(*) AS n FROM push_registrations').get().n,0);
  assert.equal(f.h.db.prepare('SELECT status FROM push_jobs').get().status,'dead');
});

test('sign-out, opt-out and reassignment of a phone token prevent old-account jobs from being delivered',async(t)=>{
  for(const action of ['revoke','disable','transfer']){
    const f=await fixture(t);
    if(action==='revoke')f.app.devices.revoke(f.customer.user,f.credentials.sessionId);
    if(action==='disable')f.app.notifications.unregister(f.customer.user.id,f.credentials.sessionId,{});
    if(action==='transfer'){
      const other=f.h.client();await other.register('token-recipient');
      const session=f.app.devices.issue(other.user.id,'Other account').credentials;
      f.app.notifications.register(other.user.id,session.sessionId,{token,projectId});
    }
    await f.app.notifications.deliverPending();assert.equal(f.sent.length,0,action);assert.equal(f.h.db.prepare('SELECT status FROM push_jobs').get().status,'dead');
  }
});

test('device revocation during provider I/O is rechecked, and stopped workers do not access a closed database',async(t)=>{
  const f=await fixture(t);let finish;f.provider.send=()=>new Promise((resolve)=>{finish=resolve;});
  const pending=f.app.notifications.deliverPending();f.app.devices.revoke(f.customer.user,f.credentials.sessionId);finish({status:'ticket',ticket:'late-ticket'});await pending;
  assert.equal(f.h.db.prepare('SELECT status FROM push_jobs').get().status,'dead');
  const g=await fixture(t);let done;g.provider.send=()=>new Promise((resolve)=>{done=resolve;});
  const stopping=g.app.notifications.deliverPending();g.app.notifications.stop();done({status:'ticket',ticket:'after-close'});await stopping;
  assert.equal(g.h.db.prepare('SELECT status FROM push_jobs').get().status,'pending');
});

test('notification pagination and reads are private and stable when newer events arrive',async(t)=>{
  const f=await fixture(t),repo=createNotificationsRepository(f.h.db);
  transaction(f.h.db,()=>{for(let i=0;i<55;i++)f.app.notifications.publish({userId:f.customer.user.id,rideId:f.ride.id,kind:'message',mode:'customer',eventKey:`fixture-${i}`});});
  const page=f.app.notifications.list(f.customer.user.id,null,f.credentials.sessionId);assert.equal(page.notifications.length,50);assert.ok(page.nextBefore);
  transaction(f.h.db,()=>f.app.notifications.publish({userId:f.customer.user.id,rideId:f.ride.id,kind:'arrive',mode:'customer',eventKey:'new-arrival'}));
  const older=f.app.notifications.list(f.customer.user.id,page.nextBefore,f.credentials.sessionId);assert.equal(older.notifications.length,6);
  assert.equal(page.notifications.some((n)=>older.notifications.some((old)=>old.id===n.id)),false);
  assert.throws(()=>f.app.notifications.list(f.driver.user.id,page.nextBefore),{code:'NOT_FOUND'});
  assert.equal(repo.unread(f.customer.user.id),57);f.app.notifications.read(f.customer.user.id,page.notifications[0].id);f.app.notifications.read(f.customer.user.id,page.notifications[0].id);
  assert.equal(repo.unread(f.customer.user.id),56);
});

test('Expo adapter uses generic bounded payloads, fixed HTTPS endpoints, tickets and receipt error semantics',async()=>{
  const requests=[],results=[{data:{status:'ok',id:'ticket'}},{data:{ticket:{status:'ok'}}},{data:{status:'error',details:{error:'DeviceNotRegistered'}}}];
  const provider=createPushProvider({env:{TAXI_AI_PUSH_ENABLED:'true',TAXI_AI_EXPO_PROJECT_ID:projectId},fetchImpl:async(url,options)=>{requests.push({url,...options});return Response.json(results.shift());}});
  assert.deepEqual(await provider.send({token,notificationId:1}),{status:'ticket',ticket:'ticket'});
  assert.deepEqual(await provider.receipt('ticket'),{status:'ok'});
  assert.deepEqual(await provider.send({token,notificationId:2}),{status:'unregistered'});
  assert.equal(requests[0].url,'https://exp.host/--/api/v2/push/send');assert.equal(requests[1].url,'https://exp.host/--/api/v2/push/getReceipts');
  const body=JSON.parse(requests[0].body);assert.deepEqual(body.data,{notificationId:1});assert.equal(body.ttl,300);assert.equal(requests[0].redirect,'error');
  let called=false;const off=createPushProvider({fetchImpl:async()=>{called=true;throw new Error('No external contact expected');}});await off.send({token,notificationId:1});assert.equal(called,false);
  assert.throws(()=>createPushProvider({env:{TAXI_AI_PUSH_ENABLED:'true'}}),/project/i);
});
