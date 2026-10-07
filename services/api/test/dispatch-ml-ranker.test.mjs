import test from 'node:test';
import assert from 'node:assert/strict';
import { readDispatchMlConfig } from '../src/infrastructure/dispatch-ml-config.mjs';
import { loadDispatchMlArtifact } from '../src/infrastructure/dispatch-ml-artifact.mjs';
import { createDispatchMlRanker } from '../src/modules/dispatch/ml-ranker.mjs';
import { allocateDispatchOffers } from '../../../packages/shared/src/dispatch.mjs';

const now=1_000_000, region='ng:181:148';
const candidates=[
  {driverId:'d1',rideId:'r1',region,availabilityId:'a1',version:1,createdAt:now-20_000,expiresAt:now+200_000,distanceMeters:1000,pickupEtaSeconds:120,estimatedAt:now},
  {driverId:'d2',rideId:'r1',region,availabilityId:'a2',version:1,createdAt:now-20_000,expiresAt:now+200_000,distanceMeters:2500,pickupEtaSeconds:180,estimatedAt:now},
];

test('shadow ranker scores bounded features and records control/model comparison without controlling live offers',async()=>{
  const config=readDispatchMlConfig({TAXI_AI_ML_RANKING_MODE:'shadow',TAXI_AI_ML_RANKING_REGIONS:region});
  const recorded=[];let next=0;
  const repository={driverStats:async()=>[{driverId:'d1',offers:20,accepted:5,declined:10,expired:5,completed:4},{driverId:'d2',offers:20,accepted:18,declined:1,expired:1,completed:17}],
    record:async rows=>recorded.push(...rows),sweep:async()=>0};
  const ranker=createDispatchMlRanker({config,model:loadDispatchMlArtifact(config),repository,tokens:{id:()=>`id-${++next}`},clock:()=>now});
  const history=await ranker.prefetch(candidates,now,region),plan=ranker.plan(candidates,now,region,history);
  assert.ok(plan);assert.equal(ranker.liveFor(region),false);assert.equal(plan.scores.size,2);
  const control=allocateDispatchOffers(candidates,now),model=allocateDispatchOffers(candidates,now,{costForCandidate:plan.costFor});
  await ranker.record(plan,candidates,control,model,[{...control[0],id:'offer-1'}],now);
  assert.equal(recorded.length,2);assert.equal(recorded.every(row=>row.rolloutMode==='shadow'&&row.modelVersion==='bootstrap-shadow-v1'),true);
  assert.equal(recorded.filter(row=>row.selectedActual===1).length,1);
  assert.equal(recorded.every(row=>!row.featuresJson.includes('ng:181:148')),true,'feature payload omits geographic identifiers');
});

test('ranker is inert outside its rollout region and retention sweep is hourly bounded',async()=>{
  const config=readDispatchMlConfig({TAXI_AI_ML_RANKING_MODE:'shadow',TAXI_AI_ML_RANKING_REGIONS:region});let sweeps=0;
  const ranker=createDispatchMlRanker({config,model:loadDispatchMlArtifact(config),repository:{driverStats:async()=>[],record:async()=>{},sweep:async()=>{sweeps++;return 2;}},tokens:{id:()=> 'x'},clock:()=>now});
  assert.equal(await ranker.prefetch(candidates,now,'ng:182:148'),null);
  assert.deepEqual(await ranker.sweep(),{deleted:2});assert.deepEqual(await ranker.sweep(),{deleted:0});assert.equal(sweeps,1);
});
