import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { harness, participants, requestRide, PASSWORD } from './helpers.mjs';
import { filters, csv, summarize } from '../src/modules/admin-transactions/domain.mjs';

const base='/api/admin/console';
const must=(result,status=200)=>{assert.equal(result.status,status,JSON.stringify(result.body));return result.body;};
async function setup(t) {
 const h=await harness(t), f={h,...await participants(h,0)};
 const seller=h.client();await seller.register('command-kitchen');
 let store=must(await seller.post('/api/eats/stores',{details:{name:'Test kitchen',cuisine:'Nigerian',description:'Fictional meals only',address:'10 Fictional Road',areaId:'wuse-ii',deliveryAreaIds:['wuse-ii','maitama'],prepMinutes:25,minimumKobo:100000,deliveryFeeKobo:100000}})).store;
 store=must(await seller.post(`/api/eats/stores/${store.id}/menu`,{expectedVersion:store.version,itemId:null,item:{name:'Jollof rice',description:'Test meal',category:'Meals',priceKobo:250000,available:true}})).store;
 const menu=must(await seller.send('/api/eats/store')).menu;
 store=must(await f.admin.post(`/api/eats/stores/${store.id}/review`,{expectedVersion:store.version,decision:'approved',reason:'Fictional reviewed test store',reference:'TEST-ONLY'})).store;
 store=must(await seller.post(`/api/eats/stores/${store.id}/open`,{expectedVersion:store.version,isOpen:true})).store;
 const quote=must(await f.customer.post('/api/eats/quotes',{storeId:store.id,expectedVersion:store.version,items:[{itemId:menu[0].id,quantity:2}],address:{line:'20 Fictional Close',areaId:'maitama'},instructions:'Test only'})).quote;
 const order=must(await f.customer.post('/api/eats/orders',{quoteId:quote.id})).order;
 return {...f,seller,store,order};
}
test('unified directory includes rides and food with full-cohort totals, stable paging and auditable safe exports',async t=>{
 const f=await setup(t),ride=await requestRide(f.customer);
 const first=must(await f.admin.send(base+'/transactions?limit=1'));
 assert.equal(first.items.length,1);assert.equal(first.summary.total,2);assert.ok(first.nextBefore);
 const second=must(await f.admin.send(base+'/transactions?limit=1&before='+first.nextBefore));
 assert.equal(second.items.length,1);assert.equal(second.summary.total,2);assert.notEqual(first.items[0].id,second.items[0].id);
 assert.equal(second.nextBefore,null);
 const food=must(await f.admin.send(base+'/transactions/food/'+f.order.id));
 assert.equal(food.item.customer.id,f.customer.user.id);assert.equal(food.contents[0].name,'Jollof rice');assert.equal(food.item.amountKobo,String(f.order.totals.totalKobo));
 assert.ok(!JSON.stringify(food).includes('pickupPin'));assert.ok(!JSON.stringify(food).includes('deliveryPin'));
 const detail=must(await f.admin.send(base+'/transactions/ride/'+ride.id));assert.equal(detail.recipient.kind,'self');
 const exported=must(await f.admin.send(base+'/transactions-export'));
 assert.equal(exported.rowCount,2);assert.equal(exported.truncated,false);assert.ok(exported.csv.includes('payment_mode'));
 assert.equal(f.h.db.prepare("SELECT count(*) AS n FROM admin_access_events WHERE action='transactions.export'").get().n,1);
 for(const suffix of ['service=unknown','service=food&service=ride','limit=1000','before=wrong','from=2026-02-30&to=2026-03-01']) assert.equal((await f.admin.send(base+'/transactions?'+suffix)).status,400,suffix);
});
test('people and businesses link cross-service histories without exposing private kitchen coordinates or passwords',async t=>{
 const f=await setup(t);
 const people=must(await f.admin.send(base+'/people'));assert.ok(people.items.every(p=>!p.email.includes('command-kitchen@')));
 const person=must(await f.admin.send(base+'/people/'+f.customer.user.id));assert.equal(person.lifetime.total,1);assert.equal(person.account.email,f.customer.user.email);
 const business=must(await f.admin.send(base+'/businesses/'+f.store.id));assert.equal(business.transactions.summary.total,1);assert.equal(business.menu.length,1);
 const serialized=JSON.stringify(business);for(const key of ['dispatchPoint','10 Fictional Road','password_hash','collectionPoint'])assert.ok(!serialized.includes(key),key);
});
test('staff roles, MFA boundary and unauthenticated requests cannot bypass new reporting permissions',async t=>{
 const f=await setup(t);
 for(const path of ['/transactions','/people','/businesses','/transactions-export']){
  assert.equal((await f.h.client().send(base+path)).status,401);assert.equal((await f.customer.send(base+path)).status,403);
 }
 const staff=f.h.client();await staff.register('command-finance');
 must(await f.admin.post(base+'/staff/assign',{email:staff.user.email,role:'finance',expectedVersion:0,reason:'Fixture finance role only'}));
 must(await staff.post(base+'/login',{email:staff.user.email,password:PASSWORD}));
 for(const path of ['/transactions','/people','/businesses','/transactions-export'])assert.equal((await staff.send(base+path)).status,403,path);
 const support=f.h.client();await support.register('command-support');
 must(await f.admin.post(base+'/staff/assign',{email:support.user.email,role:'support',expectedVersion:0,reason:'Fixture support role only'}));must(await support.post(base+'/login',{email:support.user.email,password:PASSWORD}));
 assert.equal((await support.send(base+'/transactions')).status,200);assert.equal((await support.send(base+'/transactions-export')).status,403);
 assert.equal((await support.send(base+'/live/food/'+f.order.id+'?purpose=delivery_support')).status,403);
 const location=must(await f.admin.send(base+'/live/food/'+f.order.id+'?purpose=delivery_support'));
 assert.equal(location.position,null);assert.equal(location.historyAvailable,false);
 assert.equal((await f.admin.send(base+'/live/food/'+f.order.id)).status,400);
});
test('CSV guards formula cells and exact money grouping does not silently mix test and live totals',async()=>{
 const rows=[{service:'food',paymentMode:'test',status:'delivered',amountKobo:'9007199254740991'}, {service:'ride',paymentMode:'live',status:'completed',amountKobo:'10'}, {service:'ride',paymentMode:'live',status:'requested',amountKobo:null}];
 const result=await summarize(rows);assert.equal(result.total,3);assert.equal(result.groups[0].amountKobo,'9007199254740991');assert.equal(result.groups[1].unknownAmounts,1);
 const text=csv([{id:randomUUID(),service:'food',status:'placed',createdAt:0,customer:{name:'=1+1'},amountKobo:'123',paymentMode:'test'}]);assert.ok(text.includes("'=1+1"));
 assert.throws(()=>filters({accountId:'invalid'},Date.now()));
});

