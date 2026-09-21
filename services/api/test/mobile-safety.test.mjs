import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { harness, participants, requestRide, claimRide, PASSWORD } from './helpers.mjs';
const ok=r=>{assert.equal(r.status,200,JSON.stringify(r.body));return r.body;};
async function native(h,path,token,data,key=randomUUID()){
 const response=await fetch(h.base+'/api/mobile/v1'+path,{method:data===undefined?'GET':'POST',headers:{'Content-Type':'application/json','Idempotency-Key':key,...(token?{Authorization:`Bearer ${token}`}:{})},...(data===undefined?{}:{body:JSON.stringify(data)})});return{status:response.status,body:await response.json()};
}
const phone=async(h,actor)=>ok(await native(h,'/auth/login',null,{email:actor.user.email,password:PASSWORD,deviceName:'Safety fixture'})).credentials;
async function setup(t){const h=await harness(t),a=await participants(h);let ride=await claimRide(a.driver,await requestRide(a.customer));
 for(const [who,action,extra] of [[a.driver,'offers',{amountKobo:470000}],[a.customer,'accept',null],[a.customer,'confirm',{}]])ride=ok(await who.post(`/api/rides/${ride.id}/${action}`,{expectedVersion:ride.version,...(extra??{offerId:ride.negotiation.currentOffer.id})})).ride;
 return{h,...a,ride};}
test('native contacts support versioned editing, ownership, duplicate checks and idempotent retry',async(t)=>{
 const {h,customer,driver}=await setup(t),c=await phone(h,customer),d=await phone(h,driver);
 let contact=ok(await native(h,'/safety/contacts',c.accessToken,{name:'Friend',phone:'+2348000000001'})).contact;
 const key=randomUUID(),data={name:'Updated friend',phone:'+2348000000002',expectedVersion:contact.version};
 assert.equal((await native(h,`/safety/contacts/${contact.id}/edit`,d.accessToken,data)).status,404);
 contact=ok(await native(h,`/safety/contacts/${contact.id}/edit`,c.accessToken,data,key)).contact;
 assert.equal(contact.version,1);assert.equal(contact.phone,data.phone);
 assert.equal(ok(await native(h,`/safety/contacts/${contact.id}/edit`,c.accessToken,data,key)).replayed,true);
 assert.equal((await native(h,`/safety/contacts/${contact.id}/edit`,c.accessToken,data)).body.error.code,'STALE_VERSION');
 assert.equal(ok(await customer.send('/api/safety/contacts')).contacts[0].name,'Updated friend');
 ok(await native(h,`/safety/contacts/${contact.id}/remove`,c.accessToken,{expectedVersion:1}));
 assert.deepEqual(ok(await native(h,'/safety/contacts',c.accessToken)).contacts,[]);
});
test('native share survives token rotation, is private and one-time, and ends on device revocation',async(t)=>{
 const {h,customer,driver,ride}=await setup(t);let c=await phone(h,customer);const d=await phone(h,driver);
 const path=`/safety/rides/${ride.id}/links`,key=randomUUID(),data={minutes:15,expectedShareId:null};
 const created=ok(await native(h,path,c.accessToken,data,key));assert.match(created.token,/^[a-f0-9]{64}$/);
 assert.equal(ok(await native(h,path,c.accessToken,data,key)).token,null);
 assert.equal(ok(await native(h,`/safety/rides/${ride.id}`,d.accessToken)).share,null);
 assert.equal((await native(h,`/safety/links/${created.share.id}/revoke`,d.accessToken,{expectedVersion:0})).status,404);
 const view=()=>h.client().post('/api/trip-share/view',{token:created.token});assert.equal((await view()).status,200);
 c=ok(await native(h,'/auth/refresh',null,{refreshToken:c.refreshToken})).credentials;assert.equal((await view()).status,200);
 ok(await native(h,`/devices/${c.sessionId}/revoke`,c.accessToken,{}));assert.equal((await view()).status,404);
});
test('both participants can save own incidents, view review status, and revoke own links without notifications',async(t)=>{
 const {h,customer,driver,admin,ride}=await setup(t),c=await phone(h,customer),d=await phone(h,driver);
 for(const actor of [c,d]){
  const incident=ok(await native(h,`/safety/rides/${ride.id}/incidents`,actor.accessToken,{kind:'unsafe_behaviour',note:'Test concern',contactIds:[]})).incident;
  assert.deepEqual(incident.notifications,[]);assert.equal(incident.snapshot,undefined);
  const own=ok(await native(h,`/safety/rides/${ride.id}`,actor.accessToken));assert.equal(own.incidents.length,1);assert.equal(own.location,null);
  ok(await admin.post(`/api/admin/safety/${incident.id}/review`,{expectedVersion:0,decision:'acknowledge',note:'Test review recorded'}));
  assert.equal(ok(await native(h,`/safety/rides/${ride.id}`,actor.accessToken)).incidents[0].status,'acknowledged');
  const link=ok(await native(h,`/safety/rides/${ride.id}/links`,actor.accessToken,{minutes:15,expectedShareId:null}));
  ok(await native(h,`/safety/links/${link.share.id}/revoke`,actor.accessToken,{expectedVersion:0}));
  assert.equal((await h.client().post('/api/trip-share/view',{token:link.token})).status,404);
 }
 const stranger=h.client();await stranger.register('outsider','customer');const other=await phone(h,stranger);
 assert.notEqual((await native(h,`/safety/rides/${ride.id}`,other.accessToken)).status,200);
 assert.equal((await native(h,'/safety/contacts')).status,401);
 assert.equal((await native(h,'/safety/admin/review',c.accessToken,{})).status,404);
});
test('native links expire, sign out and close with the trip; incidents stay readable',async(t)=>{
 const {h,customer,driver,ride}=await setup(t);let c=await phone(h,customer);
 const create=()=>native(h,`/safety/rides/${ride.id}/links`,c.accessToken,{minutes:15,expectedShareId:null});
 const view=token=>h.client().post('/api/trip-share/view',{token});
 let link=ok(await create());h.advance(15*60_000);assert.equal((await view(link.token)).status,404);
 c=await phone(h,customer);link=ok(await create());ok(await native(h,'/auth/logout',null,{refreshToken:c.refreshToken}));assert.equal((await view(link.token)).status,404);
 c=await phone(h,customer);link=ok(await create());
 ok(await customer.post(`/api/rides/${ride.id}/cancel`,{expectedVersion:ride.version,reason:'plans_changed'}));assert.equal((await view(link.token)).status,404);
 assert.equal(ok(await native(h,`/safety/rides/${ride.id}`,c.accessToken)).canRaise,false);
});
test('editing a contact prevents retrying an old recipient snapshot after a simulated send fails',async(t)=>{
 const {h,customer,admin,ride}=await setup(t),c=await phone(h,customer);
 const contact=ok(await native(h,'/safety/contacts',c.accessToken,{name:'Friend',phone:'+2348000000001'})).contact;
 const incident=ok(await customer.post(`/api/safety/rides/${ride.id}/incidents`,{kind:'need_help',note:'Test',contactIds:[contact.id]})).incident;
 let n=incident.notifications[0];const simulate=async outcome=>{const r=await admin.post(`/api/admin/safety-notifications/${n.id}/simulate`,{expectedVersion:n.version,outcome});if(r.status===200)n=r.body.incident.notifications[0];return r;};
 ok(await simulate('sent'));ok(await native(h,`/safety/contacts/${contact.id}/edit`,c.accessToken,{expectedVersion:0,name:'Friend',phone:'+2348000000002'}));
 ok(await simulate('failed'));assert.equal((await simulate('retry')).status,409);
});
