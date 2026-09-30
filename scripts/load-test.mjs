import { fork } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { randomUUID } from 'node:crypto';
import { monitorEventLoopDelay, performance } from 'node:perf_hooks';
import { setTimeout as delay } from 'node:timers/promises';

// Intentionally no target URL or existing SQLite database option. Every run owns
// a disposable database and a child server listening on a random loopback port.
export function parseOptions(args) {
  const options = { scenario: 'journey', concurrency: 5, durationSeconds: 30, warmupSeconds: 5, thinkMs: 15000, output: null, database: 'sqlite', poolSize: 10 };
  const names = { '--scenario': 'scenario', '--concurrency': 'concurrency', '--duration-seconds': 'durationSeconds',
    '--warmup-seconds': 'warmupSeconds', '--think-ms': 'thinkMs', '--output': 'output', '--database': 'database', '--pool-size': 'poolSize' };
  for (let i = 0; i < args.length; i += 2) {
    const key = names[args[i]], value = args[i + 1];
    if (!key || value === undefined || value.startsWith('--')) throw new Error('Unknown or incomplete load-test option. Use --help.');
    options[key] = ['scenario', 'output', 'database'].includes(key) ? value : Number(value);
  }
  if (!['read', 'heartbeat', 'journey', 'events'].includes(options.scenario)) throw new Error('Scenario must be read, heartbeat, journey, or events.');
  if (!['sqlite', 'postgres'].includes(options.database)) throw new Error('Database must be sqlite or postgres; existing SQLite files are never accepted.');
  for (const [key, min, max] of [['concurrency', 1, 200], ['durationSeconds', 1, 300], ['warmupSeconds', 0, 60], ['thinkMs', 100, 60000], ['poolSize', 1, 100]]) {
    if (!Number.isInteger(options[key]) || options[key] < min || options[key] > max) throw new Error(`${key} must be an integer from ${min} to ${max}.`);
  }
  if (options.scenario === 'journey' && options.thinkMs < 15000) throw new Error('Journey pacing must be at least 15000ms to respect per-account write limits.');
  if (options.scenario === 'heartbeat' && options.thinkMs < 2000) throw new Error('Heartbeat pacing must be at least 2000ms.');
  return options;
}

export function validateLoadPostgresUrl(value) {
  let url; try { url = new URL(value); } catch { throw new Error('Set TAXI_AI_LOAD_POSTGRES_URL to an isolated loopback PostgreSQL test database.'); }
  if (!['postgres:', 'postgresql:'].includes(url.protocol) || !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)
    || !/^\/taxi_ai_(load|test)[a-z0-9_]*$/.test(url.pathname) || url.search || url.hash) {
    throw new Error('PostgreSQL load tests require a loopback taxi_ai_load* or taxi_ai_test* database without URL options.');
  }
  return value;
}

export function distribution(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const percentile = (p) => sorted.length ? Math.round(sorted[Math.max(0, Math.ceil(sorted.length * p) - 1)] * 100) / 100 : null;
  return { count: sorted.length, p50: percentile(0.5), p95: percentile(0.95), p99: percentile(0.99), max: percentile(1) };
}

export function createMeasurements() {
  const records = [], journeyWaits = [], statuses = {}, errors = {}, pickupEstimateSources = {};
  let completed = 0, created = 0;
  return {
    record(operation, status, ms) { records.push({ operation, status, ms }); statuses[status] = (statuses[status] ?? 0) + 1; },
    fail(code) { errors[code] = (errors[code] ?? 0) + 1; },
    created() { created++; }, completed() { completed++; }, matched(ms, source = 'unknown') {
      journeyWaits.push(ms); pickupEstimateSources[source] = (pickupEstimateSources[source] ?? 0) + 1;
    },
    summary(elapsedMs) {
      const failures = records.filter((r) => r.status < 200 || r.status >= 300).length;
      return { elapsedSeconds: Math.round(elapsedMs / 10) / 100, requests: records.length,
        throughputRequestsPerSecond: elapsedMs ? Math.round(records.length / (elapsedMs / 1000) * 100) / 100 : 0,
        failedRequests: failures, errorRate: records.length ? failures / records.length : 0, statuses: { ...statuses }, operationErrors: { ...errors },
        latencyMs: distribution(records.map((r) => r.ms)),
        operations: Object.fromEntries([...new Set(records.map((r) => r.operation))].map((operation) => [operation,
          distribution(records.filter((r) => r.operation === operation).map((r) => r.ms))])),
        journeys: { created, completed, pickupEstimateSources: { ...pickupEstimateSources }, timeToAcceptedOfferMs: distribution(journeyWaits) } };
    },
  };
}