const restrictionFor=(f,person,scope='customer',extra={})=>({subjectType:'account',subjectId:person.user.id,scope,kind:'suspension',reasonCode:'conduct',reason:'Internal test evidence not for public disclosure',notice:'New service activity is restricted pending review.',caseReference:'CASE-TEST-ONLY',expiresAt:f.h.now+86400000,reviewAt:f.h.now+3600000,confirmation:'CONFIRM',...extra});
const restrictionPath='/api/admin/console/restrictions';
test('staff restrictions prevent new customer work and expose only the public notice to its owner',async t=>{
 const f=await setup(t),data=restrictionFor(f,f.customer);
 const restriction=must(await f.admin.post(restrictionPath,data)).restriction;
 const denied=await f.customer.post('/api/rides',{pickupId:'wuse-ii',destinationId:'maitama'});
 assert.equal(denied.status,409,JSON.stringify(denied.body));assert.equal(denied.body.error.code,'ACCOUNT_RESTRICTED');
 const own=must(await f.customer.send('/api/account/notices'));
 assert.equal(own.items[0].id,restriction.id);
 for(const text of ['Internal test evidence','createdBy','privateReason','CASE-TEST-ONLY'])assert.ok(!JSON.stringify(own).includes(text));
 assert.equal((await f.seller.send('/api/account/notices/'+restriction.id)).status,404);
 assert.equal((await f.customer.send('/api/rides/history')).status,200);
 const restored=must(await f.admin.post(restrictionPath+'/'+restriction.id+'/lift',{expectedVersion:restriction.version,reason:'Test review completed and issue resolved',confirmation:'REINSTATE'}));
 assert.equal(restored.restriction.status,'lifted');
 assert.equal((await f.customer.post('/api/rides',{pickupId:'wuse-ii',destinationId:'maitama'})).status,201);
});

