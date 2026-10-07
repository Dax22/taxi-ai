import test from 'node:test';
import assert from 'node:assert/strict';
import { harness, participants, requestRide } from './helpers.mjs';

const restriction=(h,user,scope)=>({subjectType:'account',subjectId:user.id,scope,kind:'suspension',reasonCode:'conduct',
 reason:'Isolated capability-scope regression evidence.',notice:'Only the selected service activity is restricted.',caseReference:'TEST-SCOPED-OFFER',expiresAt:h.now+86400000,reviewAt:h.now+3600000,confirmation:'CONFIRM'});
const fixture=t=>harness(t,{dispatchConfig:{mode:'sequential'},mapProvider:{mode:'off',describe:()=>({enabled:false,mode:'off'})}});
async function offer(driver){const response=await driver.send('/api/rides?mode=work');assert.equal(response.status,200,JSON.stringify(response.body));assert.equal(response.body.available.length,1);return response.body.available[0];}

test('a customer-only restriction does not revoke that person\'s unrelated driver offer',async t=>{
 const h=await fixture(t),f=await participants(h,1);
 await requestRide(f.customer);const pending=await offer(f.driver);
 const result=await f.admin.post('/api/admin/console/restrictions',restriction(h,f.driver.user,'customer'));
 assert.equal(result.status,200,JSON.stringify(result.body));
 assert.equal(h.db.prepare('SELECT status FROM dispatch_offers WHERE id=?').get(pending.offer.id).status,'pending');
 const claimed=await f.driver.post('/api/rides/'+pending.id+'/claim',{expectedVersion:pending.version,offerId:pending.offer.id});
 assert.equal(claimed.status,200,JSON.stringify(claimed.body));assert.equal(claimed.body.ride.status,'negotiating');
});

test('a driver-only restriction preserves a driver\'s personal booking offer with another driver',async t=>{
 const h=await fixture(t),f=await participants(h,2,{online:false}),[booker,worker]=f.drivers;
 await requestRide(booker);await worker.online();const pending=await offer(worker);
 const result=await f.admin.post('/api/admin/console/restrictions',restriction(h,booker.user,'driver'));
 assert.equal(result.status,200,JSON.stringify(result.body));
 assert.equal(h.db.prepare('SELECT status FROM dispatch_offers WHERE id=?').get(pending.offer.id).status,'pending');
 const claimed=await worker.post('/api/rides/'+pending.id+'/claim',{expectedVersion:pending.version,offerId:pending.offer.id});
 assert.equal(claimed.status,200,JSON.stringify(claimed.body));assert.equal(claimed.body.ride.customer.id,booker.user.id);
});
