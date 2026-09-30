import test from 'node:test';
import assert from 'node:assert/strict';
import { readMatchingFastConfig } from '../src/infrastructure/matching-fast-config.mjs';

test('matching optimization rollout defaults off and can be limited to selected regions', () => {
  assert.equal(readMatchingFastConfig().includesRegion('ng:180:148'), false);
  const all = readMatchingFastConfig({ TAXI_AI_MATCHING_FAST_PATH: 'true' });
  assert.equal(all.includesRegion('ng:180:148'), true);
  assert.equal(all.includesRegion(null), true);
  const scoped = readMatchingFastConfig({ TAXI_AI_MATCHING_FAST_PATH: 'true', TAXI_AI_MATCHING_FAST_REGIONS: ' ng:180:148, sample:abuja-central ' });
  assert.equal(scoped.includesRegion('ng:180:148'), true);
  assert.equal(scoped.includesRegion('sample:abuja-central'), true);
  assert.equal(scoped.includesRegion('ng:181:148'), false);
  assert.equal(scoped.includesRegion(null), false);
  assert.equal(readMatchingFastConfig({ TAXI_AI_MATCHING_FAST_REGIONS: 'ng:180:148' }).includesRegion('ng:180:148'), false);
});

test('invalid matching rollout configuration fails closed at startup', () => {
  for (const value of ['1', 'yes', 'TRUE', '']) assert.throws(() => readMatchingFastConfig({ TAXI_AI_MATCHING_FAST_PATH: value }));
  for (const value of ['ng:1:2,ng:1:2', 'ng:1:2,', 'all', 'ng:1:2;DROP', Array.from({ length: 257 }, (_, i) => `ng:1:${i}`).join(',')]) {
    assert.throws(() => readMatchingFastConfig({ TAXI_AI_MATCHING_FAST_REGIONS: value }));
  }
});
