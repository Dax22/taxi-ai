import test from 'node:test';
import assert from 'node:assert/strict';
import { createDispatchService } from '../src/modules/dispatch/service.mjs';

const now=1_000_000,region='ng:181:148';
function fixture({live=false,recordFails=false}={}){
  const inserted=[],records=[];
  const base=(driverId,distance)=>({rideId:'ride',region,driverId,availabilityId:`a-${driverId}`,version:1,createdAt:now-10_000,
    expiresAt:now+200_000,distanceMeters:distance,pickupEtaSeconds:null,from:{lat:9.08,lng:7.4},to:{lat:9.09,lng:7.41}});
  const edges=[base('d1',100),base('d2',200)];
  const repository={pending:async()=>[],attempted:async()=>false,insert:async offer=>{inserted.push(offer);return true;},
    activeRegions:async()=>[region],close:async()=>true,find:async()=>null,forDriver:async()=>null};
  const ranker={enabled:true,mode:live?'live':'shadow',version:'model-v1',prefetch:async()=>new Map(),
    plan:()=>({modelVersion:'model-v1',costFor:c=>c.driverId==='d2'?0:1000}),liveFor:()=>live,
    record:async(...args)=>{records.push(args);if(recordFails)throw new Error('telemetry failed');},metrics:async()=>[]};
  let id=0;
  const service=createDispatchService({repository,candidates:async()=>edges,candidateFor:async(rideId,driverId)=>edges.find(e=>e.driverId===driverId),
    getAccount:async()=>({role:'driver'}),estimateMany:async pairs=>pairs.map((_,i)=>({source:'road',durationSeconds:i?200:100,estimatedAt:now})),
    unitOfWork:async run=>run(),tokens:{id:()=>`offer-${++id}`,digest:x=>x},audit:{record:async()=>{}},clock:()=>now,
    config:{mode:'sequential',batchWindowMs:0},ranker});
  return {service,inserted,records};
}

test('shadow ML compares rankings but deterministic dispatch remains authoritative',async()=>{
  const f=fixture();await f.service.refresh({region});
  assert.equal(f.inserted.length,1);assert.equal(f.inserted[0].driverId,'d1');assert.equal(f.inserted[0].policyVersion,'pickup-eta-wait-v1');
  assert.equal(f.records.length,1);assert.equal(f.records[0][2][0].driverId,'d1');assert.equal(f.records[0][3][0].driverId,'d2');
});

test('future live ML can control ranking but cannot bypass offer persistence safety',async()=>{
  const f=fixture({live:true});await f.service.refresh({region});
  assert.equal(f.inserted.length,1);assert.equal(f.inserted[0].driverId,'d2');assert.equal(f.inserted[0].policyVersion,'ml:model-v1');
});

test('ML decision-log failure never rolls back an already committed deterministic offer',async()=>{
  const f=fixture({recordFails:true});await f.service.refresh({region});
  assert.equal(f.inserted.length,1);assert.equal(f.inserted[0].driverId,'d1');assert.equal(f.records.length,1);
});
