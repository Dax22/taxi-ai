import { removeEatsFixtureTables } from './migration-fixtures.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { harness, participants, PASSWORD } from './helpers.mjs';
import { DETAILS, submitApplication, approveApplication, fixtureApi } from './driver-fixtures.mjs';
import { parseJourney, parseWork, parseThread, parseSentMessage, parseNotifications } from '../../../packages/shared/src/mobile-journeys.mjs';
import { TRANSPORT_CATEGORIES } from '../../../packages/shared/src/transport-categories.mjs';
const sample={pickupId:'wuse-ii',destinationId:'maitama'},parcel={description:'Fictional parcel',weightKg:2,recipientName:'Test recipient'};
const ok=(r)=>{assert.equal(r.status,200,JSON.stringify(r.body));return r.body;};
async function send(h,path,{token,data,key=randomUUID(),headers={}}={}){
  const response=await fetch(h.base+'/api/mobile/v1'+path,{method:data===undefined?'GET':'POST',headers:{'Content-Type':'application/json','Idempotency-Key':key,...(token?{Authorization:`Bearer ${token}`} : {}),...headers},...(data===undefined?{}:{body:JSON.stringify(data)})});
  return{status:response.status,body:await response.json()};
}
async function phone(h,actor){
  let credentials=ok(await send(h,'/auth/login',{data:{email:actor.user.email,password:PASSWORD,deviceName:'Journey fixture'}})).credentials;
  const clientId=randomUUID();
  return{get credentials(){return credentials;},clientId,send:(path,data,key)=>send(h,path,{token:credentials.accessToken,data,key}),
    async refresh(){credentials=ok(await send(h,'/auth/refresh',{data:{refreshToken:credentials.refreshToken}})).credentials;},
    work:()=>send(h,`/work?clientId=${clientId}`,{token:credentials.accessToken}),
    online:()=>send(h,`/work/online?clientId=${clientId}`,{token:credentials.accessToken,data:{mode:'sample',areaId:'wuse-ii'}}),
  };
}
const act=async(p,r,action,extra={},key)=>parseJourney(ok(await p.send(`/journeys/${r.id}/${action}`,{expectedVersion:r.version,...extra},key))).ride;

