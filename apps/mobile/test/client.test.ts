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
const bookingRide = { id, version: 1, status: 'requested', pickup: 'Wuse II', destination: 'Maitama',
  suggestedFareKobo: 450000, fareKobo: null, expiresAt: 301000, canCancel: true, driver: null };
function vault() {
  const storage = { value: null as string | null, fail: false };
  const port: Vault = { read: async () => storage.value, write: async (value) => { if (storage.fail) throw new Error('Locked'); storage.value = value; }, clear: async () => { storage.value = null; } };
  return { storage, port };
}
function client(fetcher: (url: string, options: RequestInit) => Promise<Response>, v = vault()) {
  return { app: new MobileClient({ origin: 'https://taxi.example.test', vault: v.port, fetchImpl: ((url, options) => fetcher(String(url), options ?? {})) as typeof fetch }), ...v };
}
test('native GPS publication keeps its owner nonce and sequence across access refresh without persisting position', async () => {
  const attempts: Array<{ url: string; options: RequestInit }> = [];
  const position = { lat: 9.071234, lng: 7.401234, accuracy: 20, capturedAt: 1000 };
  const { app, storage } = client(async (url, options) => {
    if (url.endsWith('/auth/login')) return response(auth());
    if (url.endsWith('/auth/refresh')) return response(auth(2));
    attempts.push({ url, options });
    if (new Headers(options.headers).get('Authorization') === `Bearer ${auth().credentials.accessToken}`) return unauthorized();
    return ok({ replayed: false, share: { id, rideId: id, active: true, owned: true, sequence: 4,
      startedAt: 500, updatedAt: 1000, stale: false, position } });
  });
  await app.login(user.email, 'Test password', 'Phone');
  assert.equal((await app.trackingPosition(id, id, 4, position)).share.sequence, 4);
  assert.equal(attempts.length, 2);
  assert.equal(attempts[0].url, attempts[1].url);
  assert.ok(attempts[0].url.endsWith(`/tracking/shares/${id}/position?clientId=${id}`));
  assert.equal(attempts[0].options.body, attempts[1].options.body);
  assert.deepEqual(JSON.parse(String(attempts[0].options.body)), { sequence: 4, ...position });
  for (const value of ['9.071234', '7.401234', 'capturedAt']) assert.ok(!storage.value!.includes(value));
});
test('booking preserves the exact command through access refresh and keeps addresses and fares out of secure storage', async () => {
  const attempts: RequestInit[] = [];
  const { app, storage } = client(async (url, options) => {
    if (url.endsWith('/auth/login')) return response(auth());
    if (url.endsWith('/auth/refresh')) return response(auth(2));
    attempts.push(options);
    return new Headers(options.headers).get('Authorization') === `Bearer ${auth().credentials.accessToken}` ? unauthorized() : ok({ ride: bookingRide });
  });
  await app.login(user.email, 'Test password', 'Phone');
  const data = { pickupId: 'wuse-ii', destinationId: 'maitama' };
  assert.equal((await app.requestRide(data, 'original-booking-key')).ride.id, id);
  assert.equal(attempts.length, 2); assert.equal(attempts[0].body, attempts[1].body);
  for (const attempt of attempts) assert.equal(new Headers(attempt.headers).get('Idempotency-Key'), 'original-booking-key');
  for (const value of ['maitama','450000','pickupId']) assert.ok(!storage.value!.includes(value));
});
test('a successful booking response arriving after sign-out cannot populate another account', async () => {
  let finish!: (value: Response) => void;
  const { app } = client(async (url) => {
    if (url.endsWith('/auth/login')) return response(auth());
    if (url.endsWith('/booking/requests')) return new Promise((resolve) => { finish = resolve; });
    return ok();
  });
  await app.login(user.email, 'Test password', 'Phone');
  const pending = app.requestRide({ quoteId: id }, 'original-booking-key'), rejected = assert.rejects(pending, { code: 'SESSION_CHANGED' });
  await app.logout(); finish(ok({ ride: bookingRide })); await rejected; assert.equal(app.account(), null);
});
test('native password recovery is public, uses preview access and never creates or persists credentials', async () => {
  let sent: RequestInit = {}, path = '';
  const { app,storage }=client(async(url,options)=>{path=url;sent=options;return ok({accepted:true});});
  const preview=previewHeader('tester','a'.repeat(64));
  await app.requestPasswordReset('fixture@example.test',preview);
  assert.ok(path.endsWith('/auth/password/request')); assert.equal(new Headers(sent.headers).get('Authorization'),null);
  assert.equal(new Headers(sent.headers).get('X-Taxi-Ai-Preview-Access'),preview);
  assert.deepEqual(JSON.parse(String(sent.body)),{email:'fixture@example.test'}); assert.equal(storage.value,null); assert.equal(app.account(),null);
});
test('native verification belongs to the signed-in account and rejects stale responses after sign-out', async () => {
  let finish: (value: Response) => void = () => {};
  const {app}=client(async(url,options)=>{
    if(url.endsWith('/auth/login')) return response(auth());
    if(url.endsWith('/account/email')) { assert.ok(new Headers(options.headers).get('Authorization')); return ok({enabled:true,verified:false,email:user.email}); }
    if(url.endsWith('/account/email/request')) return new Promise(resolve=>{finish=resolve;});
    return ok();
  });
  await app.login(user.email,'Fixture password','Phone'); assert.equal((await app.emailStatus()).verified,false);
  const request=app.requestVerification(), rejected=assert.rejects(request,{code:'SESSION_CHANGED'});
  await app.logout(); finish(ok({accepted:true})); await rejected; assert.equal(app.account(),null);
});
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
test('native Google signup passes a fresh server challenge and stores only Taxi Ai refresh credentials', async () => {
  const calls: Array<{ url: string; options: RequestInit }> = [];
  const challenge = { challenge: 'a'.repeat(64), nonce: 'b'.repeat(64), webClientId: 'fixture.apps.googleusercontent.com' };
  const { app, storage } = client(async (url, options) => {
    calls.push({ url, options });
    if (url.endsWith('/auth/google/challenge')) return ok(challenge);
    return response(auth());
  });
  assert.equal(await app.googleLogin('My phone', async (value) => {
    assert.deepEqual(value, { nonce: challenge.nonce, webClientId: challenge.webClientId }); return 'private-google-id-token';
  }), true);
  assert.equal(app.account()?.id, user.id);
  const sent = JSON.parse(String(calls[1].options.body)); assert.equal(sent.challenge, challenge.challenge); assert.equal(sent.idToken, 'private-google-id-token');
  assert.ok(!storage.value!.includes('private-google')); assert.ok(!storage.value!.includes(challenge.nonce));
  assert.equal(JSON.parse(storage.value!).refreshToken, auth().credentials.refreshToken);
});
test('cancelling Google or signing out while its native prompt is open cannot sign a user in', async () => {
  const challenge = { challenge: 'a'.repeat(64), nonce: 'b'.repeat(64), webClientId: 'fixture.apps.googleusercontent.com' };
  let loginPosts = 0;
  const { app, storage } = client(async (url) => {
    if (url.endsWith('/auth/google/challenge')) return ok(challenge);
    loginPosts++; return response(auth());
  });
  assert.equal(await app.googleLogin('My phone', async () => null), false);
  assert.equal(loginPosts, 0); assert.equal(storage.value, null);
  await assert.rejects(app.googleLogin('My phone', async () => { await app.logout(); return 'private-google-token'; }), { code: 'SESSION_CHANGED' });
  assert.equal(loginPosts, 0); assert.equal(app.account(), null);
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

test('application edits preserve their version and request key through token rotation, while stale edits are not retried', async () => {
  const application = { driverId:user.id,status:'draft',version:2,busy:false,details:null,
    vehicle:{ model:'Toyota Corolla',plate:'TEST-123' },documents:[],eligibility:{ eligible:false,missing:[],expired:[] },reviewReason:null };
  const attempts: RequestInit[] = [];
  let stale = false;
  const { app,storage } = client(async (url,options) => {
    if (url.endsWith('/auth/login')) return response(auth());
    if (url.endsWith('/auth/refresh')) return response(auth(2));
    if (url.endsWith('/driver/onboarding')) return ok({ application });
    attempts.push(options);
    if (stale) return response({ error:{ code:'STALE_VERSION',message:'Load the saved application.' } },409);
    if (new Headers(options.headers).get('Authorization') === `Bearer ${auth().credentials.accessToken}`) return unauthorized();
    return ok({ application });
  });
  await app.login(user.email,'Test password','Phone');
  await app.applicationCommand('submit',{ expectedVersion:1 },'same-key-for-retry');
  assert.equal(attempts.length,2);
  assert.equal(attempts[0].body,attempts[1].body);
  assert.equal(new Headers(attempts[1].headers).get('Idempotency-Key'),'same-key-for-retry');
  assert.equal(JSON.parse(String(attempts[1].body)).expectedVersion,1);
  assert.ok(!storage.value!.includes('TEST-123'));
  stale = true;
  await assert.rejects(app.applicationCommand('submit',{ expectedVersion:1 },'different-request-key'),{ code:'STALE_VERSION' });
  assert.equal(attempts.length,3);
  application.driverId = 'another-driver';
  await assert.rejects(app.application(),{ code:'SESSION_CHANGED' });
});
