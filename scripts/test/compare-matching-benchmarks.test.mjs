import test from 'node:test';
import assert from 'node:assert/strict';
import { compareMatchingBenchmarks } from '../compare-matching-benchmarks.mjs';

const report = (fastPath, queryCount) => ({ passed: true, configuration: { fastPath, rate: 1 },
  database: 'fixture', providers: 'fixture', measurement: { journeys: { completed: 4, timeToAcceptedOfferMs: { p95: 1100 } } },
  processes: [{ role: 'worker', profiles: { queryCount, queryMs: 40, cycles: 2, retries: 0, durationMs: { p95: 50 } } }] });

test('comparison normalizes query work by completed journeys without averaging percentiles', () => {
  const before = report(false, 400), after = report(true, 100);
  after.processes.push({ role: 'worker', profiles: { queryCount: 100, queryMs: 20, cycles: 3, retries: 1, durationMs: { p95: 20 } } });
  const result = compareMatchingBenchmarks(before, after);
  assert.equal(result.workerQueryReductionPercent, 50);
  assert.equal(result.optimized.workerQueriesPerJourney, 50);
  assert.equal(result.optimized.worstWorkerCycleP95Ms, 50);
  assert.equal(result.optimized.transactionRetries, 1);
});

test('comparison rejects failed, mismatched, reversed or incomplete reports', () => {
  const before = report(false, 400);
  for (const mutate of [r => { r.passed = false; }, r => { r.configuration.rate = 2; },
    r => { r.configuration.fastPath = false; }, r => { r.measurement.journeys.completed = 3; },
    r => { delete r.processes[0].profiles.queryCount; }]) {
    const after = report(true, 100); mutate(after);
    assert.throws(() => compareMatchingBenchmarks(before, after));
  }
});