const POSITION = { lat: 9.08, lng: 7.4 };
const fix = (offset = 0) => ({ lat: POSITION.lat + offset, lng: POSITION.lng, accuracy: 10, capturedAt: Date.now() });
export const fixtureMap = { mode: 'dedicated', tileOrigin: 'https://tiles.example.test', describe: () => ({ enabled: true, mode: 'dedicated' }),
  route: async (from, to) => ({ distanceMeters: 7000, durationSeconds: 1200, coordinates: [[from.lng, from.lat], [to.lng, to.lat]] }),
  pickupEstimates: async (pairs) => pairs.map(({ from, to }) => ({ distanceMeters: 500, durationSeconds: 120,
    coordinates: [[from.lng, from.lat], [to.lng, to.lat]] })) };

export async function seedSyntheticActors(application, count) {
  const password = `Load-only-${randomUUID()}-Aa1!`;
  const admin = await application.accounts.register({ name: 'Synthetic load operator', email: 'load-operator@example.test', password });
  await application.accounts.bootstrapAdmin(admin.email);
  const operator = await application.accounts.profile(admin.id);
  const actors = { customers: [], drivers: [] };
  for (let i = 0; i < count; i++) {
    for (const role of ['customer', 'driver']) {
      const user = await application.accounts.register({ name: `Synthetic load ${role} ${i}`, email: `load-${role}-${i}@example.test`, password, role,
        ...(role === 'driver' ? { vehicle: { model: 'Toyota Corolla', plate: `LOAD-${i}` } } : {}) });
      if (role === 'driver') {
        let draft = await application.drivers.get(user, user.id);
        const command = async (action, data) => { draft = (await application.drivers.command(user, user.id, action,
          { expectedVersion: draft.version, ...data }, randomUUID())).application; };
        await command('save', { details: { legalName: 'Fictional Load Driver', phone: '+2348000000000', licenceNumber: `LOAD-ONLY-${i}`,
          vehicle: { make: 'Toyota', model: 'Corolla', year: 2020, colour: 'Yellow', plate: `LOAD-${i}` } } });
        for (const kind of ['profile_photo', 'driving_licence', 'vehicle_registration', 'insurance', 'vehicle_photo']) {
          await command('upload', { kind, name: 'fictional-load.png', mimeType: 'image/png',
            base64: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aA3cAAAAASUVORK5CYII=',
            expiresOn: kind.endsWith('photo') ? null : '2099-12-31' });
        }
        await command('submit', {});
        for (const document of draft.documents) await application.drivers.download(operator, document.id);
        await application.drivers.command(operator, user.id, 'review', { expectedVersion: draft.version, decision: 'approved',
          reason: 'Synthetic fixtures in a disposable load-test database.', reference: 'LOAD-TEST-ONLY',
          checks: { identity: true, licence: true, vehicle: true, insurance: true } }, randomUUID());
      }
      const session = await application.accounts.issueSession(user.id);
      actors[role === 'customer' ? 'customers' : 'drivers'].push({ id: user.id, cookie: `taxi_ai_session=${session.token}`,
        csrf: session.csrfToken, clientId: randomUUID(), sequence: 0, availabilityId: null });
    }
  }
  return actors;
}

