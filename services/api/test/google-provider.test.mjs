import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, sign, createHash } from 'node:crypto';
import { OAuth2Client } from 'google-auth-library';
import { createGoogleConfig } from '../src/infrastructure/google-config.mjs';
import { createGoogleProvider } from '../src/infrastructure/google-provider.mjs';

const webId = 'test-web.apps.googleusercontent.com', nativeId = 'test-ios.apps.googleusercontent.com';
const env = { TAXI_AI_GOOGLE_CLIENT_ID: webId, TAXI_AI_GOOGLE_CLIENT_SECRET: 'fixture-secret-only',
  TAXI_AI_GOOGLE_REDIRECT_URI: 'http://localhost:3000/auth/google/callback', TAXI_AI_GOOGLE_NATIVE_CLIENT_IDS: nativeId };
const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const now = Math.floor(Date.now() / 1000), nonce = 'a'.repeat(64);
const payload = { sub: 'google-123', email: 'fixture@example.test', name: 'Test Person', email_verified: true,
  iss: 'https://accounts.google.com', aud: webId, iat: now, exp: now + 3600, nonce };
function jwt(p = payload, header = { alg: 'RS256', kid: 'fixture' }) {
  const content = [header, p].map((v) => Buffer.from(JSON.stringify(v)).toString('base64url')).join('.');
  return `${content}.${sign('RSA-SHA256', Buffer.from(content), privateKey).toString('base64url')}`;
}
function fixture() {
  const client = new OAuth2Client({ clientId: webId, clientSecret: env.TAXI_AI_GOOGLE_CLIENT_SECRET, redirectUri: env.TAXI_AI_GOOGLE_REDIRECT_URI });
  // Keep Google's real signature verifier; inject only its network/certificate port.
  client.getFederatedSignonCertsAsync = async () => ({ certs: { fixture: publicKey.export({ format: 'pem', type: 'spki' }) } });
  return { client, provider: createGoogleProvider({ config: createGoogleConfig(env), client, clock: () => now * 1000 }) };
}
test('Google configuration is optional, strict, origin-bound and rejects partial settings', () => {
  assert.equal(createGoogleConfig().enabled, false);
  assert.equal(createGoogleConfig(env).origin, 'http://localhost:3000');
  for (const patch of [{ TAXI_AI_GOOGLE_CLIENT_SECRET: '' }, { TAXI_AI_GOOGLE_CLIENT_ID: 'untrusted' },
    { TAXI_AI_GOOGLE_REDIRECT_URI: 'https://attacker.example/auth/google/callback' },
    { TAXI_AI_GOOGLE_REDIRECT_URI: 'http://127.0.0.1:3000/auth/google/callback' },
    { TAXI_AI_GOOGLE_REDIRECT_URI: env.TAXI_AI_GOOGLE_REDIRECT_URI + '?next=https://attacker.example' },
    { TAXI_AI_GOOGLE_NATIVE_CLIENT_IDS: nativeId + ',' }]) assert.throws(() => createGoogleConfig({ ...env, ...patch }));
  assert.equal(createGoogleConfig({ ...env, TAXI_AI_GOOGLE_REDIRECT_URI: 'https://taxi.example.test/auth/google/callback' },
    { mode: 'staging', publicOrigin: 'https://taxi.example.test' }).origin, 'https://taxi.example.test');
});
test('authorization uses narrow scopes, state, nonce and S256 PKCE; code exchange preserves verifier', async () => {
  const { client, provider } = fixture();
  const verifier = 'b'.repeat(64), state = 'c'.repeat(64);
  const url = new URL(provider.authorization({ state, nonce, verifier }));
  assert.equal(url.origin, 'https://accounts.google.com'); assert.equal(url.searchParams.get('state'), state);
  assert.equal(url.searchParams.get('nonce'), nonce); assert.equal(url.searchParams.get('scope'), 'openid email profile');
  assert.equal(url.searchParams.get('access_type'), 'online'); assert.equal(url.searchParams.get('code_challenge_method'), 'S256');
  assert.equal(url.searchParams.get('code_challenge'), createHash('sha256').update(verifier).digest('base64url'));
  client.getToken = async (data) => { assert.equal(data.codeVerifier, verifier); assert.equal(data.code, 'fixture-code');
    assert.equal(data.redirect_uri, env.TAXI_AI_GOOGLE_REDIRECT_URI); return { tokens: { id_token: jwt(), access_token: 'never-return-this' } }; };
  assert.deepEqual(await provider.exchange('fixture-code', nonce, verifier), { subject: payload.sub, email: payload.email, name: payload.name });
});
test('real RSA validation rejects forged signatures, invalid claims, expired tokens and wrong native presenters', async () => {
  const { provider } = fixture();
  assert.equal((await provider.verifyNative(jwt({ ...payload, azp: nativeId }), nonce)).subject, payload.sub);
  for (const patch of [{ iss: 'https://attacker.example' }, { aud: 'other-client' }, { azp: 'other-client' },
    { exp: now }, { iat: now + 61 }, { nonce: 'wrong' }, { email_verified: false }, { email_verified: 'true' },
    { sub: '' }, { sub: 'with space' }, { sub: 123 }, { email: null }, { exp: now + 90000 }]) {
    await assert.rejects(provider.verifyNative(jwt({ ...payload, ...patch }), nonce));
  }
  const bad = jwt().split('.'); bad[1] = Buffer.from(JSON.stringify({ ...payload, sub: 'forged' })).toString('base64url');
  await assert.rejects(provider.verifyNative(bad.join('.'), nonce));
  await assert.rejects(provider.verifyNative(jwt(payload, { alg: 'none', kid: 'fixture' }), nonce));
  await assert.rejects(provider.verifyNative('not-a-token', nonce));
});
test('Google SDK errors never disclose provider credentials or returned tokens', async () => {
  const { client, provider } = fixture();
  client.getToken = async () => { throw new Error(`https://provider.example?code=private-code&secret=${env.TAXI_AI_GOOGLE_CLIENT_SECRET}`); };
  await assert.rejects(provider.exchange('private-code', nonce, 'd'.repeat(64)), (error) => {
    assert.equal(error.code, 'GOOGLE_UNAVAILABLE'); assert.ok(!error.message.includes('private-code')); assert.ok(!error.message.includes('fixture-secret')); return true;
  });
});
test('provider transport disables SDK retries and redirects and applies a request deadline', async () => {
  const client = new OAuth2Client({ clientId: webId, clientSecret: env.TAXI_AI_GOOGLE_CLIENT_SECRET });
  let calls = 0;
  client.transporter.defaults.adapter = async (options) => {
    calls++; assert.equal(options.retry, false); assert.equal(options.retryConfig.retry, 0); assert.equal(options.redirect, 'error'); assert.equal(options.follow, 0);
    assert.ok(options.signal instanceof AbortSignal); throw new Error('fixture network failure');
  };
  const provider = createGoogleProvider({ config: createGoogleConfig(env), client });
  await assert.rejects(provider.exchange('fixture-code', nonce, 'b'.repeat(64)), { code: 'GOOGLE_UNAVAILABLE' });
  assert.equal(calls, 1);
});
