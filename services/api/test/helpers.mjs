import assert from 'node:assert/strict';
import { once } from 'node:events';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createAppServer } from '../../../apps/web/server.mjs';
import { openDatabase } from '../src/infrastructure/database.mjs';
import { createApplication } from '../src/application.mjs';

export const bootstrapAdmin = (db, email) => createApplication({ db }).accounts.bootstrapAdmin(email);

// Test fixtures only. No accounts or passwords are seeded into the application.
export const PASSWORD = 'A long test-only password 123';

export async function harness(t, { persistent = false } = {}) {
  const folder = persistent ? await mkdtemp(join(tmpdir(), 'taxi-ai-test-')) : null;
  const filename = folder ? join(folder, 'test.sqlite') : ':memory:';
  let now = 1_000_000, server, db, base, stopped = true;
  async function start() {
    db = openDatabase(filename);
    server = createAppServer({ db, clock: () => now });
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    base = `http://127.0.0.1:${server.address().port}`;
    stopped = false;
  }
  async function stop() {
    if (stopped) return;
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    stopped = true;
  }
  await start();
  t.after(async () => { await stop(); if (folder) await rm(folder, { recursive: true, force: true }); });
  return { get db() { return db; }, get base() { return base; },
    advance(ms) { now += ms; }, async restart() { await stop(); await start(); },
    client() {
      const client = { cookie: '', csrf: '', user: null };
      client.send = async (path, { method = 'GET', data, headers = {}, rawBody } = {}) => {
        const requestHeaders = { ...(client.cookie ? { Cookie: client.cookie } : {}),
          ...(method === 'POST' ? { Origin: base, 'Content-Type': 'application/json', 'X-CSRF-Token': client.csrf } : {}), ...headers };
        for (const key of Object.keys(requestHeaders)) if (requestHeaders[key] === null) delete requestHeaders[key];
        const response = await fetch(base + path, { method, headers: requestHeaders,
          ...(method === 'POST' ? { body: rawBody ?? JSON.stringify(data ?? {}) } : {}) });
        const cookie = response.headers.get('set-cookie');
        if (cookie) client.cookie = cookie.split(';')[0];
        const body = await response.json();
        if (Object.hasOwn(body, 'csrfToken')) client.csrf = body.csrfToken;
        if (Object.hasOwn(body, 'user')) client.user = body.user;
        return { status: response.status, body, headers: response.headers };
      };
      client.post = (path, data, key = randomUUID()) => client.send(path, { method: 'POST', data, headers: { 'Idempotency-Key': key } });
      client.register = async (name, role = 'customer') => {
        const result = await client.post('/api/auth/register', { name, email: `${name}@example.test`, password: PASSWORD, role,
          ...(role === 'driver' ? { vehicle: { model: 'Toyota Corolla', plate: `TEST-${name.slice(0, 5)}` } } : {}) });
        assert.equal(result.status, 201, JSON.stringify(result.body));
        return result;
      };
      return client;
    } };
}

export async function participants(h, driverCount = 1) {
  const customer = h.client(); await customer.register('customer');
  const admin = h.client(); await admin.register('operator');
  bootstrapAdmin(h.db, admin.user.email);
  const login = await admin.post('/api/auth/login', { email: admin.user.email, password: PASSWORD });
  assert.equal(login.status, 200);
  const drivers = [];
  for (let i = 0; i < driverCount; i++) {
    const driver = h.client(); await driver.register(`driver${i}`, 'driver');
    const result = await admin.post(`/api/admin/drivers/${driver.user.id}/review`, { decision: 'approved' });
    assert.equal(result.status, 200);
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
  const result = await driver.post(`/api/rides/${ride.id}/claim`, { expectedVersion: ride.version });
  assert.equal(result.status, 200, JSON.stringify(result.body));
  return result.body.ride;
}