test('store suspension removes discovery and new ordering without silently cancelling existing food orders',async t=>{
 const f=await setup(t),r=must(await f.admin.post(restrictionPath,restrictionFor(f,f.seller,'store',{subjectType:'store',subjectId:f.store.id}))).restriction;
 const catalog=must(await f.customer.send('/api/eats/restaurants?areaId=wuse-ii'));
 assert.ok(!catalog.restaurants.some(s=>s.id===f.store.id));
 const menu=must(await f.seller.send('/api/eats/store')).menu;
 const quoted=await f.customer.post('/api/eats/quotes',{storeId:f.store.id,expectedVersion:f.store.version,items:[{itemId:menu[0].id,quantity:1}],address:{line:'Another fictional close',areaId:'maitama'},instructions:'Test only'});
 assert.equal(quoted.body.error.code,'STORE_RESTRICTED');
 assert.equal((await f.seller.post('/api/eats/stores/'+f.store.id+'/open',{expectedVersion:f.store.version,isOpen:true})).body.error.code,'STORE_RESTRICTED');
 const accepted=must(await f.seller.post('/api/eats/orders/'+f.order.id+'/accept',{expectedVersion:f.order.version})).order;
 assert.equal(accepted.status,'accepted');
 assert.equal((await f.seller.send('/api/account/notices/'+r.id)).status,200);
 assert.equal((await f.customer.send('/api/account/notices/'+r.id)).status,404);
});
test('moderation roles cannot self-suspend, modify owners or exceed their capability scopes',async t=>{
 const f=await setup(t);
 assert.equal((await f.admin.post(restrictionPath,restrictionFor(f,f.admin))).status,403);
 const ops=f.h.client();await ops.register('moderation-ops');
 must(await f.admin.post(base+'/staff/assign',{email:ops.user.email,role:'operations',expectedVersion:0,reason:'Test operations role'}));
 must(await ops.post(base+'/login',{email:ops.user.email,password:PASSWORD}));
 assert.equal((await ops.post(restrictionPath,restrictionFor(f,f.customer))).status,404);
 assert.equal((await f.customer.post(restrictionPath,restrictionFor(f,f.seller))).status,403);
 assert.equal((await ops.post(restrictionPath,restrictionFor(f,f.admin,'account'))).status,404);
});

test('appeals are idempotent and overturning lifts only the reviewed restriction',async t=>{
 const f=await setup(t),r=must(await f.admin.post(restrictionPath,restrictionFor(f,f.customer))).restriction;
 const key=randomUUID(),payload={body:'Please reconsider the restriction using the linked test evidence.'};
 const appeal=must(await f.customer.post('/api/account/notices/'+r.id+'/appeal',payload,key));
 assert.equal(appeal.appeal.status,'submitted');
 assert.equal(must(await f.customer.post('/api/account/notices/'+r.id+'/appeal',payload,key)).replayed,true);
 assert.equal((await f.customer.post('/api/account/notices/'+r.id+'/appeal',payload)).body.error.code,'APPEAL_EXISTS');
 const outcome=must(await f.admin.post(restrictionPath+'/'+r.id+'/appeal-decision',{expectedVersion:1,restrictionVersion:r.version,decision:'overturned',note:'Test review determined that reinstatement is appropriate.'}));
 assert.equal(outcome.restriction.status,'lifted');assert.equal(outcome.appeal.status,'overturned');
 assert.equal((await f.customer.post('/api/rides',{pickupId:'wuse-ii',destinationId:'maitama'})).status,201);
});
test('warning and expiry semantics preserve retry identity and never silently renew an expired suspension',async t=>{
 const f=await setup(t),key=randomUUID(),payload=restrictionFor(f,f.customer,'customer',{expiresAt:f.h.now+2000,reviewAt:f.h.now+1000});
 const row=must(await f.admin.post(restrictionPath,payload,key)).restriction;f.h.advance(3000);
 assert.equal(must(await f.admin.post(restrictionPath,payload,key)).replayed,true);
 assert.equal(must(await f.customer.send('/api/account/notices')).items[0].status,'expired');
 const next=must(await f.admin.post(restrictionPath,restrictionFor(f,f.customer))).restriction;
 assert.equal(f.h.db.prepare('SELECT status FROM account_restrictions WHERE id=?').get(row.id).status,'expired');
 assert.equal((await f.admin.post(restrictionPath+'/'+next.id+'/lift',{expectedVersion:0,reason:'Valid test reinstatement reason',confirmation:'REINSTATE'})).status,409);
 must(await f.admin.post(restrictionPath+'/'+next.id+'/lift',{expectedVersion:next.version,reason:'Review completed and test issue resolved',confirmation:'REINSTATE'}));
 must(await f.admin.post(restrictionPath,restrictionFor(f,f.customer,'customer',{kind:'warning'})));
 assert.equal((await f.customer.post('/api/rides',{pickupId:'wuse-ii',destinationId:'maitama'})).status,201);
});