async function childServer() {
  if (!process.send || process.env.TAXI_AI_LOAD_CHILD !== 'isolated') throw new Error('The load server can only be started by its isolated parent.');
  const directory = await mkdtemp(join(tmpdir(), 'taxi-ai-load-'));
  const { openDatabase } = await import('../services/api/src/infrastructure/database.mjs');
  const { createApplication } = await import('../services/api/src/application.mjs');
  const { createAppServer } = await import('../apps/web/server.mjs');
  const { createCallConfig } = await import('../services/api/src/infrastructure/call-config.mjs');
  const { createTelemetry } = await import('../services/api/src/infrastructure/telemetry.mjs');
  const postgres = process.env.TAXI_AI_LOAD_DATABASE === 'postgres';
  const schema = `taxi_ai_load_${randomUUID().replaceAll('-', '')}`;
  const db = postgres ? await (await import('../services/api/src/infrastructure/postgres.mjs')).openPostgresDatabase({
    connectionString: validateLoadPostgresUrl(process.env.TAXI_AI_LOAD_POSTGRES_URL), schema, migrate: true,
    max: Number(process.env.TAXI_AI_LOAD_POOL_SIZE),
  }) : await openDatabase(join(directory, 'disposable.sqlite'));
  const options = { db, mapProvider: fixtureMap, callConfig: createCallConfig({ TAXI_AI_CALLS_MODE: 'off' }),
    dispatchConfig: { mode: 'sequential' }, allowSimulation: true };
  let server, closing = false;
  const lag = monitorEventLoopDelay({ resolution: 10 });
  const stop = async () => {
    if (closing) return; closing = true; lag.disable();
    if (server) { server.beginShutdown(); server.closeAllConnections(); await new Promise((resolve) => server.close(resolve)); await server.closeResources?.(); }
    else await db.close();
    if (postgres) {
      const { default: pg } = await import('pg');
      const cleanup = new pg.Client({ connectionString: process.env.TAXI_AI_LOAD_POSTGRES_URL });
      await cleanup.connect();
      try { await cleanup.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`); }
      finally { await cleanup.end(); }
    }
    await rm(directory, { recursive: true, force: true });
    process.disconnect?.();
  };
  process.once('disconnect', () => { void stop(); });
  process.once('SIGTERM', () => { void stop(); });
  try {
    const application = await createApplication(options);
    const actors = await seedSyntheticActors(application, Number(process.env.TAXI_AI_LOAD_ACTORS));
    server = await createAppServer({ ...options, telemetry: createTelemetry({ enabled: false }) });
    server.listen(0, '127.0.0.1'); await once(server, 'listening');
    lag.enable();
    process.on('message', async (message) => {
      if (message.type === 'reset-metrics') { lag.reset(); process.send?.({ type: 'metrics-reset' }); }
      if (message.type === 'metrics') process.send?.({ type: 'metrics', serverEventLoopLagMs: {
        p50: lag.percentile(50) / 1e6, p95: lag.percentile(95) / 1e6, p99: lag.percentile(99) / 1e6, max: lag.max / 1e6 },
        serverMemoryBytes: process.memoryUsage() });
      if (message.type === 'stop') await stop();
    });
    process.send({ type: 'ready', base: `http://127.0.0.1:${server.address().port}`, actors });
  } catch (error) {
    process.send?.({ type: 'error', message: 'Isolated load server setup failed.', code: error.code ?? error.name });
    await stop(); process.exitCode = 1;
  }
}

function waitMessage(child, type, timeoutMs = 120000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => finish(new Error('Load server did not respond in time.')), timeoutMs);
    const finish = (error, value) => { clearTimeout(timer); child.off('message', receive); child.off('exit', exited); error ? reject(error) : resolve(value); };
    const receive = (message) => { if (message.type === type) finish(null, message); else if (message.type === 'error') finish(new Error(`${message.message} ${message.code}`)); };
    const exited = () => finish(new Error('Load server stopped unexpectedly.'));
    child.on('message', receive); child.once('exit', exited);
  });
}

