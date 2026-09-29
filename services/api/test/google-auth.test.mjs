import { removeEatsFixtureTables } from './migration-fixtures.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { harness, PASSWORD, bootstrapAdmin } from './helpers.mjs';
import { SCHEMA_VERSION } from '../src/infrastructure/database.mjs';

const identity = { subject: 'google-customer-1', email: 'google@example.test', name: 'Google Customer' };
async function fixture(t, options = {}) {
  const state = { identity: { ...identity }, calls: 0, fail: false, beforeVerify: null };
  const provider = { config: { enabled: true, nativeClientIds: ['ios-fixture.apps.googleusercontent.com'], clientId: 'web-fixture.apps.googleusercontent.com', origin: null },
    authorization({ state, nonce }) { return `https://accounts.google.com/o/oauth2/v2/auth?state=${state}&nonce=${nonce}`; },
    async exchange() { state.calls++; await state.beforeVerify?.(); if (state.fail) throw new Error('do-not-disclose-provider-response'); return state.identity; },
    async verifyNative(token, nonce) { assert.equal(token, `fixture.${nonce}`); return state.identity; } };
  const h = await harness(t, { ...options, googleProvider: provider }); provider.config.origin = h.base;
  return { h, state, provider };
}
function browser(h) {
  const jar = new Map(); let csrf = '';
  const api = {
    cookie: () => [...jar].map(([k, v]) => `${k}=${v}`).join('; '),
    async send(path, data, headers = {}) {
      const r = await fetch(h.base + path, { method: data === undefined ? 'GET' : 'POST', redirect: 'manual',
        headers: { Cookie: api.cookie(), ...(data === undefined ? {} : { Origin: h.base, 'Content-Type': 'application/json', 'X-CSRF-Token': csrf }), ...headers },
        ...(data === undefined ? {} : { body: JSON.stringify(data) }) });
      for (const raw of r.headers.getSetCookie()) { const [key, value] = raw.split(';')[0].split('='); if (value) jar.set(key, value); else jar.delete(key); }
      const body = r.headers.get('content-type')?.includes('json') ? await r.json() : await r.text();
      if (body?.csrfToken) csrf = body.csrfToken;
      return { status: r.status, body, headers: r.headers };
    },
    register: (email, extra = {}) => api.send('/api/auth/register', { name: 'Password Account', email, password: PASSWORD, ...extra }),
    async start(path = '/api/auth/google/start', data = {}) {
      const result = await api.send(path, data); assert.equal(result.status, 200, JSON.stringify(result.body));
      return new URL(result.body.redirectUrl).searchParams.get('state');
    },
    finish: (state, extra = '') => api.send(`/auth/google/callback?state=${state}&code=fixture-code${extra}`, undefined, { 'Sec-Fetch-Site': 'cross-site' }),
  };
  return api;
}
const native = async (h, path, data, headers = {}) => {
  const r = await fetch(h.base + '/api/mobile/v1' + path, { method: data === undefined ? 'GET' : 'POST',
    headers: { ...(data === undefined ? {} : { 'Content-Type': 'application/json' }), ...headers },
    ...(data === undefined ? {} : { body: JSON.stringify(data) }) });
  return { status: r.status, body: await r.json(), headers: r.headers };
};

