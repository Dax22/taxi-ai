import test from 'node:test';
import assert from 'node:assert/strict';
import { createApiClient } from '../public/dashboard/api-client.mjs';

const response = (status, body) => ({ ok: status < 400, status, json: async () => body });

test('driver face comparison has time for bounded provider processing and still aborts stalled requests', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let finish, signal;
  const client = createApiClient({ fetchImpl: (path, options) => {
    signal = options.signal; return new Promise(resolve => { finish = resolve; });
  } });
  const comparison = client.command('/api/driver/application/face-check', { expectedVersion: 2, consent: true });
  t.mock.timers.tick(35_000); assert.equal(signal.aborted, false, 'image processing and a 30-second provider call can finish');
  t.mock.timers.tick(10_001); assert.equal(signal.aborted, true, 'a stuck transport is bounded');
  finish(response(200, { application: {} })); await comparison;
});

test('a lost response retries the same command key and keeps the original offer/version', async () => {
  const calls = [];
  let sequence = 0;
  const client = createApiClient({ makeKey: () => `key-${++sequence}`, fetchImpl: async (path, options) => {
    calls.push({ path, options });
    if (calls.length === 1) throw new Error('connection lost');
    return response(200, { ride: { id: 'ride-1' } });
  } });
  client.setCsrf('session-csrf');
  const data = { expectedVersion: 3, offerId: 'ride-1:offer:2' };
  await assert.rejects(client.rideCommand('/api/rides/ride-1/accept', data), /Connection interrupted/);
  await client.rideCommand('/api/rides/ride-1/accept', data);
  assert.equal(calls[0].options.headers['Idempotency-Key'], calls[1].options.headers['Idempotency-Key']);
  assert.equal(calls[1].options.headers['X-CSRF-Token'], 'session-csrf');
  assert.deepEqual(JSON.parse(calls[1].options.body), data);
  assert.equal(calls[1].options.credentials, 'same-origin');
});

test('a truncated JSON response retains the retry key and a stale-price rejection is never auto-retried', async () => {
  const calls = [];
  const client = createApiClient({ makeKey: () => 'same-key', fetchImpl: async (path, options) => {
    calls.push(options);
    if (calls.length === 1) return { ok: true, json: async () => { throw new Error('truncated body'); } };
    return response(409, { error: { code: 'STALE_VERSION', message: 'Review the new offer.' } });
  } });
  const command = { expectedVersion: 1, offerId: 'old-offer' };
  await assert.rejects(client.rideCommand('/api/rides/id/accept', command), /Connection interrupted/);
  await assert.rejects(client.rideCommand('/api/rides/id/accept', command), { status: 409, code: 'STALE_VERSION' });
  assert.equal(calls.length, 2);
  assert.equal(calls[0].headers['Idempotency-Key'], calls[1].headers['Idempotency-Key']);
});

test('reset drops credentials/retry keys and external API destinations are rejected', async () => {
  const calls = [];
  let sequence = 0;
  const client = createApiClient({ makeKey: () => `key-${++sequence}`, fetchImpl: async (path, options) => {
    calls.push(options); throw new Error('offline');
  } });
  client.setCsrf('old-session');
  await assert.rejects(client.rideCommand('/api/rides', { pickupId: 'jabi' }));
  client.reset();
  await assert.rejects(client.rideCommand('/api/rides', { pickupId: 'jabi' }));
  assert.notEqual(calls[0].headers['Idempotency-Key'], calls[1].headers['Idempotency-Key']);
  assert.equal(calls[1].headers['X-CSRF-Token'], undefined);
  await assert.rejects(client.request('https://example.com/api'), /same-origin/);
  assert.equal(calls.length, 2);
});

test('chat retries reuse the key, while intentionally sending identical text again gets a fresh key', async () => {
  const keys = []; let issued = 0;
  const client = createApiClient({ makeKey: () => `key-${++issued}`, fetchImpl: async (path, options) => {
    keys.push(options.headers['Idempotency-Key']);
    if (keys.length === 1) throw new Error('Lost response');
    return response(201, { message: { id: 'saved' } });
  } });
  const path = '/api/rides/ride-1/chat/messages', data = { body: 'Hello' };
  await assert.rejects(client.command(path, data));
  await client.command(path, data);
  await client.command(path, data);
  assert.deepEqual(keys, ['key-1', 'key-1', 'key-2']);
});