export async function runLoad(options) {
  const postgresUrl = options.database === 'postgres' ? validateLoadPostgresUrl(process.env.TAXI_AI_LOAD_POSTGRES_URL) : null;
  const child = fork(fileURLToPath(import.meta.url), ['--server-child'], {
    execArgv: ['--experimental-sqlite'], silent: true,
    // Deliberately do not inherit .env, database URLs, credentials or enabled providers.
    env: { PATH: process.env.PATH, TAXI_AI_MODE: 'local', TAXI_AI_PROCESS_ROLE: 'all',
      TAXI_AI_LOAD_CHILD: 'isolated', TAXI_AI_LOAD_ACTORS: String(options.concurrency),
      TAXI_AI_LOAD_DATABASE: options.database, ...(postgresUrl ? { TAXI_AI_LOAD_POSTGRES_URL: postgresUrl } : {}),
      TAXI_AI_LOAD_POOL_SIZE: String(options.poolSize),
      TAXI_AI_MAPS_MODE: 'off', TAXI_AI_CALLS_MODE: 'off', TAXI_AI_EMAIL_MODE: 'off', TAXI_AI_PUSH_ENABLED: 'false' },
  });
  // Drain pipes; application diagnostic text can contain private values and is
  // not suitable for a shareable benchmark report.
  child.stdout.resume(); child.stderr.resume();
  let started;
  try { started = await waitMessage(child, 'ready'); }
  catch (error) { child.kill('SIGTERM'); throw error; }
  const { base, actors } = started;
  const request = async (actor, path, operation, metrics, data) => {
    const begin = performance.now(); let status = 0;
    try {
      const response = await fetch(base + path, { method: data === undefined ? 'GET' : 'POST', redirect: 'error',
        signal: AbortSignal.timeout(operation === 'event_wait' ? 35000 : 10000), headers: { Cookie: actor.cookie, 'X-Availability-Client': actor.clientId,
          ...(data === undefined ? {} : { Origin: base, 'Content-Type': 'application/json', 'X-CSRF-Token': actor.csrf, 'Idempotency-Key': randomUUID() }) },
        ...(data === undefined ? {} : { body: JSON.stringify(data) }) });
      status = response.status;
      const body = await response.json();
      if (!response.ok) { const error = new Error('Load request failed.'); error.code = body.error?.code ?? `HTTP_${status}`; throw error; }
      return body;
    } finally { metrics.record(operation, status, performance.now() - begin); }
  };
  const online = async (driver, metrics, index) => {
    const state = await request(driver, '/api/availability', 'availability_read', metrics);
    if (state.availability?.online) { driver.availabilityId = state.availability.id; driver.sequence = state.availability.sequence ?? driver.sequence; return; }
    const result = await request(driver, '/api/availability/online', 'driver_online', metrics,
      { mode: 'gps', position: fix(index * 0.00001) });
    driver.availabilityId = result.availability.id; driver.sequence = result.availability.sequence;
  };
  const heartbeat = (driver, metrics, index) => request(driver, `/api/availability/${driver.availabilityId}/position`, 'driver_heartbeat', metrics,
    { sequence: ++driver.sequence, position: fix(index * 0.00001) });
  async function phase(seconds) {
    const metrics = createMeasurements(), begin = performance.now(), deadline = begin + seconds * 1000;
    if (!seconds) return metrics.summary(0);
    if (options.scenario === 'events') {
      await Promise.all(actors.customers.map(async (customer) => {
        while (performance.now() < deadline) {
          try {
            const waitMs = Math.max(0, Math.min(25000, Math.floor(deadline - performance.now())));
            const result = await request(customer, `/api/events?cursor=${customer.cursor ?? '0'}&wait=${waitMs}`, 'event_wait', metrics);
            customer.cursor = result.cursor;
          } catch (error) { metrics.fail(error.code ?? 'TRANSPORT_ERROR'); }
          await delay(Math.max(0, Math.min(options.thinkMs, deadline - performance.now())));
        }
      }));
    } else if (options.scenario === 'read') {
      await Promise.all(actors.customers.map(async (customer) => {
        while (performance.now() < deadline) {
          try { await request(customer, '/api/session', 'authenticated_session', metrics); await request(customer, '/api/rides?mode=customer', 'customer_rides', metrics); }
          catch (error) { metrics.fail(error.code ?? 'TRANSPORT_ERROR'); }
          await delay(Math.max(0, Math.min(options.thinkMs, deadline - performance.now())));
        }
      }));
    } else if (options.scenario === 'heartbeat') {
      await Promise.all(actors.drivers.map(async (driver, index) => {
        try { await online(driver, metrics, index); }
        catch (error) { metrics.fail(error.code ?? 'ONLINE_FAILED'); return; }
        while (performance.now() < deadline) {
          try { await heartbeat(driver, metrics, index); await request(driver, '/api/rides?mode=work', 'driver_work', metrics); }
          catch (error) { metrics.fail(error.code ?? 'TRANSPORT_ERROR'); }
          await delay(Math.max(0, Math.min(options.thinkMs, deadline - performance.now())));
        }
      }));
    } else {
      while (performance.now() < deadline) {
        const owners = new Map(), remaining = new Set();
        await Promise.all(actors.customers.map(async (customer) => {
          try {
            const { quote } = await request(customer, '/api/locations/quotes', 'route_quote_fixture', metrics,
              { pickup: { ...POSITION, name: 'Synthetic load pickup' }, destination: { lat: 9.1, lng: 7.45, name: 'Synthetic load destination' } });
            const { ride } = await request(customer, '/api/rides', 'ride_create', metrics, { quoteId: quote.id });
            metrics.created(); owners.set(ride.id, { customer, at: performance.now() }); remaining.add(ride.id);
          } catch (error) { metrics.fail(error.code ?? 'CREATE_FAILED'); }
        }));
        await Promise.all(actors.drivers.map(async (driver, index) => {
          try {
            await online(driver, metrics, index); await heartbeat(driver, metrics, index);
            let offer, waitUntil = performance.now() + 25000;
            while (performance.now() < waitUntil && remaining.size) {
              offer = (await request(driver, '/api/rides?mode=work', 'driver_work', metrics)).available?.find((ride) => remaining.has(ride.id));
              if (offer) break;
              await delay(250);
            }
            if (!offer) return;
            let ride = offer;
            const owner = owners.get(ride.id);
            const command = async (actor, action, extra = {}) => {
              ride = (await request(actor, `/api/rides/${ride.id}/${action}`, `ride_${action}`, metrics,
                { expectedVersion: ride.version, ...extra })).ride;
            };
            await command(driver, 'claim', { offerId: offer.offer?.id }); driver.availabilityId = null;
            remaining.delete(ride.id); metrics.matched(performance.now() - owner.at, offer.offer?.etaSource);
            await command(driver, 'offers', { amountKobo: 470000 });
            await command(owner.customer, 'accept', { offerId: ride.negotiation.currentOffer.id });
            await command(owner.customer, 'confirm'); const pickupPin = ride.trip.pickupPin;
            await command(driver, 'depart'); await command(driver, 'arrive'); await command(driver, 'start', { pickupPin });
            await command(driver, 'complete'); metrics.completed();
          } catch (error) { metrics.fail(error.code ?? 'JOURNEY_FAILED'); }
        }));
        for (const ignored of remaining) metrics.fail('UNMATCHED_REQUEST');
        const remainingMs = deadline - performance.now();
        if (remainingMs <= options.thinkMs) { await delay(Math.max(0, remainingMs)); break; }
        await delay(options.thinkMs);
      }
    }
    return metrics.summary(performance.now() - begin);
  }
  try {
    const warmup = await phase(options.warmupSeconds);
    let pending = waitMessage(child, 'metrics-reset'); child.send({ type: 'reset-metrics' }); await pending;
    const measurement = await phase(options.durationSeconds);
    pending = waitMessage(child, 'metrics'); child.send({ type: 'metrics' }); const server = await pending;
    return { version: 1, generatedAt: new Date().toISOString(), scenario: options.scenario, concurrency: options.concurrency,
      requestedMeasurementSeconds: options.durationSeconds, thinkMs: options.thinkMs,
      database: options.database === 'postgres' ? 'isolated PostgreSQL schema' : 'disposable SQLite',
      databasePoolSize: options.database === 'postgres' ? options.poolSize : null,
      generator: 'closed-loop, separate process, loopback HTTP', providers: 'disabled; deterministic route fixtures',
      interpretation: 'A development benchmark, not a production capacity guarantee. Account setup is outside measurement. Warmup is reported separately.',
      warmup, measurement, serverEventLoopLagMs: server.serverEventLoopLagMs, serverMemoryBytes: server.serverMemoryBytes };
  } finally {
    if (child.connected) child.send({ type: 'stop' });
    const stopDeadline = setTimeout(() => child.kill('SIGKILL'), 10000); stopDeadline.unref();
    if (child.exitCode === null) await once(child, 'exit'); clearTimeout(stopDeadline);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.argv[2] === '--server-child') await childServer();
  else if (process.argv.includes('--help')) console.log('Usage: npm run load:test -- --scenario journey|read|heartbeat|events --concurrency 5 --duration-seconds 30 --warmup-seconds 5 --think-ms 15000 [--database sqlite|postgres] [--pool-size 10] [--output new-report.json]\nRuns only an isolated local server with synthetic accounts. PostgreSQL requires TAXI_AI_LOAD_POSTGRES_URL for a loopback taxi_ai_load* or taxi_ai_test* database; each run creates and drops its own schema.');
  else {
    try {
      const options = parseOptions(process.argv.slice(2));
      const report = await runLoad(options), json = JSON.stringify(report, null, 2) + '\n';
      if (options.output) await writeFile(options.output, json, { flag: 'wx', mode: 0o600 });
      console.log(json);
      if (report.measurement.failedRequests || Object.keys(report.measurement.operationErrors).length) process.exitCode = 1;
    } catch (error) { console.error(error.message); process.exitCode = 1; }
  }
}