test('native passenger and delivery journeys complete across all vehicle categories with exact fare, private chat, PINs and shared history',async(t)=>{
  const h=await harness(t),{customer,admin}=await participants(h,0),c=await phone(h,customer);
  for(const [category,policy] of Object.entries(TRANSPORT_CATEGORIES)){
    const driver=h.client();await driver.register(`native-${category}`,'driver');
    await submitApplication(fixtureApi(driver),'2099-12-31',{...DETAILS,vehicle:{...DETAILS.vehicle,category,payloadKg:policy.maxLoadKg}});
    await approveApplication(fixtureApi(admin),driver.user.id);
    const d=await phone(h,driver);ok(await d.online());
    let r=ok(await c.send('/booking/requests',{...sample,vehicleCategory:category,...(policy.service==='delivery'?{delivery:parcel}:{})})).ride;
    const jobs=parseWork(ok(await d.work()));assert.equal(jobs.availability.owned,true);assert.equal(jobs.available[0].id,r.id);
    assert.equal(jobs.available[0].recommendation.policyVersion,'proximity-wait-v1');
    assert.deepEqual(jobs.available[0].recommendation.reasons,['sample_area']);
    assert.equal(JSON.stringify(jobs.available).includes(parcel.recipientName),false);
    const notices=parseNotifications(ok(await d.send('/notifications')));assert.equal(notices.notifications[0].kind,'request');
    const key=randomUUID(),data={expectedVersion:r.version};
    r=await act(d,r,'claim',{},key);assert.equal(r.status,'negotiating');assert.equal(r.mode,'work');
    assert.equal(ok(await d.send(`/journeys/${r.id}/claim`,data,key)).replayed,true);
    assert.equal(parseWork(ok(await d.work())).availability,null);
    r=await act(c,r,'propose',{amountKobo:r.suggestedFareKobo+1});
    assert.equal((await c.send(`/journeys/${r.id}/accept`,{expectedVersion:r.version,offerId:r.offer.id})).body.error.code,'SELF_ACCEPTANCE');
    r=await act(d,r,'accept',{offerId:r.offer.id});
    r=await act(c,r,'confirm');const pickup=r.pickupPin;assert.match(pickup,/^\d{6}$/);
    const chatKey=randomUUID(),body={body:'Meet at the test pickup.'};
    const sent=parseSentMessage(ok(await c.send(`/journeys/${r.id}/chat/messages`,body,chatKey))).message;
    assert.equal(ok(await c.send(`/journeys/${r.id}/chat/messages`,body,chatKey)).message.id,sent.id);
    const thread=parseThread(ok(await d.send(`/journeys/${r.id}/chat`)));assert.equal(thread.messages.length,1);assert.equal(thread.messages[0].fromYou,false);
    assert.equal(ok(await d.send(`/journeys/${r.id}/chat/read`,{throughSequence:sent.sequence})).unread,0);
    ok(await d.send(`/journeys/${r.id}/chat/messages/${sent.id}/report`,{reason:'other'}));
    assert.equal(parseThread(ok(await d.send(`/journeys/${r.id}/chat`))).reportedMessageIds[0],sent.id);
    r=await act(d,r,'depart');assert.equal(r.pickupPin,null);r=await act(d,r,'arrive');
    const arrival=parseNotifications(ok(await c.send('/notifications'))).notifications.find((n)=>n.rideId===r.id&&n.kind==='arrive');
    assert.equal(arrival.arrivalActive,true);assert.match(arrival.body,/TEST-DRIVER/);assert.match(arrival.body,/Toyota Corolla/);assert.match(arrival.body,/Yellow/);
    r=await act(d,r,'start',{pickupPin:pickup});
    const sender=parseJourney(ok(await c.send(`/journeys/${r.id}`))).ride;
    assert.equal(r.delivery?.dropoffPin,undefined);
    r=await act(d,r,'complete',policy.service==='delivery'?{deliveryPin:sender.delivery.dropoffPin}:{});
    assert.equal(r.status,'completed');assert.equal(parseWork(ok(await d.work())).current.length,0);assert.equal(r.delivery?.dropoffPin,undefined);
    if(policy.service==='ride'){
      const rated=parseJourney(ok(await c.send(`/journeys/${r.id}/rating`,{stars:5}))).ride;
      assert.equal(rated.rating,5);
      assert.equal(parseJourney(ok(await c.send(`/journeys/${r.id}`))).ride.rating,5);
    }
    const finalChat=parseThread(ok(await c.send(`/journeys/${r.id}/chat`)));assert.equal(finalChat.canSend,false);
    assert.equal(ok(await c.send('/activity?mode=customer')).history.some((j)=>j.id===r.id),true);
    assert.equal(ok(await customer.send(`/api/rides/${r.id}`)).ride.status,'completed');
    const updates=parseNotifications(ok(await c.send('/notifications'))).notifications;
    assert.equal(updates.filter((n)=>n.rideId===r.id&&n.kind==='claim').length,1);
    assert.equal(updates.filter((n)=>n.rideId===r.id&&n.kind==='complete').length,1);
    for(const field of ['pickupPin','dropoffPin','description','accessToken'])assert.equal(JSON.stringify(updates).includes(`"${field}"`),false);
    assert.equal(JSON.stringify(updates).includes(body.body),false,'chat text must stay out of notification bodies');
    for(const notice of updates){
      if(notice.kind==='arrive'){assert.equal(notice.arrivalActive,false);assert.match(notice.body,/Number plate: TEST-DRIVER/);}
      else assert.equal(notice.body,undefined,'only arrival notices include a body');
    }
  }
});

