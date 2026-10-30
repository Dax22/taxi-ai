import test from 'node:test';
import assert from 'node:assert/strict';
import { allocateFastMatching } from '../src/dispatch-fast-matching.mjs';
import { allocateDispatchOffers } from '../src/dispatch.mjs';
const now=1_800_000_000;
let seed=1701;
const random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};
const make=(d,r,n)=>{
 const pairs=new Set(),edges=[];
 for(let i=0;i<n;i++){
  const driver=Math.floor(random()*d),ride=Math.floor(random()*r),key=driver+':'+ride;
  if(pairs.has(key))continue;
  pairs.add(key);
  edges.push({driverId:'d'+driver,rideId:'r'+ride,cost:Math.floor(random()*30000)-10000});
 }
 return edges;
};
function bruteForce(edges,drivers,rides){
 let optimum={count:0,cost:Infinity};
 function visit(d,used,count,cost){
  if(d===drivers){
   if(count>optimum.count||count===optimum.count&&cost<optimum.cost)optimum={count,cost};
   return;
  }
  visit(d+1,used,count,cost);
  for(const e of edges.filter(x=>x.driverId==='d'+d&&!used.has(x.rideId)))
   visit(d+1,new Set([...used,e.rideId]),count+1,cost+e.cost);
 }
 visit(0,new Set(),0,0);return optimum;
}
test('fast solver matches exhaustive maximum-cardinality minimum-cost oracle on 500 small graphs',()=>{
 for(let i=0;i<500;i++){
  const edges=make(3,3,1+Math.floor(random()*9)),result=allocateFastMatching(edges);
  const expected=bruteForce(edges,3,3);
  assert.equal(result.length,expected.count,'graph '+i);
  assert.equal(result.reduce((s,e)=>s+e.cost,0),expected.cost,'graph '+i);
 }
});
test('fast solver is bounded, deterministic and does not mutate input',()=>{
 const edges=make(32,32,512),before=structuredClone(edges);
 const result=allocateFastMatching(edges);
 assert.equal(new Set(result.map(x=>x.driverId)).size,result.length);
 assert.equal(new Set(result.map(x=>x.rideId)).size,result.length);
 assert.deepEqual(allocateFastMatching(edges),result);
 assert.deepEqual(edges,before);
 assert.throws(()=>allocateFastMatching(new Array(513).fill(edges[0])),/Graph too large/);
});
test('new live dispatch batch path preserves legacy maximum coverage and total pickup cost',()=>{
 for(let iteration=0;iteration<100;iteration++){
  const candidates=make(16,16,160).map(x=>({
   driverId:x.driverId,rideId:x.rideId,pickupEtaSeconds:50+(x.cost+10000),
   distanceMeters:1500,createdAt:now,expiresAt:now+300000,
  }));
  const fast=allocateDispatchOffers(candidates,now,{mode:'batch',solver:'fast'});
  const legacy=allocateDispatchOffers(candidates,now,{mode:'batch',solver:'legacy'});
  assert.equal(fast.length,legacy.length,'cardinality '+iteration);
  assert.equal(fast.reduce((s,e)=>s+e.pickupEtaSeconds,0),
   legacy.reduce((s,e)=>s+e.pickupEtaSeconds,0),'pickup cost '+iteration);
  assert.equal(new Set(fast.map(x=>x.driverId)).size,fast.length);
  assert.equal(new Set(fast.map(x=>x.rideId)).size,fast.length);
 }
});
test('unknown solver names fail closed',()=>{
 assert.throws(()=>allocateDispatchOffers([],now,{mode:'batch',solver:'untested'}),/solver/);
});