test('Google is disabled until configured; existing password registration still works', async (t) => {
  const h = await harness(t), web = browser(h);
  assert.deepEqual((await web.send('/api/auth/providers')).body.google, { enabled: false, nativeEnabled: false });
  assert.equal((await web.send('/api/auth/google/start', {})).status, 503);
  assert.equal((await native(h, '/auth/google/challenge', {})).status, 503);
  assert.equal((await web.register('normal@example.test')).status, 201);
  assert.equal(h.db.prepare('SELECT count(*) AS n FROM google_auth_attempts').get().n, 0);
});
test('web Google signup creates one customer account and uses stable subject across email changes and restarts', async (t) => {
  const { h, state, provider } = await fixture(t, { persistent: true }), web = browser(h);
  const start = await web.start();
  const stored = h.db.prepare('SELECT * FROM google_auth_attempts').get();
  assert.notEqual(stored.state_hash, start); assert.ok(!JSON.stringify(stored).includes('taxi_ai_session'));
  const finished = await web.finish(start); assert.equal(finished.status, 303); assert.equal(finished.headers.get('location'), '/app?google=success');
  assert.match(finished.headers.getSetCookie().find((c) => c.startsWith('taxi_ai_session=')), /HttpOnly; SameSite=Strict/);
  const user = (await web.send('/api/session')).body.user;
  assert.deepEqual(user.capabilities, ['customer']); assert.equal(user.driver, null);
  assert.deepEqual((await web.send('/api/account/sign-in-methods')).body.methods, { password: false, google: true });
  assert.equal((await web.send('/api/auth/login', { email: identity.email, password: PASSWORD })).status, 401);
  assert.equal((await web.send('/api/admin/console/accounts')).status, 403);
  (await assert.rejects(async () => (await bootstrapAdmin(h.db, identity.email)), { code: 'INVALID_ACCOUNT' }));
  await web.send('/api/auth/logout', {}); await h.restart(); provider.config.origin = h.base;
  state.identity.email = 'updated-google@example.test';
  await web.finish(await web.start());
  assert.equal((await web.send('/api/session')).body.user.id, user.id);
  assert.equal(h.db.prepare('SELECT count(*) AS n FROM users').get().n, 1);
  assert.equal(h.db.prepare('SELECT email FROM users').get().email, identity.email);
});
test('state and browser binding prevent cross-browser login, replay, expired returns and duplicate callback fields', async (t) => {
  const { h, state } = await fixture(t), one = browser(h), other = browser(h);
  const start = await one.start();
  assert.equal((await other.finish(start)).headers.get('location'), '/app?google=retry'); assert.equal(state.calls, 0);
  assert.equal((await one.finish(start)).headers.get('location'), '/app?google=success'); assert.equal(state.calls, 1);
  await one.finish(start); assert.equal(state.calls, 1);
  const third = browser(h), expired = await third.start(); h.advance(600_000);
  assert.equal((await third.finish(expired)).headers.get('location'), '/app?google=retry'); assert.equal(state.calls, 1);
  const duplicated = await third.start(); await third.finish(duplicated, '&state=duplicate'); assert.equal(state.calls, 1);
  const cancelled = await third.start();
  assert.equal((await third.send(`/auth/google/callback?state=${cancelled}&error=access_denied`)).headers.get('location'), '/app?google=cancelled');
  assert.equal(state.calls, 1);
  const failed = await third.start(); state.fail = true;
  const failure = await third.finish(failed); assert.equal(failure.headers.get('location'), '/app?google=retry');
  assert.ok(!JSON.stringify(failure).includes('do-not-disclose'));
});
test('matching email cannot take over an existing driver; explicit password linking preserves profile and identity', async (t) => {
  const { h } = await fixture(t), existing = browser(h), google = browser(h);
  const registered = await existing.register(identity.email, { role: 'driver', vehicle: { model: 'Toyota Corolla', plate: 'TEST-001' } });
  const id = registered.body.user.id;
  assert.equal((await google.finish(await google.start())).headers.get('location'), '/app?google=existing');
  assert.equal(h.db.prepare('SELECT count(*) AS n FROM account_identities').get().n, 0);
  assert.equal((await existing.send('/api/account/google/link', { password: 'wrong-password-value' })).status, 401);
  assert.equal((await existing.send('/api/account/google/link', { password: PASSWORD }, { 'X-CSRF-Token': '' })).status, 403);
  assert.equal((await existing.send('/api/account/google/link', { password: PASSWORD }, { Origin: 'https://attacker.example' })).status, 403);
  const start = await existing.start('/api/account/google/link', { password: PASSWORD });
  assert.equal((await existing.finish(start)).headers.get('location'), '/account-access?google=connected');
  const user = (await existing.send('/api/session')).body.user;
  assert.equal(user.id, id); assert.deepEqual(user.capabilities, ['customer', 'driver']); assert.equal(user.driver.vehicle.plate, 'TEST-001');
  assert.deepEqual((await existing.send('/api/account/sign-in-methods')).body.methods, { password: true, google: true });
  await google.finish(await google.start()); assert.equal((await google.send('/api/session')).body.user.id, id);
  assert.equal(h.db.prepare('SELECT count(*) AS n FROM users').get().n, 1);
});
test('linking rechecks the original session after Google responds and rejects the wrong Google email', async (t) => {
  const { h, state } = await fixture(t), web = browser(h);
  await web.register(identity.email);
  let start = await web.start('/api/account/google/link', { password: PASSWORD });
  state.identity = { ...identity, email: 'different@example.test' };
  assert.equal((await web.finish(start)).headers.get('location'), '/app?google=conflict');
  state.identity = { ...identity }; start = await web.start('/api/account/google/link', { password: PASSWORD });
  state.beforeVerify = () => web.send('/api/auth/logout', {});
  assert.equal((await web.finish(start)).headers.get('location'), '/app?google=session');
  assert.equal(h.db.prepare('SELECT count(*) AS n FROM account_identities').get().n, 0);
});
test('staff cannot connect or sign in with Google and native credentials cannot authorize staff', async (t) => {
  const { h, state } = await fixture(t), admin = browser(h), google = browser(h);
  await admin.register('admin@example.test'); const a = (await bootstrapAdmin(h.db, 'admin@example.test'));
  await admin.send('/api/auth/login', { email: a.email, password: PASSWORD });
  assert.equal((await admin.send('/api/account/google/link', { password: PASSWORD })).status, 403);
  state.identity = { ...identity, email: a.email };
  assert.equal((await google.finish(await google.start())).headers.get('location'), '/app?google=existing');
  // Even a preexisting mapping may never authenticate a privileged account.
  h.db.prepare("INSERT INTO account_identities VALUES ('google',?,?,?)").run(identity.subject, a.id, Date.now());
  assert.equal((await google.finish(await google.start())).headers.get('location'), '/app?google=staff');
  const challenge = (await native(h, '/auth/google/challenge', {})).body;
  assert.equal((await native(h, '/auth/google', { challenge: challenge.challenge, idToken: `fixture.${challenge.nonce}`, deviceName: 'Test phone' })).status, 403);
  assert.equal(h.db.prepare('SELECT count(*) AS n FROM device_sessions').get().n, 0);
});
test('native nonce challenges are single-use, transport-isolated and issue only Taxi Ai device credentials', async (t) => {
  const { h } = await fixture(t);
  assert.equal((await native(h, '/auth/google/challenge', {}, { Origin: h.base })).status, 403);
  const c = (await native(h, '/auth/google/challenge', {})).body;
  const body = { challenge: c.challenge, idToken: `fixture.${c.nonce}`, deviceName: 'My Android' };
  const result = await native(h, '/auth/google', body); assert.equal(result.status, 200, JSON.stringify(result.body));
  assert.ok(result.body.credentials.refreshToken); assert.equal(result.headers.get('set-cookie'), null);
  assert.ok(!JSON.stringify(result.body).includes(c.nonce));
  assert.equal((await native(h, '/auth/google', body)).status, 400);
  assert.equal((await native(h, '/session', undefined, { Authorization: `Bearer ${result.body.credentials.accessToken}` })).status, 200);
  assert.equal((await browser(h).send('/api/admin/console/accounts', undefined, { Authorization: `Bearer ${result.body.credentials.accessToken}` })).status, 401);
  const c2 = (await native(h, '/auth/google/challenge', {})).body;
  assert.equal((await native(h, '/auth/google', { ...body, challenge: c2.challenge, role: 'admin' })).status, 400);
  assert.equal((await browser(h).finish(c2.challenge)).headers.get('location'), '/app?google=retry');
});
test('disconnecting Google requires password proof, prevents lockout and revokes sessions', async (t) => {
  const { h } = await fixture(t), web = browser(h);
  await web.register(identity.email);
  await web.finish(await web.start('/api/account/google/link', { password: PASSWORD }));
  const c = (await native(h, '/auth/google/challenge', {})).body;
  const device = (await native(h, '/auth/google', { challenge: c.challenge, idToken: `fixture.${c.nonce}`, deviceName: 'Test phone' })).body;
  assert.equal((await web.send('/api/account/google/unlink', { password: 'a-wrong-password' })).status, 401);
  assert.equal((await web.send('/api/account/google/unlink', { password: PASSWORD })).status, 200);
  assert.equal((await web.send('/api/session')).body.user, null);
  assert.equal((await native(h, '/session', undefined, { Authorization: `Bearer ${device.credentials.accessToken}` })).status, 401);
  assert.equal((await web.send('/api/auth/login', { email: identity.email, password: PASSWORD })).status, 200);
  const second = await fixture(t), onlyGoogle = browser(second.h);
  await onlyGoogle.finish(await onlyGoogle.start()); await onlyGoogle.send('/api/session');
  assert.equal((await onlyGoogle.send('/api/account/google/unlink', { password: PASSWORD })).body.error.code, 'GOOGLE_LAST_METHOD');
});
test('schema 13 upgrades preserve existing records and all Google pages are explicitly served', async (t) => {
  const h = await harness(t, { persistent: true }), web = browser(h);
  await web.register('old-account@example.test');
  const before = h.db.prepare('SELECT * FROM users').all();
  removeEatsFixtureTables(h.db); h.db.exec('DROP TABLE vehicle_photo_checks; DROP TABLE push_jobs; DROP TABLE push_registrations; DROP TABLE account_notifications; ALTER TABLE driver_availability DROP COLUMN native_session_id; DROP TABLE delivery_orders; ALTER TABLE rides DROP COLUMN vehicle_category; DROP TABLE account_identities; DROP TABLE account_password_settings; DROP TABLE google_auth_attempts; PRAGMA user_version=13');
  await h.restart();
  assert.deepEqual(h.db.prepare('SELECT * FROM users').all(), before);
  assert.equal(h.db.prepare('PRAGMA user_version').get().user_version, SCHEMA_VERSION);
  assert.equal((await web.send('/api/auth/login', { email: 'old-account@example.test', password: PASSWORD })).status, 200);
  for (const path of ['/account-access', '/account-access.mjs', '/dashboard/google-auth.mjs', '/dashboard/sign-in-methods.mjs']) {
    const r = await web.send(path); assert.equal(r.status, 200); assert.equal(r.headers.get('cache-control'), 'no-store');
    assert.match(r.headers.get('content-security-policy'), /script-src 'self'/);
  }
});


