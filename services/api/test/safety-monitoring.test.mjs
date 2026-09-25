import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { harness,participants,requestRide,claimRide,PASSWORD } from './helpers.mjs';
import { createApplication } from '../src/application.mjs';
import { createSafetyAlertProvider } from '../src/infrastructure/safety-alert-provider.mjs';
import { saveSnapshot } from '../src/infrastructure/database-snapshot.mjs';
import { openDatabase } from '../src/infrastructure/database.mjs';
import { mkdtempSync,rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

async function setup(t,{available=true,send, persistent=false}={}) {
 const h=await harness(t,{persistent}),actors=await participants(h);let ride=await claimRide(actors.driver,await requestRide(actors.customer));
 async function step(actor,action,data={}){const r=await actor.post(`/api/rides/${ride.id}/${action}`,{expectedVersion:ride.version,...data});assert.equal(r.status,200);ride=r.body.ride;}
 await step(actors.driver,'offers',{amountKobo:470000});await step(actors.customer,'accept',{offerId:ride.negotiation.currentOffer.id});await step(actors.customer,'confirm');
 const contact=(await actors.customer.post('/api/safety/contacts',{name:'Test family',phone:'+2348000000000'})).body.contact;
 const sent=[];const provider={available,emergencyService:available?'Test emergency partner':null,send:send??(async p=>{sent.push(p);return {reference:'test-receipt'};})};
 const app=createApplication({db:h.db,clock:()=>h.now,safetyAlertProvider:provider}),ctx={userId:actors.customer.user.id,rideId:ride.id,sessionToken:actors.customer.cookie.match(/taxi_ai_session=([^;]+)/)[1]};
 const options={enabled:true,crash:true,distress:true,emergency:available,consent:true,contactIds:[contact.id],expectedVersion:0};
 const command=async (action,data,key=randomUUID())=>(await app.safetyMonitoring.command(ctx,action,data,key));
 return {h,...actors,ride,contact,app,ctx,command,options,sent,step};
}
const signal=(now)=>({signal:{kind:'manual',capturedAt:now},position:{lat:9.087654,lng:7.412345,accuracy:12,capturedAt:now}});

test('requires explicit consent and own contacts; isolates reporter and rejects stale or unsolicited signals',async t=>{
 const f=await setup(t);const {command,options,app,ctx,h,driver}=f;
 (await assert.rejects(async ()=>(await command('signal',signal(h.now))),{code:'SAFETY_UNAVAILABLE'}));
 (await assert.rejects(async ()=>(await command('preferences',{...options,consent:false})),{code:'INVALID_INPUT'}));
 const other=(await driver.post('/api/safety/contacts',{name:'Other family',phone:'+2348000000001'})).body.contact;
 (await assert.rejects(async ()=>(await command('preferences',{...options,contactIds:[other.id]})),{code:'INVALID_CONTACTS'}));
 (await command('preferences',options));
 (await assert.rejects(async ()=>(await command('signal',{signal:{kind:'distress',capturedAt:h.now,levelDb:-60,durationMs:3000}})),{code:'INVALID_INPUT'}));
 (await assert.rejects(async ()=>(await command('signal',signal(h.now-20_000))),{code:'INVALID_INPUT'}));
 const key=randomUUID(),data=signal(h.now),saved=(await command('signal',data,key));
 assert.equal((await command('signal',data,key)).alerts[0].id,saved.alerts[0].id);
 (await assert.rejects(async ()=>(await command('signal',signal(h.now))),{code:'INCIDENT_OPEN'}));
 assert.equal((await app.safetyMonitoring.view({...ctx,userId:driver.user.id})).alerts.length,0);
 (await assert.rejects(async ()=>(await app.safetyMonitoring.command({...ctx,userId:driver.user.id},'cancel',{alertId:saved.alerts[0].id,expectedVersion:0},randomUUID())),{code:'NOT_FOUND'}));
 assert.equal(JSON.stringify(saved).includes('9.087654'),false,'private packet is not exposed in status');
});
test('countdown sends minimal passenger, driver, vehicle and timestamped position only after deadline',async t=>{
 const {command,options,h,app,sent,ride,customer,driver}=await setup(t);
 (await command('preferences',options));(await command('signal',signal(h.now)));
 await app.safetyMonitoring.deliverPending();assert.equal(sent.length,0);
 h.advance(30_000);await app.safetyMonitoring.deliverPending();assert.equal(sent.length,2);
 const packet=sent[0].alert;assert.equal(packet.rideId,ride.id);assert.equal(packet.passenger.id,customer.user.id);assert.equal(packet.driver.id,driver.user.id);
 assert.equal(packet.driver.vehicle.plate,'TEST-DRIVER');assert.equal(packet.location.source,'reporter_device');assert.equal(packet.unverified,true);
 assert.equal(JSON.stringify(packet).includes('pickupPin'),false);assert.equal('phone' in packet.driver,false);
 await app.safetyMonitoring.deliverPending();assert.equal(sent.length,2);
 const statuses=(await command('preferences',{...options,enabled:false,expectedVersion:1})).alerts[0].deliveries;
 assert.ok(statuses.every(j=>j.status==='accepted'));
});
test('cancelling, changing contacts, ending a trip, logout and stale downtime prevent sending',async t=>{
 for(const mode of ['cancel','contact','trip','logout','stale','disable']){
  await t.test(mode,async t=>{
   const f=await setup(t);const {command,options,h,app,sent,customer,contact}=f;
   (await command('preferences',{...options,emergency:false}));const a=(await command('signal',signal(h.now))).alerts[0];
   if(mode==='cancel')(await command('cancel',{alertId:a.id,expectedVersion:a.version}));
   if(mode==='contact')await customer.post(`/api/safety/contacts/${contact.id}/remove`,{expectedVersion:0});
   if(mode==='trip')await f.step(customer,'cancel',{reason:'plans_changed'});
   if(mode==='logout')assert.equal((await customer.post('/api/auth/logout',{})).status,200);
   if(mode==='disable')(await command('preferences',{...options,enabled:false,expectedVersion:1}));
   h.advance(mode==='stale'?180_000:30_000);await app.safetyMonitoring.deliverPending();assert.equal(sent.length,0,mode);
  });
 }
});
test('unconfigured delivery stays unavailable even after configuring a provider later',async t=>{
 const f=await setup(t,{available:false});(await f.command('preferences',f.options));(await f.command('signal',signal(f.h.now)));
 f.h.advance(30_000);await f.app.safetyMonitoring.deliverPending();assert.equal(f.sent.length,0);
 const later=createApplication({db:f.h.db,clock:()=>f.h.now,safetyAlertProvider:{available:true,send:async()=>{throw new Error('must not send');}}});
 await later.safetyMonitoring.deliverPending();const a=(await later.safetyMonitoring.view(f.ctx)).alerts[0];assert.equal(a.deliveries[0].status,'unavailable');
});
test('delivery retries are bounded, reuse idempotency key and do not overlap workers',async t=>{
 const ids=[];const f=await setup(t,{send:async p=>{ids.push(p.idempotencyKey);throw new Error('timeout');}});
 (await f.command('preferences',{...f.options,emergency:false}));(await f.command('signal',signal(f.h.now)));f.h.advance(30_000);
 await Promise.all([((f.app.safetyMonitoring.deliverPending())),((f.app.safetyMonitoring.deliverPending()))]);assert.equal(ids.length,1);
 f.h.advance(10_000);await f.app.safetyMonitoring.deliverPending();f.h.advance(20_000);await f.app.safetyMonitoring.deliverPending();
 f.h.advance(30_000);await f.app.safetyMonitoring.deliverPending();assert.equal(ids.length,3);assert.equal(new Set(ids).size,1);
 assert.equal((await f.app.safetyMonitoring.view(f.ctx)).alerts[0].deliveries[0].status,'failed');
});
test('zone reports are private until reviewed, expire, enforce ownership and reject stale review',async t=>{
 const f=await setup(t),m=f.app.safetyMonitoring;const z={label:'Test junction',lat:9.087654,lng:7.412345,radiusM:300,note:'Fictional road hazard for testing'};
 (await m.reportZone(f.ctx,z,randomUUID()));assert.equal((await m.view(f.ctx)).warnings.length,0);
 (await assert.rejects(async ()=>(await m.zones(f.customer.user.id)),{code:'FORBIDDEN'}));const record=(await m.zones(f.admin.user.id)).zones[0];
 const data={status:'approved',note:'Fictional reviewed evidence',expiresAt:f.h.now+3600_000,expectedVersion:record.version};(await m.reviewZone(f.admin.user.id,record.id,data));
 (await assert.rejects(async ()=>(await m.reviewZone(f.admin.user.id,record.id,data)),{code:'STALE_VERSION'}));
 assert.equal(f.h.db.prepare("SELECT count(*) AS n FROM safety_risk_zones WHERE status='approved'").get().n,1);
});
test('web and native routes enforce authentication and never expose admin review on mobile',async t=>{
 const f=await setup(t),path=`/api/safety-monitoring/rides/${f.ride.id}`;
 assert.equal((await f.h.client().send(path)).status,401);
 const outsider=f.h.client();await outsider.register('outsider');assert.equal((await outsider.send(path)).status,404);
 assert.equal((await f.customer.post(path+'/preferences',{...f.options,emergency:false})).status,200);
 const login=await fetch(f.h.base+'/api/mobile/v1/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:f.customer.user.email,password:PASSWORD,deviceName:'Monitor test'})});
 const {credentials}=await login.json(),headers={Authorization:`Bearer ${credentials.accessToken}`};
 const r=await fetch(f.h.base+path.replace('/api/','/api/mobile/v1/'),{headers});assert.equal(r.status,200);assert.equal((await r.json()).viewerId,f.customer.user.id);
 assert.equal((await fetch(f.h.base+'/api/mobile/v1/admin/safety-zones',{headers})).status,404);
});
test('snapshots cannot revive monitoring or pending delivery',async t=>{
 const f=await setup(t,{persistent:true});(await f.command('preferences',f.options));(await f.command('signal',signal(f.h.now)));
 const dir=mkdtempSync(join(tmpdir(),'monitor-snapshot-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));
 const path=join(dir,'saved.sqlite');saveSnapshot(f.h.filename,path,{now:f.h.now});const db=openDatabase(path);
 try{assert.equal(db.prepare('SELECT enabled FROM safety_monitor_sessions').get().enabled,0);assert.equal(db.prepare('SELECT status FROM safety_auto_alerts').get().status,'cancelled');assert.ok(db.prepare('SELECT status FROM safety_delivery_jobs').all().every(j=>j.status==='cancelled'));}finally{db.close();}
});
test('gateway requires explicit HTTPS credentials, blocks redirects and validates acceptance receipt',async()=>{
 assert.equal(createSafetyAlertProvider().available,false);
 assert.throws(()=>createSafetyAlertProvider({env:{SAFETY_ALERT_GATEWAY_URL:'http://example.test',SAFETY_ALERT_GATEWAY_TOKEN:'a'.repeat(30)}}));
 const env={SAFETY_ALERT_GATEWAY_URL:'https://gateway.example.test/alerts',SAFETY_ALERT_GATEWAY_TOKEN:'a'.repeat(30)};
 let options;const p=createSafetyAlertProvider({env,fetchImpl:async(_,o)=>{options=o;return new Response(JSON.stringify({accepted:true,reference:'receipt-1'}));}});
 assert.deepEqual(await p.send({idempotencyKey:'abc'}),{reference:'receipt-1'});assert.equal(options.redirect,'error');assert.equal(options.headers['Idempotency-Key'],'abc');
 await assert.rejects(createSafetyAlertProvider({env,fetchImpl:async()=>new Response('{}')}).send({}));
});

test('independent safety workers share an atomic lease and stale acceptance cannot replace a newer result', async t => {
 let entered, finish, sends = 0;
 const ready = new Promise(resolve => { entered = resolve; });
 const send = async () => { sends += 1; if (sends === 1) { entered(); return new Promise(resolve => { finish = resolve; }); } return { reference: 'replacement-receipt' }; };
 const f = await setup(t, { send });
 await f.command('preferences', { ...f.options, emergency: false });
 await f.command('signal', signal(f.h.now)); f.h.advance(30_000);
 const replacement = createApplication({ db: f.h.db, clock: () => f.h.now, safetyAlertProvider: { available: true, send } });
 const original = f.app.safetyMonitoring.deliverPending(); await ready;
 await replacement.safetyMonitoring.deliverPending(); assert.equal(sends, 1);
 f.h.advance(30_000); await replacement.safetyMonitoring.deliverPending(); assert.equal(sends, 2);
 finish({ reference: 'stale-receipt' }); await original;
 const job = f.h.db.prepare('SELECT attempts,status,provider_reference FROM safety_delivery_jobs').get();
 assert.equal(job.attempts, 2); assert.equal(job.status, 'accepted'); assert.equal(job.provider_reference, 'replacement-receipt');
});
