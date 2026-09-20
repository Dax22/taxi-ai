import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { harness, participants, requestRide, PASSWORD, bootstrapAdmin } from './helpers.mjs';
import { ACCESS_MS, IDLE_MS, DEVICE_MS } from '../src/modules/device-sessions/service.mjs';
import { parseSignIn, parseAccount, parseActivity, parseDevices, parseApplication } from '../../../packages/shared/src/mobile-contracts.mjs';

const send = async (h, path, { data, token, headers = {} } = {}) => {
  const response = await fetch(h.base + '/api/mobile/v1' + path, { method: data === undefined ? 'GET' : 'POST',
    headers: { ...(data === undefined ? {} : { 'Content-Type': 'application/json' }), ...(token ? { Authorization: `Bearer ${token}` } : {}), ...headers },
    ...(data === undefined ? {} : { body: JSON.stringify(data) }) });
  return { status: response.status, body: await response.json(), headers: response.headers };
};
async function login(h, email, deviceName = 'Test phone') {
  const result = await send(h, '/auth/login', { data: { email, password: PASSWORD, deviceName } });
  assert.equal(result.status, 200, JSON.stringify(result.body)); parseSignIn(result.body); return result.body;
}
test('mobile v1 shares accounts/activity, rotates hashed credentials, persists across restarts and preserves cookie isolation', async (t) => {
  const h = await harness(t, { persistent: true }), web = h.client(); await web.register('mobile');
  const ride = await requestRide(web), auth = await login(h, web.user.email);
  assert.equal(auth.user.id, web.user.id);
  let token = auth.credentials.accessToken;
  parseAccount((await send(h, '/session', { token })).body.user);
  const activity = await send(h, '/activity?mode=customer', { token }); parseActivity(activity.body);
  assert.equal(activity.body.current[0].id, ride.id); assert.equal(activity.body.current[0].fareKobo, null);
  assert.equal(activity.body.current[0].customer, undefined);
  assert.equal((await send(h, '/session', { headers: { Cookie: web.cookie } })).status, 401);
  assert.equal((await h.client().send('/api/rides', { headers: { Authorization: `Bearer ${token}` } })).status, 401);
  assert.equal((await send(h, '/session', { token, headers: { Origin: h.base } })).status, 403);
  assert.equal((await send(h, '/session', { token, headers: { 'Sec-Fetch-Site': 'cross-site' } })).status, 403);
  assert.equal((await web.send('/api/account/devices/' + auth.credentials.sessionId + '/revoke', { method: 'POST', data: {}, headers: { 'X-CSRF-Token': null } })).status, 403);
  const rows = JSON.stringify(h.db.prepare('SELECT * FROM device_sessions').all()) + JSON.stringify(h.db.prepare('SELECT * FROM device_refresh_tokens').all());
  assert.ok(!rows.includes(token)); assert.ok(!rows.includes(auth.credentials.refreshToken));
  await h.restart(); assert.equal((await send(h, '/session', { token })).status, 200);
  h.advance(ACCESS_MS); assert.equal((await send(h, '/session', { token })).status, 401);
  const refreshed = await send(h, '/auth/refresh', { data: { refreshToken: auth.credentials.refreshToken } });
  assert.equal(refreshed.status, 200); parseSignIn(refreshed.body);
  assert.notEqual(refreshed.body.credentials.refreshToken, auth.credentials.refreshToken);
  token = refreshed.body.credentials.accessToken;
  assert.equal((await send(h, '/session', { token })).status, 200);
  assert.equal((await send(h, '/session', { token: auth.credentials.accessToken })).status, 401);
  assert.equal((await web.send('/api/session')).body.user.id, web.user.id);
});
test('refresh replay commits revocation of that device family, including two simultaneous refreshes', async (t) => {
  const h = await harness(t), web = h.client(); await web.register('replay');
  const one = await login(h, web.user.email), two = await login(h, web.user.email, 'Other phone');
  const data = { refreshToken: one.credentials.refreshToken };
  const outcomes = await Promise.all([send(h, '/auth/refresh', { data }), send(h, '/auth/refresh', { data })]);
  assert.deepEqual(outcomes.map((r) => r.status).sort(), [200,401]);
  const rotated = outcomes.find((r) => r.status === 200).body.credentials;
  assert.equal((await send(h, '/session', { token: rotated.accessToken })).status, 401);
  assert.equal((await send(h, '/auth/refresh', { data: { refreshToken: rotated.refreshToken } })).status, 401);
  assert.equal((await send(h, '/session', { token: two.credentials.accessToken })).status, 200);
  assert.equal(h.db.prepare("SELECT count(*) AS n FROM audit_events WHERE kind='device.refresh_reuse'").get().n, 1);
});
test('mode and account scope cannot grant privileges or expose another person’s history/devices', async (t) => {
  const h = await harness(t), { customer, driver, admin } = await participants(h, 1, { online: false });
  const mine = await login(h, customer.user.email), other = await login(h, driver.user.email);
  const token = mine.credentials.accessToken;
  await requestRide(driver);
  assert.equal((await send(h, '/activity?mode=work', { token })).status, 403);
  assert.equal((await send(h, '/activity?mode=admin', { token })).status, 400);
  assert.deepEqual((await send(h, '/activity?mode=customer', { token })).body.current, []);
  assert.equal((await send(h, `/devices/${other.credentials.sessionId}/revoke`, { token, data: {} })).status, 404);
  assert.equal((await send(h, '/admin/drivers', { token })).status, 404);
  assert.equal((await send(h, '/auth/login', { data: { email: admin.user.email, password: PASSWORD, deviceName: 'Staff phone' } })).status, 403);
  const vehicle = { model: 'Toyota Corolla', plate: 'TEST-MOBILE' }, key = randomUUID();
  const enroll = () => send(h, '/account/driver-profile', { token, data: { vehicle }, headers: { 'Idempotency-Key': key } });
  assert.equal((await enroll()).body.replayed, false); assert.equal((await enroll()).body.replayed, true);
  const profile = (await send(h, '/session', { token })).body.user;
  parseAccount(profile); assert.deepEqual(profile.capabilities, ['customer','driver']);
  assert.equal(profile.driver.eligibility.eligible, false);
  parseApplication((await send(h, '/driver/application', { token })).body);
  parseActivity((await send(h, '/activity?mode=work', { token })).body);
  assert.equal((await send(h, '/availability/online', { token, data: {} })).status, 404);
  assert.equal((await send(h, '/account/driver-profile', { token, data: { vehicle, approved: true }, headers: { 'Idempotency-Key': randomUUID() } })).status, 400);
});
test('per-device revocation, idempotent logout and staff promotion invalidate all appropriate credentials', async (t) => {
  const h = await harness(t), web = h.client(); await web.register('devices');
  const first = await login(h, web.user.email), second = await login(h, web.user.email);
  const devices = parseDevices((await send(h, '/devices', { token: first.credentials.accessToken })).body);
  assert.equal(devices.length, 2); assert.equal(devices.find((d) => d.current).id, first.credentials.sessionId);
  assert.equal((await web.post(`/api/account/devices/${first.credentials.sessionId}/revoke`)).status, 200);
  assert.equal((await send(h, '/session', { token: first.credentials.accessToken })).status, 401);
  for (let i = 0; i < 2; i++) assert.equal((await send(h, '/auth/logout', { data: { refreshToken: first.credentials.refreshToken } })).status, 200);
  assert.equal((await send(h, '/session', { token: second.credentials.accessToken })).status, 200);
  bootstrapAdmin(h.db, web.user.email);
  assert.equal((await send(h, '/session', { token: second.credentials.accessToken })).status, 401);
  assert.equal((await send(h, '/auth/refresh', { data: { refreshToken: second.credentials.refreshToken } })).status, 401);
});
test('idle and absolute deadlines, device limit and invalid payloads fail closed', async (t) => {
  const h = await harness(t), web = h.client(); await web.register('limits');
  let auth = await login(h, web.user.email);
  h.advance(IDLE_MS);
  assert.equal((await send(h, '/auth/refresh', { data: { refreshToken: auth.credentials.refreshToken } })).status, 401);
  auth = await login(h, web.user.email);
  for (let i = 0; i < 5; i++) {
    h.advance(5 * 24 * 60 * 60_000);
    const r = await send(h, '/auth/refresh', { data: { refreshToken: auth.credentials.refreshToken } }); assert.equal(r.status, 200); auth = r.body;
  }
  h.advance(DEVICE_MS - 25 * 24 * 60 * 60_000);
  assert.equal((await send(h, '/auth/refresh', { data: { refreshToken: auth.credentials.refreshToken } })).status, 401);
  for (let i = 0; i < 5; i++) await login(h, web.user.email);
  assert.equal((await send(h, '/auth/login', { data: { email: web.user.email, password: PASSWORD, deviceName: 'Sixth' } })).body.error.code, 'DEVICE_LIMIT');
  for (const data of [{}, { refreshToken: 'bad' }, { refreshToken: 'f'.repeat(64), userId: web.user.id }]) assert.ok((await send(h, '/auth/refresh', { data })).status >= 400);
});
