import { fork } from 'node:child_process';
import { once } from 'node:events';
import { writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { monitorEventLoopDelay } from 'node:perf_hooks';
import { setTimeout as delay } from 'node:timers/promises';
import { requireNativePostgres } from './postgres-test-server.mjs';
import { validateLoadPostgresUrl, seedSyntheticActors, fixtureMap, distribution, createMeasurements } from './load-test.mjs';

export function parseMatchingOptions(args) {
  const options = { rate: 1, durationSeconds: 60, warmupSeconds: 10, actors: 40, apiInstances: 2, workers: 2,
    poolSize: 10, idleAccounts: 0, maxMatchP95Ms: 10000, fastPath: false, output: null };
  const flags = { '--rate': 'rate', '--duration-seconds': 'durationSeconds', '--warmup-seconds': 'warmupSeconds',
    '--actors': 'actors', '--api-instances': 'apiInstances', '--workers': 'workers', '--pool-size': 'poolSize',
    '--idle-accounts': 'idleAccounts', '--max-match-p95-ms': 'maxMatchP95Ms', '--fast-path': 'fastPath', '--output': 'output' };
  for (let i = 0; i < args.length; i += 2) {
    const key = flags[args[i]], value = args[i + 1];
    if (!key || value === undefined || value.startsWith('--')) throw new Error('Unknown or incomplete matching benchmark option. Use --help.');
    if (key === 'fastPath' && !['true', 'false'].includes(value)) throw new Error('--fast-path must be true or false.');
    options[key] = key === 'output' ? value : key === 'fastPath' ? value === 'true' : Number(value);
  }
  for (const [key, min, max] of [['rate', 1, 20], ['durationSeconds', 1, 300], ['warmupSeconds', 0, 60], ['actors', 1, 200],
    ['apiInstances', 1, 4], ['workers', 1, 4], ['poolSize', 1, 30], ['idleAccounts', 0, 1000000], ['maxMatchP95Ms', 1, 60000]]) {
    if (!Number.isInteger(options[key]) || options[key] < min || options[key] > max) throw new Error(`Invalid ${key}: expected ${min}–${max}.`);
  }
  if ((options.apiInstances + options.workers) * options.poolSize > 80) throw new Error('Combined process pools must not exceed 80 connections.');
  return options;
}

/** Fixed arrivals: neither slow responses nor exhausted actors delay the schedule. */
export async function runArrivals({ rate, seconds, capacity, admit, now = () => performance.now(), wait = delay }) {
  const pending = new Set(), lag = [], begin = now(), scheduled = Math.ceil(rate * seconds);
  let started = 0, dropped = 0, late = 0, peak = 0;
  for (let i = 0; i < scheduled; i++) {
    const due = begin + i * 1000 / rate;
    await wait(Math.max(0, due - now()));
    const behind = Math.max(0, now() - due); lag.push(behind);
    if (behind >= 1000 / rate) { dropped++; late++; continue; }
    if (pending.size >= capacity) { dropped++; continue; }
    const job = admit();
    if (!job) { dropped++; continue; }
    started++;
    const task = Promise.resolve(job).finally(() => pending.delete(task));
    pending.add(task); peak = Math.max(peak, pending.size);
    // Rejections are consumed here as well as at drain; the workload records failures.
    void task.catch(() => {});
  }
  await wait(Math.max(0, begin + seconds * 1000 - now()));
  await Promise.allSettled([...pending]);
  return { scheduled, started, dropped, late, peakInFlight: peak, schedulingLagMs: distribution(lag),
    arrivalWindowSeconds: seconds, elapsedIncludingDrainSeconds: (now() - begin) / 1000 };
}

function profileStore() {
  let samples = [], overflow = 0, queryTotals = new Map();
  return {
    add(value) {
      if (samples.length >= 10000) { overflow++; return; }
      samples.push({ durationMs: value.durationMs, queryCount: value.queryCount, queryMs: value.queryMs,
        retries: value.retries, failed: value.failed, phases: value.phases });
      for (const row of value.queries) {
        const key = queryTotals.has(row.fingerprint) || queryTotals.size < 128 ? row.fingerprint : 'overflow';
        const previous = queryTotals.get(key) ?? { count: 0, totalMs: 0, maxMs: 0, errors: 0 };
        previous.count += row.count; previous.totalMs += row.totalMs; previous.errors += row.errors;
        previous.maxMs = Math.max(previous.maxMs, row.maxMs); queryTotals.set(key, previous);
      }
    },
    reset() { samples = []; overflow = 0; queryTotals = new Map(); },
    summary() { return { cycles: samples.length, overflow, failed: samples.filter((r) => r.failed).length,
      queryCount: samples.reduce((n, r) => n + r.queryCount, 0), queryMs: samples.reduce((n, r) => n + r.queryMs, 0),
      durationMs: distribution(samples.map((r) => r.durationMs)), queriesPerCycle: distribution(samples.map((r) => r.queryCount)),
      queryMsPerCycle: distribution(samples.map((r) => r.queryMs)), retries: samples.reduce((n, r) => n + r.retries, 0),
      phases: Object.fromEntries(['discovery', 'routing', 'commit'].map((name) => [name, distribution(samples.filter((r) => r.phases[name] !== undefined).map((r) => r.phases[name]))])),
      queries: [...queryTotals].map(([fingerprint, row]) => ({ fingerprint, ...row })).sort((a, b) => b.totalMs - a.totalMs).slice(0, 20) }; },
  };
}

async function childMain() {
  if (!process.send || process.env.TAXI_AI_BENCH_CHILD !== 'isolated') throw new Error('This child requires an isolated benchmark parent.');
  const { openPostgresDatabase } = await import('../services/api/src/infrastructure/postgres.mjs');
  const { createApplication } = await import('../services/api/src/application.mjs');
  const { createAppServer } = await import('../apps/web/server.mjs');
  const { createWorkerConfig } = await import('../services/api/src/infrastructure/worker-config.mjs');
  const { createCallConfig } = await import('../services/api/src/infrastructure/call-config.mjs');
  const { createDispatchProfiler } = await import('../services/api/src/infrastructure/dispatch-profiler.mjs');
  const { createTelemetry } = await import('../services/api/src/infrastructure/telemetry.mjs');
  const role = process.env.TAXI_AI_BENCH_ROLE, schema = process.env.TAXI_AI_BENCH_SCHEMA;
  if (!['setup', 'api', 'worker'].includes(role) || !/^taxi_ai_bench_[a-f0-9]{32}$/.test(schema)) throw new Error('Invalid isolated benchmark child.');
  const profiles = profileStore(), lag = monitorEventLoopDelay({ resolution: 10 });
  let db, server, closing = false, statsTimer, peakWaiting = 0, peakConnections = 0;
  async function stop() {
    if (closing) return; closing = true; clearInterval(statsTimer); lag.disable();
    try {
      if (server) { server.beginShutdown(); server.closeAllConnections(); await new Promise((resolve) => server.close(resolve)); await server.closeResources(); }
      if (role === 'setup' && db) await db.exec(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    } finally { await db?.close(); process.disconnect?.(); }
  }
  process.once('disconnect', () => { void stop().catch(() => { process.exitCode = 1; }); });
  process.once('SIGTERM', () => { void stop().catch(() => { process.exitCode = 1; }); });
  let stage = 'database_open';
  try {
    db = await openPostgresDatabase({ connectionString: validateLoadPostgresUrl(process.env.TAXI_AI_LOAD_POSTGRES_URL), schema,
      max: role === 'setup' ? 2 : Number(process.env.TAXI_AI_BENCH_POOL), migrate: role === 'setup' });
    stage = 'application_compose';
    const options = { db, mapProvider: fixtureMap, callConfig: createCallConfig({ TAXI_AI_CALLS_MODE: 'off' }),
      workerConfig: createWorkerConfig({ TAXI_AI_PROCESS_ROLE: role === 'setup' ? 'api' : role,
        TAXI_AI_MATCHING_FAST_PATH: process.env.TAXI_AI_MATCHING_FAST_PATH }),
      dispatchConfig: { mode: 'sequential', requestRefresh: false }, allowSimulation: true };
    let actors;
    if (role === 'setup') {
      stage = 'seed_actors';
      actors = await seedSyntheticActors(createApplication(options), Number(process.env.TAXI_AI_BENCH_ACTORS));
      const count = Number(process.env.TAXI_AI_BENCH_IDLE);
      for (let offset = 1; offset <= count; offset += 10000) {
        await db.query(`INSERT INTO users(id,email,name,password_hash,role,created_at)
          SELECT 'idle-' || n,'idle-' || n || '@example.test','Synthetic idle account','unusable','customer',$3
          FROM generate_series($1::integer,$2::integer) n`, [offset, Math.min(count, offset + 9999), Date.now()]);
      }
      await db.exec('ANALYZE');
      stage = 'ready';
    } else {
      stage = 'server_start';
      server = createAppServer({ ...options, telemetry: createTelemetry({ enabled: false }),
        dispatchProfiler: createDispatchProfiler({ sampleEvery: 1, report: profiles.add }) });
      server.listen(0, '127.0.0.1'); await once(server, 'listening');
      stage = 'ready';
    }
    lag.enable();
    statsTimer = setInterval(() => { const stats = db.stats(); peakWaiting = Math.max(peakWaiting, stats.waiting); peakConnections = Math.max(peakConnections, stats.total); }, 250);
    statsTimer.unref();
    process.on('message', (message) => {
      if (message.type === 'reset') { profiles.reset(); lag.reset(); peakWaiting = 0; peakConnections = 0; process.send?.({ type: 'reset' }); }
      if (message.type === 'metrics') process.send?.({ type: 'metrics', role, profiles: profiles.summary(), pool: { peakWaiting, peakConnections },
        memoryBytes: process.memoryUsage(), eventLoopLagMs: { p95: lag.percentile(95) / 1e6, p99: lag.percentile(99) / 1e6, max: lag.max / 1e6 } });
      if (message.type === 'stop') void stop().catch(() => { process.exitCode = 1; });
    });
    process.send({ type: 'ready', ...(actors ? { actors } : { base: `http://127.0.0.1:${server.address().port}` }) });
  } catch (error) {
    process.send?.({ type: 'error', stage, code: /^[A-Z0-9_]{1,40}$/.test(error.code ?? '') ? error.code : 'SETUP_FAILED' });
    await stop(); process.exitCode = 1;
  }
}

function message(child, type, timeoutMs = 180000) {
  return new Promise((resolve, reject) => {
    const finish = (error, value) => { clearTimeout(timer); child.off('message', receive); child.off('exit', exited); child.off('error', failed); error ? reject(error) : resolve(value); };
    const receive = (value) => { if (value.type === type) finish(null, value); else if (value.type === 'error') finish(new Error(`Benchmark child failed: ${value.stage ?? 'unknown'}:${value.code}`)); };
    const exited = () => finish(new Error('Benchmark child stopped unexpectedly.'));
    const failed = () => finish(new Error('Benchmark child could not start.'));
    const timer = setTimeout(() => finish(new Error('Benchmark child timed out.')), timeoutMs);
    child.on('message', receive); child.once('exit', exited); child.once('error', failed);
  });
}
async function stopChild(child) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  const exited = once(child, 'exit'), timer = setTimeout(() => child.kill('SIGKILL'), 30000);
  try { if (child.connected) child.send({ type: 'stop' }); else child.kill('SIGTERM'); await exited; }
  finally { clearTimeout(timer); }
}

export function matchingGates(measurement, processes, options) {
  return { noDroppedArrivals: measurement.arrivals.dropped === 0,
    httpErrorRate: measurement.errorRate <= 0.01,
    allJourneysComplete: measurement.journeys.completed === measurement.arrivals.scheduled && Object.keys(measurement.operationErrors).length === 0,
    matchLatency: measurement.journeys.timeToAcceptedOfferMs.p95 !== null && measurement.journeys.timeToAcceptedOfferMs.p95 <= options.maxMatchP95Ms,
    workerProfilesPresent: processes.some((p) => p.role === 'worker' && p.profiles.phases.commit.count > 0),
    profileCapacity: processes.every((p) => p.profiles.overflow === 0),
    workerHealthy: processes.filter((p) => p.role === 'worker').every((p) => p.profiles.failed === 0) };
}

export async function runMatchingBenchmark(options) {
  const postgresUrl = validateLoadPostgresUrl(process.env.TAXI_AI_LOAD_POSTGRES_URL);
  await requireNativePostgres(postgresUrl);
  const schema = `taxi_ai_bench_${randomUUID().replaceAll('-', '')}`, children = [];
  async function start(role) {
    const child = fork(fileURLToPath(import.meta.url), ['--child'], { silent: true, execArgv: ['--experimental-sqlite'], env: {
      PATH: process.env.PATH, TAXI_AI_MODE: 'local', TAXI_AI_BENCH_CHILD: 'isolated', TAXI_AI_BENCH_ROLE: role, TAXI_AI_BENCH_SCHEMA: schema,
      TAXI_AI_LOAD_POSTGRES_URL: postgresUrl, TAXI_AI_BENCH_POOL: String(options.poolSize), TAXI_AI_BENCH_ACTORS: String(options.actors),
      TAXI_AI_BENCH_IDLE: String(options.idleAccounts), TAXI_AI_MATCHING_FAST_PATH: String(options.fastPath),
      TAXI_AI_MAPS_MODE: 'off', TAXI_AI_CALLS_MODE: 'off', TAXI_AI_EMAIL_MODE: 'off',
      TAXI_AI_PUSH_ENABLED: 'false', TAXI_AI_VEHICLE_VISION_MODE: 'off', TAXI_AI_BENCH_DIAGNOSTICS: process.env.TAXI_AI_BENCH_DIAGNOSTICS ?? '' } });
    children.push(child); child.stdout.resume();
    if (process.env.TAXI_AI_BENCH_DIAGNOSTICS === 'safe-stage') {
      child.stderr.setEncoding('utf8'); let diagnosticBuffer = '';
      child.stderr.on('data', (chunk) => {
        diagnosticBuffer += chunk;
        const lines = diagnosticBuffer.split('\n'); diagnosticBuffer = lines.pop() ?? '';
        for (const line of lines) if (/^BENCH_SERVER_ERROR=[A-Za-z][A-Za-z0-9_]{0,60}:[A-Z0-9_]{1,40}:[a-z_][a-z0-9_]{0,80}$/.test(line)) console.error(line);
      });
    } else child.stderr.resume();
    if (process.env.TAXI_AI_BENCH_DIAGNOSTICS === 'safe-stage') child.on('message', (value) => {
      if (value?.type === 'diagnostic' && value.kind === 'http_failure'
        && /^[a-z_]{1,80}$/.test(value.operation ?? '') && Number.isInteger(value.status)
        && /^[A-Z0-9_]{1,80}$/.test(value.code ?? '')) {
        console.error(`BENCH_HTTP_FAILURE=${role}:${value.operation}:${value.status}:${value.code}`);
      }
    });
    return { child, ...await message(child, 'ready') };
  }
  let pumping = false, pumps = [];
  try {
    const { actors } = await start('setup'), apis = [], processes = [];
    for (let i = 0; i < options.apiInstances; i++) { const api = await start('api'); apis.push(api.base); processes.push(api.child); }
    for (let i = 0; i < options.workers; i++) processes.push((await start('worker')).child);
    let cursor = 0, currentMetrics = createMeasurements();
    const owners = new Map();
    async function request(actor, path, operation, metrics, data) {
      const base = apis[cursor++ % apis.length], begin = performance.now(); let status = 0;
      try {
        const response = await fetch(base + path, { method: data === undefined ? 'GET' : 'POST', redirect: 'error', signal: AbortSignal.timeout(15000),
          headers: { Cookie: actor.cookie, 'X-Availability-Client': actor.clientId, 'X-Location-Client': actor.clientId,
            ...(data === undefined ? {} : { Origin: base, 'Content-Type': 'application/json', 'X-CSRF-Token': actor.csrf, 'Idempotency-Key': randomUUID() }) },
          ...(data === undefined ? {} : { body: JSON.stringify(data) }) });
        status = response.status; const body = await response.json();
        if (!response.ok) {
          const code = /^[A-Z0-9_]{1,80}$/.test(body.error?.code ?? '') ? body.error.code : 'HTTP_ERROR';
          if (process.env.TAXI_AI_BENCH_DIAGNOSTICS === 'safe-stage' && /^[a-z_]{1,80}$/.test(operation)) {
            console.error(`BENCH_HTTP_FAILURE=parent:${operation}:${status}:${code}`);
            process.send?.({ type: 'diagnostic', kind: 'http_failure', operation, status, code });
          }
          const error = new Error('Benchmark HTTP request failed.'); error.code = code; throw error;
        }
        return body;
      } finally { metrics.record(operation, status, performance.now() - begin); }
    }
    const fix = (index) => ({ lat: 9.08 + index * 0.00001, lng: 7.4, accuracy: 10, capturedAt: Date.now() });
    async function online(driver, index, metrics) {
      const result = await request(driver, '/api/availability/online', 'driver_online', metrics, { mode: 'gps', position: fix(index) });
      driver.availabilityId = result.availability.id; driver.sequence = result.availability.sequence; driver.heartbeatAt = Date.now();
    }
    // Bring supply online before arrivals; setup traffic is reported separately.
    for (let i = 0; i < actors.drivers.length; i++) await online(actors.drivers[i], i, currentMetrics);
    const setup = currentMetrics.summary(0);
    function startPumps() {
      pumping = true;
      pumps = actors.drivers.map(async (driver, index) => {
        if (driver.disabled) return;
        while (pumping) {
          const metrics = currentMetrics; let owner;
          try {
            if (!driver.availabilityId && Date.now() >= (driver.readyAt ?? 0)) await online(driver, index, metrics);
            if (driver.availabilityId) {
              if (Date.now() - driver.heartbeatAt >= 10000) {
                await request(driver, `/api/availability/${driver.availabilityId}/position`, 'driver_heartbeat', metrics,
                  { sequence: ++driver.sequence, position: fix(index) }); driver.heartbeatAt = Date.now();
              }
              const offered = (await request(driver, '/api/rides?mode=work', 'driver_work', metrics)).available?.find((ride) => owners.has(ride.id));
              if (offered) {
                owner = owners.get(offered.id); let ride = offered;
                const command = async (actor, action, data = {}) => { ride = (await request(actor, `/api/rides/${ride.id}/${action}`, `ride_${action}`, owner.metrics,
                  { expectedVersion: ride.version, ...data })).ride; };
                await command(driver, 'claim', { offerId: offered.offer?.id }); driver.availabilityId = null;
                owner.metrics.matched(performance.now() - owner.at, offered.offer?.etaSource);
                await command(driver, 'offers', { amountKobo: 470000 });
                await command(owner.customer, 'accept', { offerId: ride.negotiation.currentOffer.id });
                await command(owner.customer, 'confirm'); const pickupPin = ride.trip.pickupPin;
                const { share } = await request(driver, `/api/rides/${ride.id}/location/start`, 'trip_location_start', owner.metrics, {});
                let sequence = share.sequence;
                for (const action of ['depart', 'arrive', 'start']) {
                  await request(driver, `/api/location-shares/${share.id}/position`, 'trip_location_position', owner.metrics,
                    { sequence: ++sequence, ...fix(index) });
                  await command(driver, action, action === 'start' ? { pickupPin } : {});
                }
                await command(driver, 'complete'); owner.metrics.completed(); owner.finish();
                driver.readyAt = Date.now() + 15000;
              }
            }
          } catch (error) {
            metrics.fail(/^[A-Z0-9_]{1,80}$/.test(error.code ?? '') ? error.code : 'DRIVER_FAILED');
            if (owner) owner.finish(false);
            // A failed command must not silently recycle a possibly busy driver.
            driver.disabled = true; break;
          }
          await delay(1000);
        }
      });
    }
    async function phase(seconds) {
      const metrics = createMeasurements(); currentMetrics = metrics;
      if (seconds) startPumps();
      const begin = performance.now();
      const arrivals = await runArrivals({ rate: options.rate, seconds, capacity: options.actors, admit: () => {
        const customer = actors.customers.find((a) => !a.busy && !a.disabled && Date.now() >= (a.readyAt ?? 0));
        if (!customer) return null;
        customer.busy = true;
        return (async () => {
          let rideId;
          try {
            const at = performance.now();
            const { quote } = await request(customer, '/api/locations/quotes', 'route_quote_fixture', metrics, {
              pickup: { lat: 9.08, lng: 7.4, name: 'Synthetic benchmark pickup' }, destination: { lat: 9.1, lng: 7.45, name: 'Synthetic benchmark destination' } });
            const { ride } = await request(customer, '/api/rides', 'ride_create', metrics, { quoteId: quote.id });
            metrics.created(); rideId = ride.id;
            const complete = await new Promise((resolve) => {
              const timer = setTimeout(() => resolve(false), 60000);
              owners.set(ride.id, { customer, metrics, at, finish: (ok = true) => { clearTimeout(timer); resolve(ok); } });
            });
            if (!complete) { metrics.fail('JOURNEY_INCOMPLETE'); customer.disabled = true; }
          } catch (error) { metrics.fail(/^[A-Z0-9_]{1,80}$/.test(error.code ?? '') ? error.code : 'CREATE_FAILED'); customer.disabled = true; }
          finally { if (rideId) owners.delete(rideId); customer.busy = false; customer.readyAt = Date.now() + 15000; }
        })();
      } });
      pumping = false; await Promise.all(pumps);
      return { ...metrics.summary(performance.now() - begin), arrivals };
    }
    const warmup = await phase(options.warmupSeconds);
    await Promise.all(processes.map(async (child) => { const pending = message(child, 'reset'); child.send({ type: 'reset' }); await pending; }));
    const measurement = await phase(options.durationSeconds);
    pumping = false; await Promise.all(pumps);
    const snapshots = await Promise.all(processes.map(async (child) => { const pending = message(child, 'metrics'); child.send({ type: 'metrics' }); const value = await pending; delete value.type; return value; }));
    const gates = { ...matchingGates(measurement, snapshots, options),
      warmupHealthy: warmup.arrivals.dropped === 0 && warmup.failedRequests === 0 && Object.keys(warmup.operationErrors).length === 0 };
    return { version: 1, generatedAt: new Date().toISOString(), configuration: { ...options, output: undefined },
      generator: 'fixed open arrivals; separate API and worker processes; loopback HTTP',
      database: 'native PostgreSQL/PostGIS, disposable schema', providers: 'disabled; deterministic route fixtures',
      interpretation: 'A staging-host benchmark, not a capacity guarantee. Idle accounts are storage cardinality, not concurrent users. Setup and warmup are excluded from measurement.',
      setup, warmup, measurement, processes: snapshots, gates, passed: Object.values(gates).every(Boolean) };
  } finally {
    pumping = false; await Promise.allSettled(pumps);
    await Promise.allSettled(children.slice(1).map(stopChild));
    if (children[0]) await stopChild(children[0]);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.argv[2] === '--child') await childMain();
  else if (process.argv.includes('--help')) console.log('Usage: npm run matching:benchmark -- [--rate 1] [--duration-seconds 60] [--warmup-seconds 10] [--actors 40] [--api-instances 2] [--workers 2] [--pool-size 10] [--idle-accounts 0] [--max-match-p95-ms 10000] [--fast-path false] [--output new-report.json]\nRequires TAXI_AI_LOAD_POSTGRES_URL: an isolated loopback taxi_ai_load* or taxi_ai_test* database. Never targets an existing web deployment.');
  else {
    try {
      const options = parseMatchingOptions(process.argv.slice(2)), report = await runMatchingBenchmark(options), json = JSON.stringify(report, null, 2) + '\n';
      if (options.output) await writeFile(options.output, json, { flag: 'wx', mode: 0o600 });
      console.log(json); if (!report.passed) process.exitCode = 1;
    } catch (error) {
      if (process.env.TAXI_AI_BENCH_DIAGNOSTICS === 'safe-stage' && /^Benchmark child failed: [a-z_]+:[A-Z0-9_]+$/.test(error.message)) console.error(`BENCHMARK_FAILURE=${error.message}`);
      else console.error('Matching benchmark failed. Check the isolated database, options, and child process health; credentials and raw errors are omitted.');
      process.exitCode = 1;
    }
  }
}
