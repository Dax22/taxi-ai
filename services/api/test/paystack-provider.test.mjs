import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { createPaystackConfig } from '../src/infrastructure/paystack-config.mjs';
import { createPaystackProvider } from '../src/infrastructure/paystack-provider.mjs';

const secretKey = 'sk_test_' + 'a'.repeat(40);
const config = createPaystackConfig({ TAXI_AI_PAYMENT_PROVIDER: 'paystack_test', PAYSTACK_SECRET_KEY: secretKey }, { mode: 'local', port: 3003 });
const json = data => new Response(JSON.stringify({ status: true, data }), { headers: { 'Content-Type': 'application/json' } });

test('configuration is off by default, live mode needs two explicit gates, and paused verification keeps its key mode', async () => {
  assert.equal(createPaystackConfig({}).enabled, false);
  assert.equal(config.callbackUrl, 'http://localhost:3003/payment-return');
  const liveKey = 'sk_live_' + 'b'.repeat(40);
  assert.throws(() => createPaystackConfig({ TAXI_AI_PAYMENT_PROVIDER: 'paystack_live', PAYSTACK_SECRET_KEY: liveKey }, { mode: 'staging', publicOrigin: 'https://taxiai.app' }), /LIVE_ENABLED/);
  assert.throws(() => createPaystackConfig({ TAXI_AI_PAYMENT_PROVIDER: 'paystack_live', TAXI_AI_PAYSTACK_LIVE_ENABLED: 'true', PAYSTACK_SECRET_KEY: secretKey }, { mode: 'staging', publicOrigin: 'https://taxiai.app' }), /sk_live/);
  const live = createPaystackConfig({ TAXI_AI_PAYMENT_PROVIDER: 'paystack_live', TAXI_AI_PAYSTACK_LIVE_ENABLED: 'true', PAYSTACK_SECRET_KEY: liveKey }, { mode: 'staging', publicOrigin: 'https://taxiai.app' });
  assert.equal(live.enabled, true); assert.equal(live.mode, 'live'); assert.equal(live.callbackUrl, 'https://taxiai.app/payment-return');
  assert.throws(() => createPaystackConfig({ TAXI_AI_PAYMENT_PROVIDER: 'paystack_test', PAYSTACK_SECRET_KEY: liveKey }), /sk_test/);
  assert.throws(() => createPaystackConfig({ TAXI_AI_PAYMENT_PROVIDER: 'paystack_test' }));
  assert.throws(() => createPaystackConfig({ TAXI_AI_PAYMENT_PROVIDER: 'paystack_test', PAYSTACK_SECRET_KEY: secretKey }, { mode: 'staging', publicOrigin: 'http://app.example.test' }));
  const paused = createPaystackProvider({ config: createPaystackConfig({ TAXI_AI_PAYMENT_PROVIDER: 'off', PAYSTACK_SECRET_KEY: secretKey }),
    fetchImpl: async () => json({ reference: 'TEST', status: 'pending', amount: 10000, currency: 'NGN', domain: 'test', id: 123 }) });
  assert.equal(paused.enabled, false); assert.equal(paused.configured, true); assert.equal(paused.mode, 'test');
  assert.equal((await paused.verify('TEST')).status, 'pending');
  await assert.rejects(paused.initialize({}), { code: 'PAYMENTS_DISABLED' });
});

test('hosted initialization sends exact server money and fixed return URL without exposing raw provider data', async () => {
  const requests = [];
  const provider = createPaystackProvider({ config, fetchImpl: async (url, options) => {
    requests.push({ url, options }); return json({ reference: 'TEST', authorization_url: 'https://checkout.paystack.com/test-code', access_code: 'private-provider-code', customer: { email: 'private@example.test' } });
  } });
  const result = await provider.initialize({ email: 'payer@example.test', amountKobo: 250001, reference: 'TEST' });
  assert.deepEqual(result, { reference: 'TEST', checkoutUrl: 'https://checkout.paystack.com/test-code' });
  assert.equal(requests.length, 1); assert.equal(requests[0].url, 'https://api.paystack.co/transaction/initialize');
  assert.equal(requests[0].options.redirect, 'error');
  assert.deepEqual(JSON.parse(requests[0].options.body), { email: 'payer@example.test', amount: 250001, currency: 'NGN', reference: 'TEST', callback_url: config.callbackUrl });
});

test('provider failures never automatically retry or leak upstream secrets; response bounds and checkout allowlist fail closed', async () => {
  for (const response of [
    () => new Response(secretKey, { status: 500 }),
    () => new Response('x'.repeat(65_537)),
    () => json({ reference: 'OTHER', authorization_url: 'https://checkout.paystack.com/test' }),
    ...['http://checkout.paystack.com/test', 'https://checkout.paystack.com.evil.test/test', 'https://user@checkout.paystack.com/test', 'https://checkout.paystack.com:8443/test'].map(url => () => json({ reference: 'TEST', authorization_url: url })),
  ]) {
    let calls = 0;
    const provider = createPaystackProvider({ config, fetchImpl: async () => { calls++; return response(); } });
    await assert.rejects(provider.initialize({ email: 'payer@example.test', amountKobo: 100, reference: 'TEST' }), error => error.code === 'PAYSTACK_UNAVAILABLE' && !error.message.includes(secretKey));
    assert.equal(calls, 1);
  }
});

test('webhook HMAC covers exact original bytes and rejects malformed or changed signatures', () => {
  const provider = createPaystackProvider({ config });
  const raw = Buffer.from('{"event":"charge.success", "data":{"reference":"TEST"}}');
  const signature = createHmac('sha512', secretKey).update(raw).digest('hex');
  assert.equal(provider.verifyWebhook(raw, signature), true);
  assert.equal(provider.verifyWebhook(Buffer.from(raw.toString().replace(', ', ',')), signature), false);
  for (const value of [undefined, '', '0'.repeat(128), signature.slice(1), [signature]]) assert.equal(provider.verifyWebhook(raw, value), false);
});
