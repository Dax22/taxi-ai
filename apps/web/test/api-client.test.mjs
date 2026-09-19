import test from 'node:test';
import assert from 'node:assert/strict';
import { createApiClient } from '../public/dashboard/api-client.mjs';

const response = (status, body) => ({ ok: status < 400, status, json: async () => body });

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