test('native availability survives access rotation, rejects another device and expires after revocation or heartbeat loss',async(t)=>{
  const h=await harness(t),{driver,customer}=await participants(h,1,{online:false}),d=await phone(h,driver),second=await phone(h,driver);
  const lease=ok(await d.online()).availability,initial=d.credentials.accessToken;
  await d.refresh();assert.notEqual(d.credentials.accessToken,initial);
  assert.equal(parseWork(ok(await d.work())).availability.owned,true);
  assert.equal(parseWork(ok(await second.work())).availability.owned,false);
  const heartbeat=`/work/${lease.id}/heartbeat?clientId=${d.clientId}`;
  assert.equal((await second.send(heartbeat,{sequence:2})).body.error.code,'AVAILABILITY_WINDOW');
  assert.equal(ok(await d.send(heartbeat,{sequence:2})).availability.sequence,2);
  const web=await driver.send('/api/availability',{headers:{'X-Availability-Client':d.clientId}});assert.equal(ok(web).availability.owned,false);
  assert.equal((await send(h,'/work',{headers:{Cookie:driver.cookie}})).status,401);
  assert.equal((await send(h,'/work',{token:d.credentials.accessToken,headers:{Origin:h.base}})).status,403);
  const c=await phone(h,customer);assert.equal((await c.work()).status,403);
  const replayKey=randomUUID();ok(await second.send(`/work/${lease.id}/offline?clientId=${second.clientId}`,{},replayKey));
  assert.equal(ok(await second.send(`/work/${lease.id}/offline?clientId=${second.clientId}`,{},replayKey)).replayed,true);
  const next=ok(await d.online()).availability;
  ok(await driver.post(`/api/account/devices/${d.credentials.sessionId}/revoke`));
  assert.equal((await d.send(`/work/${next.id}/heartbeat?clientId=${d.clientId}`,{sequence:2})).status,401);
  assert.equal(parseWork(ok(await second.work())).availability,null);
  ok(await second.online());h.advance(60_000);assert.equal(parseWork(ok(await second.work())).availability,null);
});

test('journey and update access are account scoped; stale versions and superseded offers cannot change a booking',async(t)=>{
  const h=await harness(t),{customer,driver}=await participants(h,1,{online:false}),c=await phone(h,customer),d=await phone(h,driver);
  const outsider=h.client();await outsider.register('native-outsider');const o=await phone(h,outsider);
  ok(await d.online());let r=ok(await c.send('/booking/requests',sample)).ride;r=await act(d,r,'claim');
  for(const path of [`/journeys/${r.id}`,`/journeys/${r.id}/chat`])assert.equal((await o.send(path)).status,404);
  assert.equal((await o.send(`/journeys/${r.id}/cancel`,{expectedVersion:r.version})).status,404);
  r=await act(c,r,'propose',{amountKobo:123401});const old=r.offer;
  r=await act(d,r,'propose',{amountKobo:234502});
  assert.equal((await c.send(`/journeys/${r.id}/accept`,{expectedVersion:r.version,offerId:old.id})).body.error.code,'STALE_OFFER');
  assert.equal((await c.send(`/journeys/${r.id}/cancel`,{expectedVersion:r.version-1})).body.error.code,'STALE_VERSION');
  const n=parseNotifications(ok(await c.send('/notifications'))).notifications[0];
  assert.equal((await o.send(`/notifications/${n.id}/open`,{})).status,404);
  assert.equal((await o.send(`/notifications/${n.id}/read`,{})).status,404);
  assert.equal((await o.send(`/notifications?before=${n.id}`)).status,404);
  assert.equal(ok(await c.send(`/notifications/${n.id}/open`,{})).target.rideId,r.id);
  assert.equal(parseNotifications(ok(await c.send('/notifications'))).notifications[0].readAt,h.now);
  h.advance(120_000);assert.equal((await c.send(`/journeys/${r.id}/accept`,{expectedVersion:r.version,offerId:r.offer.id})).body.error.code,'OFFER_EXPIRED');
  r=await act(c,r,'cancel');assert.equal(r.status,'cancelled');
});

