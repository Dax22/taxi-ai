import { submitApplication, approveApplication, fixtureApi } from './driver-fixtures.mjs';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { request as httpRequest } from 'node:http';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createAppServer } from '../../../apps/web/server.mjs';
import { openDatabase } from '../src/infrastructure/database.mjs';
import { createApplication } from '../src/application.mjs';
import { createCallConfig } from '../src/infrastructure/call-config.mjs';

export const bootstrapAdmin = async (db, email) => (await createApplication({ db }).accounts.bootstrapAdmin(email));

// Test fixtures only. No accounts or passwords are seeded into the application.
// A calendar-realistic fixed clock also exercises vehicle model-year policy.
export const TEST_NOW = Date.UTC(2026, 0, 1) + 1_000_000;
export const PASSWORD = 'A long test-only password 123';

// Node fetch may normalize Host; use the real HTTP header in gateway tests.
export function httpFetch(url, options = {}) {
  return new Promise((resolve, reject) => {
    const request = httpRequest(url, { method: options.method ?? 'GET', headers: options.headers }, (response) => {
      const chunks = []; response.on('data', (chunk) => chunks.push(chunk)); response.on('error', reject);
      response.on('end', async () => (await resolve(new Response(Buffer.concat(chunks), { status: response.statusCode,
        headers: Object.fromEntries(Object.entries(response.headers).map(([key, value]) => [key, Array.isArray(value) ? value.join(', ') : value])) }))));
    });
    request.on('error', reject); request.end(options.body);
  });
}

export async function harness(t, { persistent = false, callConfig = createCallConfig({}), mapProvider, runtime, gatewayHeaders = {}, telemetry, googleProvider, accountMail, vehicleVisionProvider, staffMfa,
  dispatchConfig = { mode: 'legacy' } } = {}) {
  const folder = persistent ? await mkdtemp(join(tmpdir(), 'taxi-ai-test-')) : null;
  const filename = folder ? join(folder, 'test.sqlite') : ':memory:';
  let now = TEST_NOW, server, db, base, stopped = true;
  async function start() {
    db = openDatabase(filename);
    server = createAppServer({ db, clock: () => now, callConfig, mapProvider, runtime, telemetry, googleProvider, accountMail, vehicleVisionProvider, dispatchConfig, staffMfa });
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    base = `http://127.0.0.1:${server.address().port}`;
    stopped = false;
  }
  async function stop() {
    if (stopped) return;
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    await server.closeResources();
    stopped = true;
  }
  await start();
  t.after(async () => { await stop(); if (folder) await rm(folder, { recursive: true, force: true }); });
  return { get db() { return db; }, get base() { return base; }, get filename() { return filename; },
    get now() { return now; },
    beginShutdown() { server.beginShutdown(); },
    advance(ms) { now += ms; }, async restart() { await stop(); await start(); },
    client() {
      const client = { cookie: '', csrf: '', user: null };
      const availabilityClient = randomUUID();
      client.send = async (path, { method = 'GET', data, headers = {}, rawBody } = {}) => {
        const requestHeaders = { ...gatewayHeaders, ...(client.cookie ? { Cookie: client.cookie } : {}),
          ...(method === 'POST' ? { Origin: runtime?.publicOrigin ?? base, 'Content-Type': 'application/json', 'X-CSRF-Token': client.csrf } : {}), ...headers };
        for (const key of Object.keys(requestHeaders)) if (requestHeaders[key] === null) delete requestHeaders[key];
        const response = await (runtime?.mode === 'staging' ? httpFetch : fetch)(base + path, { method, headers: requestHeaders,
          ...(method === 'POST' ? { body: rawBody ?? JSON.stringify(data ?? {}) } : {}) });
        const cookie = response.headers.get('set-cookie');
        if (cookie) client.cookie = cookie.split(';')[0];
        const body = await response.json();
        if (Object.hasOwn(body, 'csrfToken')) client.csrf = body.csrfToken;
        if (Object.hasOwn(body, 'user')) client.user = body.user;
        return { status: response.status, body, headers: response.headers };
      };
      client.post = (path, data, key = randomUUID()) => client.send(path, { method: 'POST', data, headers: { 'Idempotency-Key': key } });
      client.availability = (path, data = {}, key = randomUUID()) => client.send(path, { method: 'POST', data,
        headers: { 'X-Availability-Client': availabilityClient, 'Idempotency-Key': key } });
      // Explicit setup for legacy ride tests; availability tests use the raw API.
      client.online = async (choice = null) => {
        const status = await client.send('/api/availability', { headers: { 'X-Availability-Client': availabilityClient } });
        assert.equal(status.status, 200, JSON.stringify(status.body));
        const mode = choice?.mode ?? (status.body.settings.allowSimulation ? 'sample' : 'gps');
        if (status.body.availability?.online) {
          const stopped = await client.availability(`/api/availability/${status.body.availability.id}/offline`);
          assert.equal(stopped.status, 200, JSON.stringify(stopped.body));
        }
        const data = mode === 'sample' ? { mode, areaId: choice?.areaId ?? 'wuse-ii' }
          : { mode, position: { lat: choice?.lat ?? 9.08, lng: choice?.lng ?? 7.4, accuracy: 10, capturedAt: now } };
        const result = await client.availability('/api/availability/online', data);
        assert.equal(result.status, 200, JSON.stringify(result.body));
        return result.body.availability;
      };
      client.register = async (name, role = 'customer') => {
        const result = await client.post('/api/auth/register', { name, email: `${name}@example.test`, password: PASSWORD, role,
          ...(role === 'driver' ? { vehicle: { model: 'Toyota Corolla', plate: `TEST-${name.slice(0, 5)}` } } : {}) });
        assert.equal(result.status, 201, JSON.stringify(result.body));
        return result;
      };
      return client;
    } };
}

export async function participants(h, driverCount = 1, { online = true } = {}) {
  const customer = h.client(); await customer.register('customer');
  const admin = h.client(); await admin.register('operator');
  (await bootstrapAdmin(h.db, admin.user.email));
  const login = await admin.post('/api/auth/login', { email: admin.user.email, password: PASSWORD });
  assert.equal(login.status, 200);
  const drivers = [];
  for (let i = 0; i < driverCount; i++) {
    const driver = h.client(); await driver.register(`driver${i}`, 'driver');
    await submitApplication(fixtureApi(driver));
    await approveApplication(fixtureApi(admin), driver.user.id);
    if (online) await driver.online();
    drivers.push(driver);
  }
  return { customer, admin, drivers, driver: drivers[0] };
}

export async function requestRide(customer) {
  const result = await customer.post('/api/rides', { pickupId: 'wuse-ii', destinationId: 'maitama' });
  assert.equal(result.status, 201, JSON.stringify(result.body));
  return result.body.ride;
}

export async function claimRide(driver, ride) {
  await driver.online(ride.route ? { mode: 'gps', lat: ride.pickup.lat, lng: ride.pickup.lng } : { mode: 'sample', areaId: ride.pickup.id });
  const result = await driver.post(`/api/rides/${ride.id}/claim`, { expectedVersion: ride.version });
  assert.equal(result.status, 200, JSON.stringify(result.body));
  return result.body.ride;
}
