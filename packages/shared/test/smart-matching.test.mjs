import test from 'node:test';
import assert from 'node:assert/strict';
import { MATCH_RANKING_POLICY, rankEligibleMatches, validMatchRecommendation } from '../src/smart-matching.mjs';

const now = 1_000_000;
const candidate = (id, distanceMeters, age = 0) => ({ id, distanceMeters, createdAt: now - age, expiresAt: now + 300_000 - age });

test('proximity wins at equal wait and older requests can outrank moderately closer new requests', () => {
  assert.equal(MATCH_RANKING_POLICY.proximityWeight + MATCH_RANKING_POLICY.waitingWeight, 1);
  assert.deepEqual(rankEligibleMatches([candidate('far', 4000), candidate('near', 1000)], now).map((c) => c.id), ['near', 'far']);
  assert.deepEqual(rankEligibleMatches([candidate('new-close', 100), candidate('waiting', 1200, 180_000)], now).map((c) => c.id), ['waiting', 'new-close']);
  assert.deepEqual(rankEligibleMatches([candidate('old-far', 9500, 290_000), candidate('new-close', 100)], now).map((c) => c.id), ['new-close', 'old-far']);
});

test('sample matching remains FIFO with stable identity ties and does not imply GPS distance', () => {
  const input = [candidate('b', null, 20_000), candidate('new', null), candidate('a', null, 20_000)];
  const before = structuredClone(input);
  const ranked = rankEligibleMatches(input, now);
  assert.deepEqual(ranked.map((c) => c.id), ['a', 'b', 'new']);
  assert.deepEqual(ranked.map((c) => c.recommendation.rank), [1, 2, 3]);
  assert.deepEqual(ranked[0].recommendation.reasons, ['sample_area']);
  assert.deepEqual(input, before, 'ranking does not mutate repository candidates');
  assert.deepEqual(rankEligibleMatches(input.toReversed(), now), ranked);
});

test('expired, future-created and invalid distance candidates cannot gain ranking priority', () => {
  const good = candidate('valid', 1000);
  const invalid = [candidate('expired', 0, 300_000), candidate('future', 0, -1), candidate('negative', -1),
    candidate('nan', NaN), candidate('infinite', Infinity), candidate('outside', 10001), { ...good, id: 'missing', distanceMeters: undefined }];
  assert.deepEqual(rankEligibleMatches([...invalid, good], now).map((c) => c.id), ['valid']);
  assert.throws(() => rankEligibleMatches([good], NaN), /server time/);
});

test('recommendations explain threshold boundaries without publishing a numeric score or ETA', () => {
  const ranked = rankEligibleMatches([candidate('near', 2000, 60_000), candidate('far', 2001, 59_999)], now);
  assert.deepEqual(ranked[0].recommendation.reasons, ['nearby_pickup', 'waiting_longer']);
  assert.deepEqual(ranked[1].recommendation.reasons, ['within_search_area']);
  for (const c of ranked) {
    assert.equal(validMatchRecommendation(c.recommendation), true);
    assert.deepEqual(Object.keys(c.recommendation).sort(), ['policyVersion', 'rank', 'reasons']);
    assert.equal(Object.hasOwn(c, 'score'), false);
  }
  for (const value of [null, {}, { ...ranked[0].recommendation, rank: 0 }, { ...ranked[0].recommendation, rank: 51 },
    { ...ranked[0].recommendation, policyVersion: 'invented-ai' }, { ...ranked[0].recommendation, reasons: ['guaranteed_arrival'] }]) {
    assert.equal(validMatchRecommendation(value), false);
  }
});

test('fares, passenger identity and unvalidated profile claims have no effect on matching priority', () => {
  const a = candidate('a', 1000, 10_000), b = candidate('b', 1000, 10_000);
  const ranked = rankEligibleMatches([{ ...b, fare: 999999, premium: true, rating: 5 }, { ...a, fare: 1, rating: 1 }], now);
  assert.deepEqual(ranked.map((c) => c.id), ['a', 'b']);
});