test('call retry keys stay tied to the browser window and carry its identity on media requests', async () => {
  const calls = []; let issued = 0;
  const client = createApiClient({ makeKey: () => `key-${++issued}`, fetchImpl: async (path, options) => {
    calls.push(options);
    if (options.method === 'POST') throw new Error('Lost response');
    return response(200, {});
  } });
  const path = '/api/calls/call-one/signal', data = { type: 'offer', sdp: 'same-sdp' };
  for (const callClient of ['first-window', 'second-window', 'first-window']) {
    await assert.rejects(client.command(path, data, { callClient }));
  }
  assert.deepEqual(calls.map((r) => r.headers['Idempotency-Key']), ['key-1', 'key-2', 'key-1']);
  await client.request('/api/calls/call-one/media', { callClient: 'first-window' });
  assert.equal(calls.at(-1).headers['X-Call-Client'], 'first-window');
});

test('late responses from a reset session cannot update the clock or delete a newer command retry key', async () => {
  let finishOld, finishNew, issued = 0;
  const calls = [], times = [];
  const client = createApiClient({ makeKey: () => `key-${++issued}`, onServerTime: (now) => times.push(now),
    fetchImpl: async (path, options) => {
      calls.push(options.headers['Idempotency-Key']);
      if (calls.length === 1) return new Promise((resolve) => { finishOld = resolve; });
      if (calls.length === 2) return new Promise((resolve) => { finishNew = resolve; });
      return response(201, { serverNow: 2000, ride: { id: 'new' } });
    } });
  const data = { pickupId: 'wuse-ii', destinationId: 'maitama' };
  const old = client.command('/api/rides', data);
  const rejected = assert.rejects(old, { code: 'SESSION_CHANGED' });
  client.reset();
  const next = client.command('/api/rides', data);
  const interrupted = assert.rejects(next, /Connection interrupted/);
  finishOld(response(201, { serverNow: 1000, ride: { id: 'old' } })); await rejected;
  finishNew({ ok: true, json: async () => { throw new Error('Truncated'); } }); await interrupted;
  await client.command('/api/rides', data);
  assert.deepEqual(calls, ['key-1', 'key-2', 'key-2']); assert.deepEqual(times, [2000]);
});

test('mode changes reject late reads, preserve uncertain keys in their mode and cannot interrupt a write', async () => {
  let resolveRead, resolveWrite, issued = 0;
  const keys = [], times = [];
  const client = createApiClient({ makeKey: () => `mode-key-${++issued}`, onServerTime: (time) => times.push(time),
    fetchImpl: async (path, options) => {
      if (path === '/api/pending-read') return new Promise((resolve) => { resolveRead = resolve; });
      if (path === '/api/pending-write') return new Promise((resolve) => { resolveWrite = resolve; });
      keys.push(options.headers['Idempotency-Key']); throw new Error('lost response');
    } });
  client.setCsrf('same-account'); client.setMode('customer');
  const read = client.request('/api/pending-read'); const late = assert.rejects(read, { code: 'SESSION_CHANGED' });
  await assert.rejects(client.command('/api/action', {}));
  client.setMode('work');
  resolveRead(response(200, { serverNow: 1000 })); await late; assert.deepEqual(times, []);
  await assert.rejects(client.command('/api/action', {}));
  client.setMode('customer'); await assert.rejects(client.command('/api/action', {}));
  assert.deepEqual(keys, ['mode-key-1', 'mode-key-2', 'mode-key-1']);
  const writing = client.request('/api/pending-write', { method: 'POST', data: {} });
  assert.equal(client.pendingWrites(), true); assert.throws(() => client.setMode('work'), /current action/);
  resolveWrite(response(200, {})); await writing; assert.equal(client.pendingWrites(), false);
});

test('a long-poll caller can abort its request without leaving a pending write', async () => {
  let transportSignal;
  const client = createApiClient({ fetchImpl: async (_path, options) => {
    transportSignal = options.signal;
    return new Promise((_resolve, reject) => options.signal.addEventListener('abort', () => reject(new Error('Aborted')), { once: true }));
  } });
  const controller = new AbortController();
  const pending = client.request('/api/events?cursor=0&wait=25000', { signal: controller.signal });
  controller.abort();
  await assert.rejects(pending, /Connection interrupted/);
  assert.equal(transportSignal.aborted, true); assert.equal(client.pendingWrites(), false);
});
