import test from 'node:test';
import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import { MobileClient, apiOrigin, previewHeader } from '../src/api/client.ts';
import type { Vault } from '../src/api/client.ts';
import { parseAccount, parseActivity } from '../../../packages/shared/src/mobile-contracts.mjs';

const user = { id: 'user-1', name: 'Test Person', email: 'test@example.test', role: 'customer', capabilities: ['customer'], driver: null };
const id = '00000000-0000-4000-8000-000000000000';
const auth = (version = 1) => ({ apiVersion: 1, serverNow: 1000, user, credentials: { sessionId: id,
  accessToken: String(version).repeat(64), refreshToken: String(version + 5).repeat(64), accessExpiresAt: 601000, refreshExpiresAt: 604801000 } });
const response = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const ok = (body: object = {}) => response({ ...body, apiVersion: 1, serverNow: 1000 });
const unauthorized = () => response({ error: { code: 'UNAUTHENTICATED', message: 'Sign in again.' } }, 401);
function vault() {
  const storage = { value: null as string | null, fail: false };
  const port: Vault = { read: async () => storage.value, write: async (value) => { if (storage.fail) throw new Error('Locked'); storage.value = value; }, clear: async () => { storage.value = null; } };
  return { storage, port };
}
function client(fetcher: (url: string, options: RequestInit) => Promise<Response>, v = vault()) {
  return { app: new MobileClient({ origin: 'https://taxi.example.test', vault: v.port, fetchImpl: ((url, options) => fetcher(String(url), options ?? {})) as typeof fetch }), ...v };
}
test('native credentials use the secure vault without persisting access tokens, accounts or passwords', async () => {
  const requests: RequestInit[] = [];
  const { app, storage } = client(async (_url, options) => { requests.push(options); return response(auth()); });
  const preview = previewHeader('tester', 'a'.repeat(64));
  await app.login('test@example.test', 'A test password', 'Test phone', preview);
  assert.equal(app.account()?.id, user.id);
  const saved = JSON.parse(storage.value!);
  assert.equal(saved.refreshToken, auth().credentials.refreshToken); assert.equal(saved.previewAccess, preview);
  assert.ok(!storage.value!.includes(auth().credentials.accessToken)); assert.ok(!storage.value!.includes(user.email)); assert.ok(!storage.value!.includes('A test password'));
  assert.equal(requests[0].credentials, 'omit'); assert.equal(requests[0].redirect, 'error');
  assert.equal(new Headers(requests[0].headers).get('X-Taxi-Ai-Preview-Access'), preview);
  assert.equal(new Headers(requests[0].headers).get('Authorization'), null);
});
test('simultaneous expired requests share one refresh and retry only with the new access token', async () => {
  let refreshes = 0;
  const { app, storage } = client(async (url, options) => {
    if (url.endsWith('/auth/login')) return response(auth());
    if (url.endsWith('/auth/refresh')) { refreshes++; await delay(15); return response(auth(2)); }
    return new Headers(options.headers).get('Authorization') === `Bearer ${auth(2).credentials.accessToken}` ? ok({ user }) : unauthorized();
  });
  await app.login(user.email, 'Test password', 'Phone');
  const [one, two] = await Promise.all([app.session(), app.session()]);
  assert.equal(one.id, user.id); assert.equal(two.id, user.id); assert.equal(refreshes, 1);
  assert.equal(JSON.parse(storage.value!).refreshToken, auth(2).credentials.refreshToken);
});
test('late private responses cannot cross a sign-out or account change', async () => {
  let finish: (r: Response) => void = () => {};
  const { app, storage } = client(async (url) => {
    if (url.endsWith('/auth/login')) return response(auth());
    if (url.endsWith('/devices')) return new Promise<Response>((resolve) => { finish = resolve; });
    return ok({ signedOut: true });
  });
  await app.login(user.email, 'Test password', 'Phone');
  const pending = app.devices(), rejected = assert.rejects(pending, { code: 'SESSION_CHANGED' });
  await app.logout(); finish(ok({ devices: [] })); await rejected;
  assert.equal(app.account(), null); assert.equal(storage.value, null);
});
test('a sign-in response received after logout is revoked and never persisted', async () => {
  let finish: (r: Response) => void = () => {}, started: () => void = () => {};
  const ready = new Promise<void>((resolve) => { started = resolve; });
  let revoked = false;
  const { app, storage } = client(async (url) => {
    if (url.endsWith('/auth/login')) return new Promise<Response>((resolve) => { finish = resolve; started(); });
    revoked = true; return ok({ signedOut: true });
  });
  const pending = app.login(user.email, 'Test password', 'Phone'), rejected = assert.rejects(pending, { code: 'SESSION_CHANGED' });
  await ready; await app.logout(); finish(response(auth())); await rejected;
  assert.equal(revoked, true); assert.equal(storage.value, null); assert.equal(app.account(), null);
});
test('secure storage failure revokes issued credentials; offline logout clears local identity and reports uncertainty', async () => {
  let revoked = 0;
  const v = vault(); v.storage.fail = true;
  const first = client(async (url) => { if (url.endsWith('/auth/login')) return response(auth()); revoked++; return ok(); }, v);
  await assert.rejects(first.app.login(user.email, 'Test password', 'Phone'), { code: 'SECURE_STORAGE' });
  assert.equal(revoked, 1); assert.equal(first.app.account(), null); assert.equal(v.storage.value, null);
  const second = client(async (url) => { if (url.endsWith('/auth/login')) return response(auth()); throw new Error('Offline'); });
  await second.app.login(user.email, 'Test password', 'Phone');
  assert.match((await second.app.logout())!, /Server confirmation failed/);
  assert.equal(second.storage.value, null); assert.equal(second.app.account(), null);
});
test('restore preserves credentials on network failure but clears revoked sessions', async () => {
  let fail = true;
  const v = vault(); v.storage.value = JSON.stringify({ origin: 'https://taxi.example.test', sessionId: id, refreshToken: '6'.repeat(64), previewAccess: '' });
  const { app } = client(async () => { if (fail) throw new Error('Offline'); return unauthorized(); }, v);
  await assert.rejects(app.restore(), { code: 'NETWORK' }); assert.ok(v.storage.value); assert.equal(app.account(), null);
  fail = false; await assert.rejects(app.restore(), { code: 'UNAUTHENTICATED' }); assert.equal(v.storage.value, null);
});
test('a changed server origin cannot receive saved tokens; malformed and privileged responses fail validation', async () => {
  const v = vault(); v.storage.value = JSON.stringify({ origin: 'https://old.example.test', sessionId: id, refreshToken: '6'.repeat(64), previewAccess: '' });
  const { app } = client(async () => { assert.fail('No credentials may be sent to a different server.'); }, v);
  await app.restore(); assert.equal(v.storage.value, null);
  assert.throws(() => parseAccount({ ...user, role: 'admin' }));
  assert.throws(() => parseActivity({ apiVersion: 2, serverNow: 1000, current: [], history: [], activeElsewhere: [], nextBefore: null }));
  for (const url of ['http://example.test', 'http://127.0.0.1:3000', 'https://user:secret@example.test', 'https://example.test/api', 'https://example.test?token=x']) assert.throws(() => apiOrigin(url));
  assert.equal(apiOrigin('http://127.0.0.1:3000', true), 'http://127.0.0.1:3000');
  assert.throws(() => apiOrigin('http://192.168.1.2:3000', true));
});

test('revocation during a pending read cannot restore an expired account from a late successful response', async () => {
  let finish: (r: Response) => void = () => {};
  const { app, storage } = client(async (url) => {
    if (url.endsWith('/auth/login')) return response(auth());
    if (url.endsWith('/session')) return new Promise<Response>((resolve) => { finish = resolve; });
    return unauthorized();
  });
  await app.login(user.email, 'Test password', 'Phone');
  const pending = app.session(), rejected = assert.rejects(pending, { code: 'SESSION_CHANGED' });
  await assert.rejects(app.devices(), { code: 'UNAUTHENTICATED' });
  finish(ok({ user })); await rejected;
  assert.equal(app.account(), null); assert.equal(storage.value, null);
});