test('scoped driver restriction stops new availability but leaves an already-booked journey safe to complete',async t=>{
 const h=await harness(t),f={h,...await participants(h,1)};
 let ride=await requestRide(f.customer);
 ride=must(await f.driver.post(`/api/rides/${ride.id}/claim`,{expectedVersion:ride.version})).ride;
 ride=must(await f.driver.post(`/api/rides/${ride.id}/offers`,{expectedVersion:ride.version,amountKobo:470000})).ride;
 ride=must(await f.customer.post(`/api/rides/${ride.id}/accept`,{expectedVersion:ride.version,offerId:ride.negotiation.currentOffer.id})).ride;
 ride=must(await f.customer.post(`/api/rides/${ride.id}/confirm`,{expectedVersion:ride.version})).ride;
 const pin=ride.trip.pickupPin;
 const full=await f.admin.post(restrictionPath,restrictionFor(f,f.driver,'account'));
 assert.equal(full.body.error.code,'ACTIVE_WORK_REVIEW_REQUIRED');
 must(await f.admin.post(restrictionPath,restrictionFor(f,f.driver,'driver')));
 assert.equal((await f.driver.availability('/api/availability/online',{mode:'sample',areaId:'wuse-ii'})).body.error.code,'ACCOUNT_RESTRICTED');
 for(const action of ['depart','arrive','start','complete']){
  if(action!=='complete')await f.driver.shareTripLocation(ride.id);
  ride=must(await f.driver.post(`/api/rides/${ride.id}/${action}`,{expectedVersion:ride.version,...(action==='start'?{pickupPin:pin}:{})})).ride;
 }
 assert.equal(ride.status,'completed');
 const customerUse=await f.driver.post('/api/rides',{pickupId:'wuse-ii',destinationId:'maitama'});
 assert.equal(customerUse.status,201,JSON.stringify(customerUse.body));
});
test('a persistence failure rolls moderation and withdrawn availability back together',async t=>{
 const h=await harness(t),f={h,...await participants(h,1)},key=randomUUID(),data=restrictionFor(f,f.driver,'driver');
 h.db.exec("CREATE TRIGGER fail_moderation_test BEFORE INSERT ON admin_command_keys BEGIN SELECT RAISE(ABORT, 'test-only failure'); END");
 assert.equal((await f.admin.post(restrictionPath,data,key)).status,500);
 assert.equal(h.db.prepare('SELECT COUNT(*) AS n FROM account_restrictions').get().n,0);
 assert.equal(must(await f.driver.send('/api/availability')).availability.online,true);
 h.db.exec('DROP TRIGGER fail_moderation_test');
 const applied=must(await f.admin.post(restrictionPath,data,key));assert.equal(applied.replayed,false);
 assert.equal(must(await f.driver.send('/api/availability')).availability,null);
});

