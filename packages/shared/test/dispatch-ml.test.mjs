import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dispatchMlFeatures, scoreDispatchMl, validateDispatchMlArtifact } from '../src/dispatch-ml.mjs';
import { allocateDispatchOffers } from '../src/dispatch.mjs';

const artifact=JSON.parse(readFileSync(new URL('../models/bootstrap-shadow-v1.json',import.meta.url),'utf8'));
const now=1_000_000;
const edge=(driverId,rideId,age=0,eta=120,distance=1000)=>({driverId,rideId,createdAt:now-age,expiresAt:now+300_000-age,pickupEtaSeconds:eta,distanceMeters:distance});

test('bootstrap artifact is valid for shadow inference but explicitly refused for live authority',()=>{
  assert.equal(validateDispatchMlArtifact(artifact).version,'bootstrap-shadow-v1');
  assert.throws(()=>validateDispatchMlArtifact(artifact,{live:true}),/real-outcome-trained/);
});

test('feature extraction smooths new-driver history and model score is finite and bounded',()=>{
  const features=dispatchMlFeatures(edge('d','r'),{},now);
  assert.equal(features.driverAcceptanceRate,0.5);assert.equal(features.driverCompletionRate,0.5);
  const score=scoreDispatchMl(artifact,features);assert.equal(Number.isFinite(score),true);assert.ok(score>0&&score<1);
  const experienced=dispatchMlFeatures(edge('d','r'),{offers:100,accepted:80,completed:70},now);
  assert.ok(experienced.driverAcceptanceRate>features.driverAcceptanceRate);
});

test('custom ML candidate costs can change ranking but deterministic waiting priority remains a guard',()=>{
  const near=edge('near','ride',0,30,100), far=edge('far','ride',0,600,5000);
  assert.equal(allocateDispatchOffers([near,far],now)[0].driverId,'near');
  assert.equal(allocateDispatchOffers([near,far],now,{costForCandidate:c=>c.driverId==='far'?0:1000})[0].driverId,'far');
  const fresh=edge('fresh','same',0,30,100), waiting=edge('waiting','same',120_000,600,5000);
  const chosen=allocateDispatchOffers([fresh,waiting],now,{costForCandidate:c=>c.driverId==='fresh'?0:1_000_000_000});
  assert.equal(chosen[0].driverId,'waiting');
  assert.deepEqual(chosen[0].dispatch.reasons,['road_pickup_eta','waiting_priority']);
});

test('invalid learned cost fails safely to deterministic ranking',()=>{
  const near=edge('near','ride',0,30,100), far=edge('far','ride',0,600,5000);
  assert.equal(allocateDispatchOffers([near,far],now,{costForCandidate:()=>NaN})[0].driverId,'near');
  assert.throws(()=>allocateDispatchOffers([near],now,{costForCandidate:'bad'}),/function/);
});
