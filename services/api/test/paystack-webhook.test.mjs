import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, createHmac } from 'node:crypto';
import { createPaystackProvider } from '../src/infrastructure/paystack-provider.mjs';
import { createPaystackConfig } from '../src/infrastructure/paystack-config.mjs';
import { createCallConfig } from '../src/infrastructure/call-config.mjs';
import { harness, httpFetch } from './helpers.mjs';

const secretKey = 'sk_test_' + 'a'.repeat(40);
const proxyToken = 'b'.repeat(64), testerToken = 'c'.repeat(64);
const runtime = { mode: 'staging', publicOrigin: 'https://taxi.example.test', proxyToken,
  testers: new Map([['tester', createHash('sha256').update(testerToken).digest('hex')]]) };
const gateway = { Host: 'taxi.example.test', 'X-Taxi-Ai-Proxy-Token': proxyToken, 'X-Forwarded-Proto': 'https', 'X-Forwarded-For': '192.0.2.10' };

test('only the configured POST webhook skips staging tester cookies; signature and trusted gateway remain mandatory', async t => {
  const paystackProvider = createPaystackProvider({ config: createPaystackConfig({ TAXI_AI_PAYMENT_PROVIDER: 'paystack_test', PAYSTACK_SECRET_KEY: secretKey }, runtime), fetchImpl: async () => { throw new Error('Unknown webhook references must not contact provider'); } });
  const h = await harness(t, { runtime, paystackProvider, callConfig: createCallConfig({ TAXI_AI_CALLS_MODE: 'off' }) });
  const raw = JSON.stringify({ event: 'charge.success', data: { reference: 'TA-TEST-11111111-1111-4111-8111-111111111111' } });
  const signature = createHmac('sha512', secretKey).update(raw).digest('hex');
  const send = (path, headers = {}, body = raw, method = 'POST') => httpFetch(h.base + path, { method, headers: { ...gateway, 'Content-Type': 'application/json', ...headers }, ...(method === 'POST' ? { body } : {}) });
  const valid = await send('/api/webhooks/paystack', { 'X-Paystack-Signature': signature });
  assert.equal(valid.status, 200); assert.deepEqual(await valid.json(), { received: true });
  assert.equal((await send('/api/webhooks/paystack')).status, 403);
  assert.equal((await send('/api/webhooks/paystack', { 'X-Paystack-Signature': signature }, raw + ' ')).status, 403);
  assert.equal((await send('/api/webhooks/paystack', { 'X-Taxi-Ai-Proxy-Token': 'd'.repeat(64), 'X-Paystack-Signature': signature })).status, 403);
  assert.equal((await send('/api/webhooks/paystack', {}, '', 'GET')).status, 401);
  assert.equal((await send('/api/webhooks/paystack/')).status, 401);
  assert.equal((await send('/api/checkout-payments/ride/11111111-1111-4111-8111-111111111111/start')).status, 401);
  assert.equal((await send('/api/webhooks/paystack', {}, 'x'.repeat(65_537))).status, 413);
});

test('a disabled unconfigured webhook does not become a new public staging route', async t => {
  const h = await harness(t, { runtime, callConfig: createCallConfig({ TAXI_AI_CALLS_MODE: 'off' }) });
  const response = await httpFetch(h.base + '/api/webhooks/paystack', { method: 'POST', headers: { ...gateway, 'Content-Type': 'application/json' }, body: '{}' });
  assert.equal(response.status, 401);
});