test('Google signup preserves selected starting experience without granting Driver or Seller permissions', async (t) => {
  const webFixture = await fixture(t), web = browser(webFixture.h);
  const state = await web.start('/api/auth/google/start', { intent: 'eats_seller' });
  assert.equal(webFixture.h.db.prepare('SELECT signup_intent AS intent FROM google_auth_attempts').get().intent, 'eats_seller');
  const finished = await web.finish(state);
  assert.equal(finished.headers.get('location'), '/app?google=success&start=eats_seller');
  const user = (await web.send('/api/session')).body.user;
  assert.equal(user.startingExperience, 'eats_seller');
  assert.deepEqual(user.capabilities, ['customer']);
  assert.equal(user.driver, null);
  assert.equal(webFixture.h.db.prepare('SELECT count(*) AS n FROM eats_memberships').get().n, 0);

  const nativeFixture = await fixture(t);
  nativeFixture.state.identity = { subject: 'google-driver-start', email: 'google-driver-start@example.test', name: 'Google Driver Start' };
  const challenge = (await native(nativeFixture.h, '/auth/google/challenge', { intent: 'driver' })).body;
  const signedIn = await native(nativeFixture.h, '/auth/google', {
    challenge: challenge.challenge, idToken: `fixture.${challenge.nonce}`, deviceName: 'Intent phone',
  });
  assert.equal(signedIn.status, 200, JSON.stringify(signedIn.body));
  assert.equal(signedIn.body.user.startingExperience, 'driver');
  assert.deepEqual(signedIn.body.user.capabilities, ['customer']);
  assert.equal(signedIn.body.user.driver, null);
  assert.equal(nativeFixture.h.db.prepare('SELECT count(*) AS n FROM drivers').get().n, 0);
});
