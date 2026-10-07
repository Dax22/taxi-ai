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


test('hosted calls cannot accidentally enable local-only media; malformed secrets fail closed', () => {
  for (const hosted of [{ NODE_ENV: 'production' }, { TAXI_AI_MODE: 'staging' }]) {
    assert.equal(createCallConfig(hosted).mode, 'off');
    assert.throws(() => createCallConfig({ ...hosted, TAXI_AI_CALLS_MODE: 'local' }), /configured relay/);
  }
  for (const secret of ['a'.repeat(32) + '\nno-auth', 'a'.repeat(32) + '\0', 'a'.repeat(1025), 'a'.repeat(31) + ' ']) {
    assert.throws(() => createCallConfig({ TAXI_AI_CALLS_MODE: 'relay',
      TAXI_AI_TURN_URLS: 'turns:relay.example.test:5349?transport=tcp', TAXI_AI_TURN_SECRET: secret }));
  }
});


test('relay can read the shared secret from the fixed Docker secret path without exposing it', () => {
  const secret='file-only-turn-shared-secret-32-characters';
  const env={TAXI_AI_CALLS_MODE:'relay',TAXI_AI_TURN_URLS:'turn:taxiai.app:3478?transport=udp',TAXI_AI_TURN_SECRET_FILE:'/run/secrets/turn_secret'};
  const config=createCallConfig(env,{readSecret:(path)=>{assert.equal(path,'/run/secrets/turn_secret');return secret+'\n';}});
  const rtc=config.rtc('call-file','user-file',10_000);
  assert.equal(config.describe().mode,'relay');
  assert.equal(rtc.iceServers[0].credential,createHmac('sha1',secret).update(rtc.iceServers[0].username).digest('base64'));
  assert.ok(!JSON.stringify([config,config.describe(),rtc]).includes(secret));
  assert.throws(()=>createCallConfig({...env,TAXI_AI_TURN_SECRET:'another-secret-that-is-long-enough'},{readSecret:()=>secret}),/either inline or as a Docker secret/);
  assert.throws(()=>createCallConfig({...env,TAXI_AI_TURN_SECRET_FILE:'/tmp/turn'},{readSecret:()=>secret}),/run\/secrets\/turn_secret/);
  assert.throws(()=>createCallConfig(env,{readSecret:()=>{throw new Error('missing');}}),/secret file is unavailable/);
});
