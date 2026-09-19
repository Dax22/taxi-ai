import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRuntimeConfig } from '../src/infrastructure/runtime-config.mjs';
import { createTelemetry } from '../src/infrastructure/telemetry.mjs';
import { createCallConfig } from '../src/infrastructure/call-config.mjs';
import { isInternalHealth, requestContext } from '../src/http/security.mjs';
import { harness, participants, PASSWORD, httpFetch } from './helpers.mjs';

// Fixed test values only. No deployed access keys, accounts or provider traffic.
const testerKey = 'a'.repeat(64), proxyKey = 'b'.repeat(64);
const hash = (text) => createHash('sha256').update(text).digest('hex');
function configuration(t) {
  const dir = mkdtempSync(join(tmpdir(), 'taxi-stage-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const file = join(dir, 'testers.json');
  writeFileSync(file, JSON.stringify({ version: 1, testers: [{ name: 'tester', tokenHash: hash(testerKey) }] }));
  const env = { TAXI_AI_MODE: 'staging', TAXI_AI_PUBLIC_ORIGIN: 'https://taxi.example.test', TAXI_AI_PROXY_TOKEN: proxyKey,
    TAXI_AI_DB: join(dir, 'app.sqlite'), TAXI_AI_STAGING_ACCESS_FILE: file };
  return { env, file, runtime: createRuntimeConfig(env) };
}
const gatewayHeaders = { Host: 'taxi.example.test', 'X-Taxi-Ai-Proxy-Token': proxyKey, 'X-Forwarded-Proto': 'https',
  'X-Forwarded-For': '192.0.2.10', Authorization: `Basic ${Buffer.from('tester:' + testerKey).toString('base64')}` };
async function setup(t, options = {}) {
  const { runtime } = configuration(t), logs = [];
  const h = await harness(t, { runtime, gatewayHeaders, callConfig: createCallConfig({ TAXI_AI_CALLS_MODE: 'off' }),
    telemetry: createTelemetry({ write: (line) => logs.push(JSON.parse(line)) }), ...options });
  return { h, runtime, logs };
}

test('staging fails closed for incomplete configuration; local mode keeps loopback defaults', (t) => {
  const { env, file } = configuration(t);
  assert.equal(createRuntimeConfig({}).host, '127.0.0.1');
  assert.throws(() => createRuntimeConfig({ NODE_ENV: 'production' }));
  for (const name of ['TAXI_AI_PUBLIC_ORIGIN', 'TAXI_AI_DB', 'TAXI_AI_PROXY_TOKEN', 'TAXI_AI_STAGING_ACCESS_FILE']) {
    assert.throws(() => createRuntimeConfig({ ...env, [name]: '' }), name);
  }
  for (const origin of ['http://taxi.example.test', 'https://name:secret@taxi.example.test', 'https://taxi.example.test/path',
    'https://taxi.example.test?secret=x', 'https://localhost', 'https://127.0.0.1', 'https://taxi.example.test/#fragment']) {
    assert.throws(() => createRuntimeConfig({ ...env, TAXI_AI_PUBLIC_ORIGIN: origin }), origin);
  }
  assert.throws(() => createRuntimeConfig({ ...env, TAXI_AI_DB: ':memory:' }));
  assert.throws(() => createRuntimeConfig({ ...env, TAXI_AI_BIND: 'not-a-bind-address' }));
  writeFileSync(file, '{"version":1,"testers":[]}'); assert.throws(() => createRuntimeConfig(env));
  writeFileSync(file, 'not-json'); assert.throws(() => createRuntimeConfig(env));
});

test('HTTPS gateway and tester gates protect all content; forwarded headers cannot select a host or bypass access', async (t) => {
  const { h } = await setup(t);
  assert.equal((await fetch(h.base + '/app')).status, 403);
  for (const path of ['/', '/app', '/dashboard.mjs', '/assets/taxi-hero.webp', '/api/session', '/health/ready']) {
    const missing = { ...gatewayHeaders }; delete missing.Authorization;
    const response = await httpFetch(h.base + path, { headers: missing });
    assert.equal(response.status, 401, path); assert.match(response.headers.get('www-authenticate'), /private preview/); await response.text();
  }
  const client = h.client();
  for (const headers of [{ Host: 'evil.test' }, { 'X-Taxi-Ai-Proxy-Token': 'c'.repeat(64) },
    { 'X-Taxi-Ai-Proxy-Token': null }, { 'X-Forwarded-Proto': 'http' }, { 'X-Forwarded-For': '192.0.2.10, 192.0.2.11' }]) {
    assert.equal((await client.send('/api/session', { headers })).status, 403);
  }
  assert.equal((await client.send('/api/session', { headers: { 'X-Forwarded-Host': 'evil.test' } })).status, 200, 'forwarded host is ignored');
  assert.equal((await client.send('/api/session', { headers: { Authorization: `Basic ${Buffer.from('unknown:' + testerKey).toString('base64')}` } })).status, 401);
  const page = await httpFetch(h.base + '/app', { headers: gatewayHeaders });
  assert.equal(page.status, 200); assert.equal(page.headers.get('strict-transport-security'), 'max-age=86400');
  assert.match(page.headers.get('x-robots-tag'), /noindex/); await page.text();
});

test('host-only secure cookies, origin and CSRF checks remain enforced behind the gateway', async (t) => {
  const { h } = await setup(t), client = h.client();
  const registered = await client.register('stage-customer');
  const cookie = registered.headers.get('set-cookie');
  assert.match(cookie, /^__Host-taxi_ai_session=/); assert.match(cookie, /; Secure$/); assert.ok(!cookie.includes('Domain='));
  const old = h.client(); old.cookie = client.cookie;
  assert.equal((await client.post('/api/auth/login', { email: client.user.email, password: PASSWORD })).status, 200);
  assert.equal((await old.send('/api/rides')).status, 401);
  old.cookie = client.cookie.replace('__Host-taxi_ai_session', 'taxi_ai_session');
  assert.equal((await old.send('/api/rides')).status, 401, 'local cookies cannot authenticate a staging session');
  for (const headers of [{ Origin: 'http://taxi.example.test' }, { Origin: 'https://evil.test' }, { Origin: null }, { 'X-CSRF-Token': 'bad' }]) {
    assert.equal((await client.send('/api/auth/logout', { method: 'POST', data: {}, headers })).status, 403);
  }
  const logout = await client.post('/api/auth/logout');
  assert.match(logout.headers.get('set-cookie'), /^__Host-taxi_ai_session=;/); assert.match(logout.headers.get('set-cookie'), /Max-Age=0; Secure/);
});

test('authentication limits use the authenticated gateway address; local mode ignores forwarded identity', async (t) => {
  const { h } = await setup(t), client = h.client();
  for (let i = 0; i < 30; i++) assert.equal((await client.post('/api/auth/login', {})).status, 400);
  assert.equal((await client.post('/api/auth/login', {})).status, 429);
  assert.equal((await client.send('/api/auth/login', { method: 'POST', data: {}, headers: { 'X-Forwarded-For': '192.0.2.11' } })).status, 400);
  const request = { method: 'GET', headers: { host: 'localhost:3000', 'x-forwarded-for': '192.0.2.1' }, socket: { remoteAddress: '127.0.0.1', localPort: 3000 } };
  assert.equal(requestContext(request, createRuntimeConfig({})).clientAddress, '127.0.0.1');
  assert.equal(isInternalHealth(request, '/health/ready'), true);
  assert.equal(isInternalHealth({ ...request, socket: { ...request.socket, remoteAddress: '192.0.2.1' } }, '/health/ready'), false);
  assert.equal(isInternalHealth(request, '/api/session'), false);
});

test('health checks, shutdown and operational logs expose no account, URL, GPS or credential data', async (t) => {
  const { h, logs } = await setup(t);
  assert.deepEqual(await (await fetch(h.base + '/health/ready')).json(), { status: 'ready' });
  const probe = await httpFetch(h.base + '/api/session?token=do-not-log', { headers: gatewayHeaders });
  const id = probe.headers.get('x-request-id'); assert.match(id, /^[a-f0-9-]{36}$/); await probe.text();
  h.db.exec("CREATE TRIGGER fail_session_read BEFORE INSERT ON rate_limits BEGIN SELECT RAISE(ABORT, 'SECRET_INTERNAL_DETAIL'); END");
  assert.equal((await h.client().post('/api/auth/login', {})).status, 500);
  h.db.exec('DROP TRIGGER fail_session_read');
  h.beginShutdown();
  assert.equal((await fetch(h.base + '/health/ready')).status, 503);
  assert.equal((await fetch(h.base + '/health/live')).status, 200);
  assert.equal((await h.client().send('/api/session')).status, 503);
  const serialized = JSON.stringify(logs);
  for (const secret of [testerKey, proxyKey, gatewayHeaders.Authorization, '192.0.2.10', 'do-not-log', 'SECRET_INTERNAL_DETAIL', '/api/session']) assert.ok(!serialized.includes(secret), secret);
  assert.ok(logs.some((entry) => entry.requestId === id)); assert.ok(logs.some((entry) => entry.status === 500));
});

test('a complete routed ride, chat, call signaling and GPS survive staging isolation and restart, then close together', async (t) => {
  const pickup = { lat: 9.08, lng: 7.4, name: 'Test pickup' }, destination = { lat: 9.1, lng: 7.45, name: 'Test destination' };
  const mapProvider = { mode: 'off', describe: () => ({ enabled: false }),
    route: async () => ({ distanceMeters: 7000, durationSeconds: 1200, coordinates: [[7.4, 9.08], [7.45, 9.1]] }) };
  const { h } = await setup(t, { persistent: true, mapProvider,
    callConfig: createCallConfig({ TAXI_AI_CALLS_MODE: 'relay', TAXI_AI_TURN_URLS: 'turns:relay.example.test:5349', TAXI_AI_TURN_SECRET: 'test-only-relay-secret-32-characters' }) });
  const { customer, driver } = await participants(h);
  assert.equal((await driver.availability('/api/availability/online', { mode: 'sample', areaId: 'wuse-ii' })).status, 403);
  assert.equal((await customer.post('/api/rides', { pickupId: 'wuse-ii', destinationId: 'maitama' })).status, 403);
  assert.equal((await customer.send('/api/rides')).body.matchingSettings.allowSimulation, false);
  const quote = (await customer.post('/api/locations/quotes', { pickup, destination })).body.quote;
  let ride = (await customer.post('/api/rides', { quoteId: quote.id })).body.ride;
  const mutate = async (actor, action, extra = {}) => {
    const response = await actor.post(`/api/rides/${ride.id}/${action}`, { expectedVersion: ride.version, ...extra });
    assert.equal(response.status, 200, JSON.stringify(response.body)); ride = response.body.ride;
  };
  await mutate(driver, 'claim');
  const chat = await customer.post(`/api/rides/${ride.id}/chat/messages`, { body: 'Meet at the test pickup.' });
  assert.equal(chat.status, 201, JSON.stringify(chat.body));
  const caller = randomUUID(), callee = randomUUID();
  const callWrite = (actor, window, path, data) => actor.send(path, { method: 'POST', data,
    headers: { 'X-Call-Client': window, 'Idempotency-Key': randomUUID() } });
  const created = await callWrite(customer, caller, `/api/rides/${ride.id}/calls`, {});
  assert.equal(created.status, 201); const call = created.body.call;
  assert.equal((await callWrite(driver, callee, `/api/calls/${call.id}/accept`, { expectedVersion: call.version })).status, 200);
  const sdp = 'v=0\r\no=- 1 1 IN IP4 0.0.0.0\r\ns=-\r\nt=0 0\r\nm=audio 9 UDP/TLS/RTP/SAVPF 111\r\na=ice-ufrag:example\r\na=ice-pwd:example-test-password\r\na=fingerprint:sha-256 AA:BB:CC\r\na=candidate:1 1 UDP 100 192.0.2.5 12345 typ relay\r\n';
  assert.equal((await callWrite(customer, caller, `/api/calls/${call.id}/signal`, { type: 'offer', sdp })).status, 200);
  assert.equal((await callWrite(driver, callee, `/api/calls/${call.id}/signal`, { type: 'answer', sdp })).status, 200);
  await mutate(driver, 'offers', { amountKobo: 500000 }); await mutate(customer, 'offers', { amountKobo: 470000 });
  await mutate(driver, 'accept', { offerId: ride.negotiation.currentOffer.id }); await mutate(customer, 'confirm');
  const pin = ride.trip.pickupPin, locationWindow = randomUUID();
  const location = (path, data = {}) => driver.send(path, { method: 'POST', data,
    headers: { 'X-Location-Client': locationWindow, 'Idempotency-Key': randomUUID() } });
  const started = await location(`/api/rides/${ride.id}/location/start`); assert.equal(started.status, 200);
  const share = started.body.share;
  assert.equal((await location(`/api/location-shares/${share.id}/position`, { sequence: 1, lat: pickup.lat, lng: pickup.lng, accuracy: 10, capturedAt: 1000000 })).status, 200);
  await h.restart();
  assert.equal((await customer.send(`/api/rides/${ride.id}`)).body.ride.trip.pickupPin, pin);
  assert.equal((await customer.send(`/api/rides/${ride.id}/location`)).body.share.position.lat, pickup.lat);
  for (const action of ['depart', 'arrive', 'start', 'complete']) await mutate(driver, action, action === 'start' ? { pickupPin: pin } : {});
  assert.equal((await customer.send(`/api/rides/${ride.id}/location`)).body.share, null);
  assert.equal((await customer.send('/api/calls')).body.active, null);
  assert.equal((await customer.send('/api/rides/history')).body.rides[0].negotiation.agreement.amountKobo, 470000);
  const payment = await customer.send(`/api/payments/rides/${ride.id}`);
  assert.equal(payment.body.payment.amountKobo, 470000); assert.equal(payment.body.payment.status, 'unpaid');
  assert.equal(payment.body.settings.canSimulate, false);
  assert.equal((await customer.post(`/api/payments/rides/${ride.id}/start`, { expectedVersion: 0 })).status, 403);
  assert.equal((await driver.send('/api/driver/earnings')).body.summary.simulatedPaidKobo, '0');
});
