import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { createCallConfig } from '../src/infrastructure/call-config.mjs';

test('relay configuration fails closed and issues expiring per-call credentials without exposing its shared secret', () => {
  const env = { TAXI_AI_CALLS_MODE: 'relay', TAXI_AI_TURN_URLS: 'turn:relay.example.test:3478?transport=udp,turns:relay.example.test:5349?transport=tcp',
    TAXI_AI_TURN_SECRET: 'test-only-32-character-turn-server-secret' };
  for (const replacement of [{ TAXI_AI_CALLS_MODE: 'invalid' }, { TAXI_AI_TURN_URLS: '' },
    { TAXI_AI_TURN_URLS: 'stun:example.test' }, { TAXI_AI_TURN_URLS: 'turn:user:password@host' },
    { TAXI_AI_TURN_URLS: 'turn:example.test:65536' }, { TAXI_AI_TURN_URLS: 'turn:example.test:0' },
    { TAXI_AI_TURN_SECRET: 'short' }, { TAXI_AI_TURN_URLS: 'turn:host?transport=invalid' }]) {
    assert.throws(() => createCallConfig({ ...env, ...replacement }));
  }
  const config = createCallConfig(env);
  assert.equal(config.describe().mode, 'relay');
  const rtc = config.rtc('call-one', 'customer-one', 10_000);
  assert.equal(rtc.iceTransportPolicy, 'relay');
  assert.equal(rtc.iceServers[0].username, '3610:call-one:customer-one');
  assert.equal(rtc.iceServers[0].credential, createHmac('sha1', env.TAXI_AI_TURN_SECRET).update(rtc.iceServers[0].username).digest('base64'));
  assert.notEqual(config.rtc('call-two', 'customer-one', 10_000).iceServers[0].credential, rtc.iceServers[0].credential);
  assert.ok(!JSON.stringify([config, config.describe(), rtc]).includes(env.TAXI_AI_TURN_SECRET));
  assert.deepEqual(createCallConfig({}).rtc('call', 'user', 0).iceServers, []);
});