test('operational reviews are versioned, assigned by permission and never mutate their linked delivery',async t=>{
 const f=await setup(t),key=randomUUID(),payload={entityType:'food',entityId:f.order.id,kind:'return_review',title:'Review this test delivery',description:'Fictional item requires an operational review.',priority:'high'};
 let result=must(await f.admin.post(base+'/work',payload,key)),item=result.item;
 assert.equal(item.status,'open');f.h.advance(1000);
 assert.equal(must(await f.admin.post(base+'/work',payload,key)).replayed,true);
 result=must(await f.admin.post(base+'/work/'+item.id,{expectedVersion:item.version,action:'assign',assigneeId:f.admin.user.id,note:'Assigned to test owner for review.'}));item=result.item;
 result=must(await f.admin.post(base+'/work/'+item.id,{expectedVersion:item.version,action:'status',status:'resolved',note:'The operational review is resolved; original delivery was not changed.'}));
 assert.equal(result.item.status,'resolved');assert.equal(result.events.length,3);
 assert.equal(must(await f.customer.send('/api/eats/orders/'+f.order.id)).order.status,'placed');
 assert.equal((await f.admin.post(base+'/work/'+item.id,{expectedVersion:item.version,action:'note',note:'An outdated update must fail.'})).body.error.code,'STALE_VERSION');
 assert.equal((await f.customer.send(base+'/work')).status,403);
 const finance=f.h.client();await finance.register('review-finance');
 must(await f.admin.post(base+'/staff/assign',{email:finance.user.email,role:'finance',expectedVersion:0,reason:'Test finance workflow'}));
 must(await finance.post(base+'/login',{email:finance.user.email,password:PASSWORD}));
 assert.equal(must(await finance.send(base+'/work')).category,'finance');
 assert.equal((await finance.send(base+'/work/'+item.id)).status,403);
 assert.equal((await finance.post(base+'/work',payload)).status,403);
});
test('saved reports, campaign plans and evidence briefing have explicit non-execution boundaries',async t=>{
 const f=await setup(t),key=randomUUID(),data={title:'Food orders this period',service:'food',status:'all',from:'',to:''};
 const saved=must(await f.admin.post(base+'/reports',data,key));
 assert.equal(must(await f.admin.post(base+'/reports',data,key)).replayed,true);
 const reports=must(await f.admin.send(base+'/reports'));assert.equal(reports.items.length,1);assert.equal(reports.scheduledDeliveryAvailable,false);
 const draft=must(await f.admin.post(base+'/campaigns',{title:'Future food promotion',service:'food',budgetKobo:100000,discountKobo:1000,note:'Planning draft only, no customer redemptions.'}));
 const campaigns=must(await f.admin.send(base+'/campaigns'));assert.equal(campaigns.items[0].status,'draft');assert.equal(campaigns.redemptionAvailable,false);
 must(await f.admin.post(base+'/campaigns/'+draft.id+'/archive',{expectedVersion:1}));
 must(await f.admin.post(base+'/reports/'+saved.id+'/remove',{expectedVersion:1}));
 assert.equal(must(await f.admin.send(base+'/reports')).items.length,0);
 const health=must(await f.admin.send(base+'/platform'));assert.equal(health.database.reachable,true);assert.equal(health.lastPhoneCallTest,null);
 const brief=must(await f.admin.send(base+'/brief'));assert.equal(brief.observations.activeFoodOrders,1);assert.ok(brief.method.includes('Deterministic'));
 const summary=must(await f.admin.send(base+'/insights'));assert.equal(summary.summary.total,1);assert.ok(!JSON.stringify(summary).includes(f.customer.user.id));
});

