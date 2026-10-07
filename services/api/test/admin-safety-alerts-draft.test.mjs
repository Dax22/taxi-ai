import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import { createAdminSafetyAlertsService } from '../src/modules/admin-safety-alerts/service.mjs';
import { filters, position, signal, nextReview } from '../src/modules/admin-safety-alerts/domain.mjs';

const id = n => `00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
function fixture() {
  let now = 1_000_000, permission = true, status = 'in_progress', locationReads = 0;
  let row = { id: id(1), rideId: id(2), ownerId: id(3), kind: 'impact', status: 'finished', createdAt: now, dueAt: now + 30_000,
    reviewState: 'open', reviewVersion: 0, assigneeId: null, reviewedAt: null,
    signalJson: JSON.stringify({ peakG: 5, capturedAt: now, private: 'do-not-return' }),
    snapshotJson: JSON.stringify({ customer: { id:id(3),name:'Booking customer' }, passenger:{ kind:'guest',name:'Guest passenger' },
      driver:{id:id(4),name:'Driver',vehicle:{model:'Test car',plate:'TEST-1',secret:'do-not-return'}}, reporter:{id:id(3),name:'Reporter'},
      pickup:'Pickup fixture',destination:'Destination fixture',recordedAt:now,isTest:true,
      location:{lat:9.08,lng:7.4,accuracy:10,capturedAt:now,source:'reporter_device'} }) };
  let events = []; const audit = [];
  const accounts = new Map([[id(3),{id:id(3),name:'Current booking customer',email:'booker@example.test'}],[id(4),{id:id(4),name:'Current driver',email:'driver@example.test'}]]);
  const r = {
    list: async () => [structuredClone(row)], find: async key => key === row.id ? structuredClone(row) : null,
    jobs: async () => [{id:id(10),status:'accepted',attempts:1}], events: async () => structuredClone(events),
    command: async (actor,key) => { const e=events.find(e=>e.actorId===actor&&e.key===key);return e?{alertId:e.alertId,fingerprint:e.fingerprint}:null; },
    save: async v => {if(row.reviewVersion!==v.expectedVersion)return false;row={...row,reviewState:v.state,reviewVersion:row.reviewVersion+1,assigneeId:v.assigneeId,reviewedAt:v.now};return true;},
    append: async e => {events.push({...e,createdAt:e.now});},
  };
  const s = createAdminSafetyAlertsService({ repository:r,
    requirePermission:async (user,p)=>{if(!permission||![id(6),id(7)].includes(user)||p!=='cases.safety')throw Object.assign(new Error('Forbidden'),{code:'FORBIDDEN'});},
    getAccount:async user=>accounts.get(user)||null,getTrip:async()=>({customerId:id(3),driverId:id(4),status}),
    getPassenger:async()=>({kind:'guest',name:'Guest passenger',phone:'+2348000000000',consent:true}),
    locationForTrip:async()=>{locationReads++;return {lat:9.1,lng:7.5,accuracy:12,capturedAt:now,source:'driver_shared'};},
    mapSettings:()=>({enabled:false,tiles:null}),providerReadiness:()=>({liveAcceptanceVerified:false}),
    unitOfWork:async run=>{const old=structuredClone(row),before=structuredClone(events);try{return await run();}catch(e){row=old;events=before;throw e;}},
    tokens:{id:randomUUID,digest:v=>createHash('sha256').update(v).digest('hex')},audit:{record:async(...args)=>audit.push(args)},clock:()=>now });
  return {s,r,audit,get row(){return row;},get events(){return events;},get locationReads(){return locationReads;},
    advance:ms=>{now+=ms;},end:()=>{status='completed';},revoke:()=>{permission=false;},
    legacy:()=>{const v=JSON.parse(row.snapshotJson);delete v.customer;delete v.isTest;row.snapshotJson=JSON.stringify(v);}};
}
const action = (f,name,version,key=randomUUID()) => f.s.command({userId:id(6),id:id(1),data:{action:name,expectedVersion:version,note:'Synthetic staff review only'},key});

test('draft denies passenger, driver and non-safety accounts for lists, detail and review',async()=>{
 const f=fixture();for(const user of [id(3),id(4),id(8)]){
  await assert.rejects(f.s.list(user,{}),{code:'FORBIDDEN'});
  await assert.rejects(f.s.get(user,id(1)),{code:'FORBIDDEN'});
  await assert.rejects(f.s.command({userId:user,id:id(1),data:{action:'acknowledge',expectedVersion:0,note:'Test note'},key:randomUUID()}),{code:'FORBIDDEN'});
 }assert.equal(f.audit.length,0);
});
test('draft separates guest passenger, booking customer and driver; contact and precise GPS stay off list',async()=>{
 const f=fixture(),list=await f.s.list(id(6),{}),detail=await f.s.get(id(6),id(1));
 assert.equal(detail.passenger.name,'Guest passenger');assert.equal(detail.customer.name,'Booking customer');
 assert.equal(detail.customer.contact.email,'booker@example.test');assert.equal(detail.passenger.phone,'+2348000000000');
 assert.equal(detail.driver.contact.phone,null);assert.equal(detail.incidentPosition.source,'reporter_device');
 for(const value of ['booker@example.test','+2348000000000','9.08','do-not-return'])assert.equal(JSON.stringify(list).includes(value),false);
 assert.equal(JSON.stringify(detail).includes('do-not-return'),false);assert.equal(f.audit.length,2);
});
test('draft historical position never silently becomes live; active position requires explicit audited request',async()=>{
 const f=fixture();await f.s.get(id(6),id(1));assert.equal(f.locationReads,0);
 const live=await f.s.get(id(6),id(1),{live:'1'});assert.equal(live.currentPosition.lat,9.1);assert.equal(live.incidentPosition.lat,9.08);
 f.end();const ended=await f.s.get(id(6),id(1),{live:'1'});assert.equal(ended.currentPosition,null);assert.equal(f.locationReads,1);
 f.advance(30_001);assert.equal((await f.s.get(id(6),id(1))).incidentPosition.stale,true);
});
test('draft notification processing finished and provider acceptance do not mean resolved or delivered',async()=>{
 const detail=await fixture().s.get(id(7),id(1));assert.equal(detail.alert.transportStatus,'finished');
 assert.equal(detail.alert.review.state,'open');assert.equal(detail.deliveries[0].deliveredToPerson,false);assert.equal(detail.alert.verifiedIncident,false);
});
test('draft legacy snapshot uses booking record rather than reporter and leaves test classification unknown',async()=>{
 const f=fixture();f.legacy();const d=await f.s.get(id(6),id(1));assert.equal(d.customer.id,id(3));assert.equal(d.alert.isTest,null);
});
test('draft repeated acknowledgement is idempotent and stale staff changes are rejected',async()=>{
 const f=fixture(),key=randomUUID();await action(f,'acknowledge',0,key);const retry=await action(f,'acknowledge',0,key);
 assert.equal(retry.replayed,true);assert.equal(f.events.length,1);assert.equal(f.row.status,'finished');
 await assert.rejects(action(f,'acknowledge',0),{code:'STALE_VERSION'});
 await assert.rejects(action(f,'note',1,key),{code:'KEY_REUSED'});
});
test('draft requires acknowledgement before resolution and records reopening without changing notification state',async()=>{
 const f=fixture();await assert.rejects(action(f,'resolve',0),{code:'INVALID_INPUT'});
 await action(f,'acknowledge',0);await action(f,'false_alarm',1);await action(f,'reopen',2);
 assert.equal(f.row.reviewState,'open');assert.equal(f.row.assigneeId,null);assert.equal(f.row.status,'finished');
});
test('draft role revocation rejects an existing review and future precise-location reads',async()=>{
 const f=fixture();await f.s.get(id(6),id(1));f.revoke();await assert.rejects(f.s.get(id(6),id(1),{live:'1'}),{code:'FORBIDDEN'});
 await assert.rejects(action(f,'acknowledge',0),{code:'FORBIDDEN'});assert.equal(f.locationReads,0);
});
test('draft event persistence failure rolls back review version',async()=>{
 const f=fixture();f.r.append=async()=>{throw new Error('Test persistence failure');};await assert.rejects(action(f,'acknowledge',0));assert.equal(f.row.reviewVersion,0);
});
test('draft filters and projections reject invalid input instead of inventing a position',()=>{
 assert.equal(filters({}).state,'active');assert.throws(()=>filters({state:'dispatch_police'}));assert.throws(()=>filters({before:'garbage'}));
 assert.equal(position({lat:91,lng:1,accuracy:1,capturedAt:0},100),null);assert.deepEqual(signal({secret:1,levelDb:-6},'distress'),{levelDb:-6});
 assert.throws(()=>nextReview('resolved','acknowledge'));
});
