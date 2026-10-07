import test from 'node:test';import assert from 'node:assert/strict';
import {createAdminMatchingService} from '../src/modules/admin-matching/service.mjs';
const now=2_000_000_000;
test('matching intelligence aggregates operational evidence and keeps model artifact server-side',async()=>{
 let permission=null;
 const repository={
  journeySummary:async()=>({requests:10,matched:8,completed:6,cancelled:2,expired:1}),
  journeyTimings:async()=>[{createdAt:now-130000,matchedAt:now-10000,completedAt:now},{createdAt:now-30000,matchedAt:now-20000,completedAt:null}],
  offers:async()=>[{status:'accepted',etaSource:'road',count:6},{status:'declined',etaSource:'road',count:2},{status:'expired',etaSource:'distance_fallback',count:2}],
  profiles:async()=>[{queryCount:50,queryMs:20,durationMs:100,retries:1,queryErrors:0,failed:0},{queryCount:70,queryMs:30,durationMs:120,retries:0,queryErrors:0,failed:0}],
  mlCohorts:async()=>[{modelVersion:'bootstrap-shadow-v1',rolloutMode:'shadow',candidates:20,actualOffers:4,differingCandidateSelections:4,meanScore:.5}],
  mlComparisonSummary:async()=>({comparisons:4,disagreements:2}),trainingRows:async()=>({count:1400}),
  comparisons:async()=>[{region:'ng:181:148',modelVersion:'bootstrap-shadow-v1',rolloutMode:'shadow',createdAt:now,controlScore:.4,modelScore:.8,controlModelRank:2,modelDeterministicRank:2,disagreed:1,actualWasControl:1}],
  mlOutcomes:async()=>[{status:'accepted',count:4,completed:3}],
 };
 const artifact={approval:{trainedOnRealOutcomes:false,approvedForLive:false,trainingRows:0}};
 const service=createAdminMatchingService({repository,requirePermission:async(id,p)=>{permission=[id,p];},clock:()=>now,unitOfWork:run=>run(),configuration:()=>({fastEnabled:true,fastRegions:['ng:181:148'],dispatchMode:'sequential',mlMode:'shadow',mlModel:'bootstrap-shadow-v1',mlRegions:['ng:181:148'],mlLive:false,modelArtifact:artifact})});
 const result=await service.get({id:'staff'}, {window:'7d'});
 assert.deepEqual(permission,['staff','operations.read']);assert.equal(result.journeys.matchSeconds.p95,120);assert.equal(result.offers.acceptanceRate,.6);
 assert.equal(result.ml.disagreementRate,.5);assert.equal(result.ml.readiness.dataReady,false);assert.equal(result.ml.readiness.minimumOutcomes,1500);
 assert.equal(Object.hasOwn(result.rollout,'modelArtifact'),false);assert.equal(JSON.stringify(result).includes('trainedOnRealOutcomes'),true);
 assert.equal(result.waitCohorts.atLeast120.requests,1);assert.equal(result.waitCohorts.under60.requests,1);
});