test('inactive all-services restriction revokes old sessions but preserves access to notices after a fresh login',async t=>{
 const h=await harness(t),f={h,...await participants(h,0)};
 const response=await fetch(h.base+'/api/mobile/v1/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:f.customer.user.email,password:PASSWORD,deviceName:'Disposable test phone'})});
 const native=await response.json();assert.equal(response.status,200);
 const restriction=must(await f.admin.post(restrictionPath,restrictionFor(f,f.customer,'account'))).restriction;
 assert.equal(must(await f.customer.send('/api/session')).user,null);
 const old=await fetch(h.base+'/api/mobile/v1/session',{headers:{Authorization:'Bearer '+native.credentials.accessToken}});assert.equal(old.status,401);
 must(await f.customer.post('/api/auth/login',{email:'customer@example.test',password:PASSWORD}));
 assert.equal(must(await f.customer.send('/api/account/notices')).items[0].id,restriction.id);
 assert.equal((await f.customer.post('/api/rides',{pickupId:'wuse-ii',destinationId:'maitama'})).body.error.code,'ACCOUNT_RESTRICTED');
});
test('native bookings and notice reads enforce the same effective account restriction as the website',async t=>{
 const h=await harness(t),f={h,...await participants(h,0)},restriction=must(await f.admin.post(restrictionPath,restrictionFor(f,f.customer))).restriction;
 const login=await fetch(h.base+'/api/mobile/v1/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:f.customer.user.email,password:PASSWORD,deviceName:'Test notices phone'})});
 const native=await login.json();assert.equal(login.status,200);
 const headers={Authorization:'Bearer '+native.credentials.accessToken,'Content-Type':'application/json','Idempotency-Key':randomUUID()};
 const notices=await fetch(h.base+'/api/mobile/v1/account/notices',{headers});assert.equal(notices.status,200);assert.equal((await notices.json()).items[0].id,restriction.id);
 const booking=await fetch(h.base+'/api/mobile/v1/booking/requests',{method:'POST',headers,body:JSON.stringify({pickupId:'wuse-ii',destinationId:'maitama'})});
 assert.equal(booking.status,409);assert.equal((await booking.json()).error.code,'ACCOUNT_RESTRICTED');
 const unauthorized=await fetch(h.base+'/api/mobile/v1/admin/console/restrictions',{headers});assert.equal(unauthorized.status,404);
});


test('customer, worker, vendor, payment and area filters remain scoped and full-cohort summaries are not page totals',async t=>{
 const f=await setup(t),ride=await requestRide(f.customer);await requestRide(f.seller);
 const byCustomer=must(await f.admin.send(base+'/transactions?customerId='+f.customer.user.id+'&limit=1'));
 assert.equal(byCustomer.items.length,1);assert.equal(byCustomer.summary.total,2);
 assert.equal(must(await f.admin.send(base+'/transactions?workerId='+f.customer.user.id)).summary.total,0);
 const vendor=must(await f.admin.send(base+'/transactions?accountId='+f.seller.user.id+'&participation=vendor'));
 assert.equal(vendor.summary.total,1);assert.equal(vendor.items[0].id,f.order.id);
 assert.equal(must(await f.admin.send(base+'/transactions?accountId='+f.seller.user.id+'&participation=customer')).summary.total,1);
 assert.equal(must(await f.admin.send(base+'/transactions?service=food&paymentMode=test&paymentStatus=not_charged&area=maitama')).summary.total,1);
 assert.equal(must(await f.admin.send(base+'/transactions?paymentMode=live')).summary.total,0);
 const person=must(await f.admin.send(base+'/people/'+f.seller.user.id));
 assert.equal(person.participation.customer.total,1);assert.equal(person.participation.vendor.total,1);assert.equal(person.participation.worker.total,0);
 const vendors=must(await f.admin.send(base+'/people?type=vendor'));assert.deepEqual(vendors.items.map(p=>p.id),[f.seller.user.id]);
 for(const query of ['participation=worker','participation=bad','paymentStatus=invalid','paymentMode=invalid','vehicleCategory=invalid','customerId=bad','workerId=bad'])assert.equal((await f.admin.send(base+'/transactions?'+query)).status,400,query);
 assert.equal((await f.admin.send(base+'/people?type=unknown')).status,400);
 assert.equal(must(await f.admin.send(base+'/transactions/ride/'+ride.id)).deliveryState,null);
});

test('staff cannot reinstate their own store or adjudicate their own appeal through the admin API',async t=>{
 const f=await setup(t);
 must(await f.admin.post(base+'/staff/assign',{email:f.seller.user.email,role:'operations',expectedVersion:0,reason:'Separate operating role in this test'}));
 must(await f.seller.post(base+'/login',{email:f.seller.user.email,password:PASSWORD}));
 const r=must(await f.admin.post(restrictionPath,restrictionFor(f,f.seller,'store',{subjectType:'store',subjectId:f.store.id}))).restriction;
 const lift={expectedVersion:r.version,reason:'Own-store restriction must need an independent reviewer',confirmation:'REINSTATE'};
 assert.equal((await f.seller.post(restrictionPath+'/'+r.id+'/lift',lift)).status,403);
 must(await f.seller.post('/api/account/notices/'+r.id+'/appeal',{body:'Please review my store restriction and the supporting evidence.'}));
 const decision={expectedVersion:1,restrictionVersion:r.version,decision:'overturned',note:'An independent member must decide this appeal.'};
 assert.equal((await f.seller.post(restrictionPath+'/'+r.id+'/appeal-decision',decision)).status,403);
 const still=must(await f.admin.send(restrictionPath+'/'+r.id));assert.equal(still.restriction.status,'active');assert.equal(still.appeal.status,'submitted');
 assert.equal(must(await f.admin.post(restrictionPath+'/'+r.id+'/appeal-decision',decision)).restriction.status,'lifted');
});
