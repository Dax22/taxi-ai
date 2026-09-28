import test from 'node:test';
import assert from 'node:assert/strict';
import { parseOptions, validateLoadPostgresUrl, distribution, createMeasurements, runLoad } from '../load-test.mjs';

test('load runner rejects external targets, unbounded traffic, and rates above write budgets', () => {
  for (const args of [['--url', 'https://example.com'], ['--database', '/data/live.sqlite'], ['--concurrency', '201'],
    ['--duration-seconds', '301'], ['--warmup-seconds', '-1'], ['--scenario', 'journey', '--think-ms', '100'],
    ['--scenario', 'heartbeat', '--think-ms', '100'], ['--output']]) {
    assert.throws(() => parseOptions(args));
  }
  assert.equal(parseOptions([]).concurrency, 5);
  assert.equal(parseOptions(['--scenario', 'read', '--think-ms', '100']).thinkMs, 100);
});

test('PostgreSQL load tests reject live database names, remote hosts and connection overrides', () => {
  for (const url of ['postgresql://localhost/taxi_ai', 'postgresql://db.example.com/taxi_ai_load',
    'postgresql://localhost/taxi_ai_test?host=live.example.com', 'https://localhost/taxi_ai_load', 'invalid']) {
    assert.throws(() => validateLoadPostgresUrl(url));
  }
  assert.equal(validateLoadPostgresUrl('postgresql://localhost/taxi_ai_load'), 'postgresql://localhost/taxi_ai_load');
});

test('benchmark reports percentiles, HTTP failures, status counts and completed journeys separately', () => {
  assert.deepEqual(distribution([]), { count: 0, p50: null, p95: null, p99: null, max: null });
  assert.deepEqual(distribution([100, 1, 3, 2]), { count: 4, p50: 2, p95: 100, p99: 100, max: 100 });
  const metrics = createMeasurements();
  metrics.record('work', 200, 1); metrics.record('claim', 409, 9); metrics.record('claim', 0, 100);
  metrics.fail('OFFER_UNAVAILABLE'); metrics.created(); metrics.matched(50); metrics.completed();
  const result = metrics.summary(1000);
  assert.equal(result.throughputRequestsPerSecond, 3); assert.equal(result.failedRequests, 2);
  assert.deepEqual(result.statuses, { 0: 1, 200: 1, 409: 1 }); assert.equal(result.journeys.completed, 1);
  assert.equal(result.operationErrors.OFFER_UNAVAILABLE, 1); assert.equal(result.operations.claim.count, 2);
});

test('isolated benchmark authenticates synthetic drivers and completes fare/PIN journeys over HTTP', { timeout: 60000 }, async () => {
  const result = await runLoad(parseOptions(['--concurrency', '2', '--duration-seconds', '1', '--warmup-seconds', '0']));
  assert.equal(result.database, 'disposable SQLite');
  assert.equal(result.measurement.failedRequests, 0, JSON.stringify(result.measurement.operationErrors));
  assert.deepEqual(result.measurement.operationErrors, {});
  assert.equal(result.measurement.journeys.created, 2); assert.equal(result.measurement.journeys.completed, 2);
  assert.equal(result.measurement.journeys.pickupEstimateSources.road, 2);
  assert.equal(result.measurement.operations.driver_heartbeat.count, 2);
  assert.equal(result.measurement.operations.ride_start.count, 2);
  assert.equal(result.measurement.operations.ride_complete.count, 2);
  assert.ok(result.serverEventLoopLagMs.p99 > 0);
  const text = JSON.stringify(result);
  for (const forbidden of ['taxi_ai_session', 'csrf', 'pickupPin', '@example.test']) assert.ok(!text.includes(forbidden));
});
