import test from 'node:test';
import assert from 'node:assert/strict';
import { harness, participants, requestRide } from './helpers.mjs';

const path='/api/admin/console/restrictions';
const input=(h,id,scope,expiresAt=h.now+86400000)=>({subjectType:'account',subjectId:id,scope,kind:'suspension',reasonCode:'conduct',
 reason:'A disposable moderation test with separate evidence.',notice:'New activity restricted for this test review.',caseReference:'TEST-DISPATCH',expiresAt,reviewAt:h.now+1000,confirmation:'CONFIRM'});
async function setup(t){
 const h=await harness(t,{dispatchConfig:{mode:'sequential'},mapProvider:{mode:'off',describe:()=>({enabled:false,mode:'off'})}});
 const f={h,...await participants(h,1)},ride=await requestRide(f.customer);
 const listed=await f.driver.send('/api/rides?mode=work');assert.equal(listed.status,200,JSON.stringify(listed.body));
 assert.equal(listed.body.available.length,1);return {...f,ride,offered:listed.body.available[0]};
}

test('driver suspension withdraws a pending dispatch offer and online availability in the same transaction',async t=>{
 const f=await setup(t),response=await f.admin.post(path,input(f.h,f.driver.user.id,'driver'));
 assert.equal(response.status,200,JSON.stringify(response.body));
 assert.equal(f.h.db.prepare('SELECT status FROM dispatch_offers WHERE id=?').get(f.offered.offer.id).status,'revoked');
 assert.equal((await f.driver.send('/api/availability')).body.availability,null);
 const claim=await f.driver.post('/api/rides/'+f.ride.id+'/claim',{expectedVersion:f.offered.version,offerId:f.offered.offer.id});
 assert.equal(claim.body.error.code,'ACCOUNT_RESTRICTED');
 assert.equal(f.h.db.prepare('SELECT status FROM drivers WHERE user_id=?').get(f.driver.user.id).status,'approved');
 assert.equal(f.h.db.prepare('SELECT status FROM rides WHERE id=?').get(f.ride.id).status,'requested');
});

test('customer suspension withdraws pending offers without inventing a cancellation or assigning another driver',async t=>{
 const f=await setup(t),response=await f.admin.post(path,input(f.h,f.customer.user.id,'customer'));
 assert.equal(response.status,200,JSON.stringify(response.body));
 assert.equal(f.h.db.prepare('SELECT status FROM dispatch_offers WHERE id=?').get(f.offered.offer.id).status,'revoked');
 assert.deepEqual((await f.driver.send('/api/rides?mode=work')).body.available,[]);
 assert.equal((await f.driver.post('/api/rides/'+f.ride.id+'/claim',{expectedVersion:f.offered.version,offerId:f.offered.offer.id})).body.error.code,'ACCOUNT_RESTRICTED');
 assert.equal(f.h.db.prepare('SELECT driver_id FROM rides WHERE id=?').get(f.ride.id).driver_id,null);
 assert.equal((await f.customer.post('/api/rides/'+f.ride.id+'/cancel',{expectedVersion:f.ride.version})).status,200);
});

test('an expired work restriction ceases enforcement without changing document approval or needing a cleanup job',async t=>{
 const h=await harness(t),f={h,...await participants(h,1)};
 assert.equal((await f.admin.post(path,input(h,f.driver.user.id,'driver',h.now+2000))).status,200);
 assert.equal((await f.driver.availability('/api/availability/online',{mode:'sample',areaId:'wuse-ii'})).body.error.code,'ACCOUNT_RESTRICTED');
 h.advance(3000);assert.equal((await f.driver.online()).online,true);
 assert.equal(h.db.prepare('SELECT status FROM drivers WHERE user_id=?').get(f.driver.user.id).status,'approved');
 assert.equal((await f.driver.send('/api/account/notices')).body.items[0].status,'expired');
});
