import test from 'node:test';
import assert from 'node:assert/strict';
import { readDispatchMlConfig } from '../src/infrastructure/dispatch-ml-config.mjs';
import { loadDispatchMlArtifact } from '../src/infrastructure/dispatch-ml-artifact.mjs';
import { createDispatchMlRanker } from '../src/modules/dispatch/ml-ranker.mjs';

test('ML ranking defaults off and shadow can be region-limited',()=>{
  assert.equal(readDispatchMlConfig({}).mode,'off');
  const config=readDispatchMlConfig({TAXI_AI_ML_RANKING_MODE:'shadow',TAXI_AI_ML_RANKING_REGIONS:'ng:181:148'});
  assert.equal(config.includesRegion('ng:181:148'),true);assert.equal(config.includesRegion('ng:182:148'),false);
  assert.equal(loadDispatchMlArtifact(config).version,'bootstrap-shadow-v1');
});

test('live ranking fails closed without both deployment approval and an approved trained artifact',()=>{
  assert.throws(()=>readDispatchMlConfig({TAXI_AI_ML_RANKING_MODE:'live'}),/LIVE_ENABLED/);
  const config=readDispatchMlConfig({TAXI_AI_ML_RANKING_MODE:'live',TAXI_AI_ML_RANKING_LIVE_ENABLED:'true'});
  const model=loadDispatchMlArtifact(config);
  assert.throws(()=>createDispatchMlRanker({config,model,repository:{},tokens:{},clock:Date.now}),/real-outcome-trained/);
  for(const regions of ['bad','ng:181:148,ng:181:148']) assert.throws(()=>readDispatchMlConfig({TAXI_AI_ML_RANKING_MODE:'shadow',TAXI_AI_ML_RANKING_REGIONS:regions}));
});
