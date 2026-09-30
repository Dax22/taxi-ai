import test from 'node:test';
import assert from 'node:assert/strict';
import { parseMatchingOptions, runArrivals, matchingGates } from '../matching-benchmark.mjs';

test('fixed arrivals expose saturation instead of waiting for a slow journey', async () => {
  let at = 0, finish, starts = 0;
  const pending = new Promise((resolve) => { finish = resolve; });
  const result = await runArrivals({ rate: 2, seconds: 2, capacity: 1, now: () => at,
    wait: async (ms) => { at += ms; if (at >= 2000) finish(); }, admit: () => { starts++; return pending; } });
  assert.equal(starts, 1); assert.equal(result.scheduled, 4); assert.equal(result.started, 1);
  assert.equal(result.dropped, 3); assert.equal(result.peakInFlight, 1); assert.equal(result.late, 0);
});

test('generator lateness is reported rather than replayed as an artificial burst', async () => {
  let at = 0;
  const result = await runArrivals({ rate: 2, seconds: 2, capacity: 10, now: () => at,
    wait: async (ms) => { at += ms + 600; }, admit: () => assert.fail('missed arrivals must not be backfilled') });
  assert.equal(result.late, 4); assert.equal(result.dropped, 4);
});

test('benchmark rejects external targets and resource limits, and incomplete work fails its gates', () => {
  for (const args of [['--url', 'https://live.example'], ['--rate', '21'], ['--actors', '201'], ['--workers', '0'],
    ['--duration-seconds', '301'], ['--idle-accounts', '1000001'], ['--pool-size', '30']]) assert.throws(() => parseMatchingOptions(args));
  const measurement = { arrivals: { scheduled: 10, dropped: 1 }, errorRate: 0, operationErrors: {},
    journeys: { completed: 9, timeToAcceptedOfferMs: { p95: 12000 } } };
  const gates = matchingGates(measurement, [], parseMatchingOptions([]));
  assert.equal(gates.noDroppedArrivals, false); assert.equal(gates.allJourneysComplete, false);
  assert.equal(gates.matchLatency, false); assert.equal(gates.workerProfilesPresent, false);
});

test('benchmark records the selected matching path and rejects ambiguous switches', () => {
  assert.equal(parseMatchingOptions([]).fastPath, false);
  assert.equal(parseMatchingOptions(['--fast-path', 'true']).fastPath, true);
  assert.equal(parseMatchingOptions(['--fast-path', 'false']).fastPath, false);
  assert.throws(() => parseMatchingOptions(['--fast-path', '1']));
  const gate = matchingGates({ arrivals: { dropped: 0, scheduled: 1 }, errorRate: 0, operationErrors: {},
    journeys: { completed: 1, timeToAcceptedOfferMs: { p95: 1 } } },
  [{ role: 'worker', profiles: { failed: 1, overflow: 0, phases: { commit: { count: 1 } } } }], parseMatchingOptions([]));
  assert.equal(gate.workerHealthy, false);
});
