import test from 'node:test';
import assert from 'node:assert/strict';
import {createDeliveryEtaProvider} from '../src/infrastructure/delivery-eta.mjs';
const from={lat:9.08,lng:7.4},to={lat:9.085,lng:7.405},pair={from,to};
const road=(a=from,b=to)=>({durationSeconds:601.2,distanceMeters:1200,coordinates:[[a.lng,a.lat],[b.lng,b.lat]]});

test('delivery ETA reuses validated parcel road durations including nationwide routes',async()=>{
  const adapter=createDeliveryEtaProvider({mapProvider:{route:()=>assert.fail('saved route must not call upstream')}});
  assert.deepEqual(await adapter.estimate({...pair,source:'osrm',durationSeconds:25_200}),{durationSeconds:25_200,source:'road',trafficAware:false});
  assert.deepEqual(await adapter.estimate({...pair,source:'osrm',durationSeconds:172800}),{durationSeconds:172800,source:'road',trafficAware:false});
});

test('delivery ETA uses actual road geometry and shares bounded cached concurrent requests',async()=>{
  let calls=0,complete,now=1000;
  const adapter=createDeliveryEtaProvider({now:()=>now,mapProvider:{route:async(a,b)=>{calls++;assert.deepEqual(a,from);assert.deepEqual(b,to);return new Promise(resolve=>{complete=resolve;});}}});
  const first=adapter.estimate(pair),second=adapter.estimate(pair);await Promise.resolve();complete(road());
  const estimate=await first;assert.deepEqual(estimate,{durationSeconds:602,source:'road',trafficAware:false});assert.deepEqual(await second,estimate);
  estimate.durationSeconds=1;now+=29_999;assert.equal((await adapter.estimate(pair)).durationSeconds,602);assert.equal(calls,1);
});

test('unavailable maps, malformed or straight-line routes never fabricate a delivery ETA',async()=>{
  for(const provider of [undefined,{mode:'off',route:()=>assert.fail('maps off')},{route:async()=>{throw Error('failed');}}]) assert.equal(await createDeliveryEtaProvider({mapProvider:provider}).estimate(pair),null);
  for(const value of [{...road(),source:'direct'},{...road(),distanceKind:'straight_line'},{...road(),coordinates:null},
    {...road(),coordinates:[[7.4,9.08],[0,0]]},{...road(),durationSeconds:0},{...road(),durationSeconds:172801},
    {...road(),distanceMeters:1},{...road(),distanceMeters:2500001},{...road(),durationSeconds:1}]) {
    assert.equal(await createDeliveryEtaProvider({mapProvider:{route:async()=>value}}).estimate(pair),null);
  }
  assert.equal(await createDeliveryEtaProvider().estimate({from:{lat:91,lng:7},to}),null);
});

test('delivery routing timeout keeps the upstream concurrency slot and never queues unlimited work',async()=>{
  let complete,calls=0;
  const adapter=createDeliveryEtaProvider({timeoutMs:10,maxConcurrent:1,mapProvider:{route:async()=>{calls++;return new Promise(resolve=>{complete=resolve;});}}});
  const pending=adapter.estimate(pair);assert.equal(await adapter.estimate({from:to,to:from}),null);assert.equal(await pending,null);
  assert.equal(await adapter.estimate({from:to,to:from}),null);assert.equal(calls,1);complete(road());
});