test('notifications commit once with the journey, roll back on persistence failure and survive restart',async(t)=>{
  const h=await harness(t,{persistent:true}),{customer,driver}=await participants(h,1,{online:false}),c=await phone(h,customer),d=await phone(h,driver);
  ok(await d.online());let r=ok(await c.send('/booking/requests',sample)).ride;
  const key=randomUUID(),data={expectedVersion:r.version};
  h.db.exec("CREATE TRIGGER fail_notification BEFORE INSERT ON account_notifications BEGIN SELECT RAISE(ABORT,'fixture'); END");
  assert.equal((await d.send(`/journeys/${r.id}/claim`,data,key)).status,500);
  assert.equal(parseJourney(ok(await c.send(`/journeys/${r.id}`))).ride.status,'requested');
  assert.equal(parseWork(ok(await d.work())).availability.online,true);
  h.db.exec('DROP TRIGGER fail_notification');
  r=await act(d,r,'claim',{},key);await h.restart();
  assert.equal(ok(await d.send(`/journeys/${r.id}/claim`,data,key)).replayed,true);
  assert.equal(parseNotifications(ok(await c.send('/notifications'))).notifications.filter((n)=>n.kind==='claim').length,1);
  const messageKey=randomUUID(),body={body:'This fixture must only create one update.'};
  ok(await c.send(`/journeys/${r.id}/chat/messages`,body,messageKey));ok(await c.send(`/journeys/${r.id}/chat/messages`,body,messageKey));
  assert.equal(parseNotifications(ok(await d.send('/notifications'))).notifications.filter((n)=>n.kind==='message').length,1);
});

test('schema sixteen migration preserves existing web availability, native sessions, ride retries and trip history',async(t)=>{
  const h=await harness(t,{persistent:true}),{customer,driver}=await participants(h),c=await phone(h,customer);
  const key=randomUUID();const r=ok(await c.send('/booking/requests',sample,key)).ride;
  removeEatsFixtureTables(h.db); h.db.exec('DROP TABLE vehicle_photo_checks; DROP TABLE push_jobs; DROP TABLE push_registrations; DROP TABLE account_notifications; ALTER TABLE driver_availability DROP COLUMN native_session_id; PRAGMA user_version=16;');
  const tables=['users','sessions','device_sessions','device_refresh_tokens','rides','ride_trips','idempotency','driver_applications','availability_commands'];
  const records=new Map(tables.map((name)=>[name,h.db.prepare(`SELECT * FROM ${name}`).all()]));
  const availability=h.db.prepare('SELECT * FROM driver_availability').all().map((row)=>({...row}));
  await h.restart();
  for(const name of tables)assert.deepEqual(h.db.prepare(`SELECT * FROM ${name}`).all().map(row=>{if(name==='rides'){assert.equal(row.dispatch_region,`sample:${row.pickup_id}`);delete row.dispatch_region;}return row;}),records.get(name),name);
  assert.deepEqual(h.db.prepare('SELECT * FROM driver_availability').all().map(({native_session_id,expires_at,latitude,longitude,...row})=>{assert.equal(native_session_id,null);assert.equal(expires_at,row.seen_at+60_000);assert.equal(latitude,null);assert.equal(longitude,null);return row;}),availability);
  assert.equal(h.db.prepare('SELECT count(*) AS n FROM account_notifications').get().n,0);
  assert.equal(ok(await c.send('/booking/requests',sample,key)).ride.id,r.id);
  assert.equal(ok(await driver.send('/api/availability')).availability.online,true);
  assert.deepEqual(h.db.prepare('PRAGMA foreign_key_check').all(),[]);
});
