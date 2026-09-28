import test from 'node:test';
import assert from 'node:assert/strict';
import { DEMO_AREAS, matchSampleArea, createDemoQuote, nairaToKobo } from '../src/demo-booking.mjs';

test('typed sample destinations resolve only complete listed area names', () => {
  assert.equal(matchSampleArea(DEMO_AREAS, '  mAiTaMa  ')?.id, 'maitama');
  assert.equal(matchSampleArea(DEMO_AREAS, 'Abuja   Airport')?.id, 'airport');
  assert.equal(matchSampleArea(DEMO_AREAS, 'Mai'), null);
  assert.equal(matchSampleArea(DEMO_AREAS, 'Lagos'), null);
});

test('the sample quote is explicitly fictional and uses integer kobo', () => {
  const quote = createDemoQuote('wuse-ii', 'maitama');
  assert.equal(quote.isDemo, true);
  assert.equal(quote.suggestedFareKobo, 450_000);
  assert.equal(quote.currency, 'NGN');
  assert.equal(quote.pickup.name, 'Wuse II');
  assert.equal(createDemoQuote('maitama', 'wuse-ii').suggestedFareKobo, quote.suggestedFareKobo);
});

test('unknown, missing or identical areas do not create a quote', () => {
  assert.throws(() => createDemoQuote('', 'maitama'));
  assert.throws(() => createDemoQuote('lagos', 'maitama'));
  assert.throws(() => createDemoQuote('wuse-ii', 'wuse-ii'));
});

test('naira entry preserves cents without floating-point rounding', () => {
  assert.equal(nairaToKobo('4500'), 450_000);
  assert.equal(nairaToKobo('4500.50'), 450_050);
  assert.equal(nairaToKobo(' 0.29 '), 29);
  assert.equal(nairaToKobo('1.1'), 110);
});

test('ambiguous, negative, overprecise and unsafe amounts cannot become fares', () => {
  for (const amount of ['0', '-1', '0.00', '1e3', '4,500', '1.001', 'NaN',
    'Infinity', '', ' ', '999999999999999999999999999', '<script>', 4500]) {
    assert.throws(() => nairaToKobo(amount));
  }
});
