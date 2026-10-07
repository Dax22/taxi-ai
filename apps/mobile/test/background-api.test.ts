import test from 'node:test';
import assert from 'node:assert/strict';
import { MobileClient, createBackgroundTrackingApi } from '../src/api/client.ts';
import { restoreSession } from '../src/session/restore.ts';

const id = (n: number) => `00000000-0000-4000-a000-${String(n).padStart(12,'0')}`;
const position = { lat: 9.08, lng: 7.49, accuracy: 10, capturedAt: 1000 };
const share = { id: id(2), rideId: id(1), active: true, owned: true, sequence: 2, startedAt: 1000, updatedAt: 1000, stale: false, position };
const reply = (body: object, status = 200) => new Response(JSON.stringify({ apiVersion: 1, serverNow: 1000, ...body }), { status });
const account = { id: id(4), name: 'Fixture', email: 'fixture@example.test', role: 'customer', capabilities: ['customer'], driver: null };
const auth = { user: account, credentials: { sessionId: id(5), accessToken: 'a'.repeat(64), refreshToken: 'b'.repeat(64), accessExpiresAt: 601000, refreshExpiresAt: 604801000 } };

test('foreground restore erases surviving background authority when the account vault is missing or unreadable', async () => {
  for (const value of [null, '{invalid', 'locked']) {
    let stopped = 0, published = 0;
    const app = new MobileClient({ origin: 'https://taxi.example.test', vault: {
      read: async () => { if (value === 'locked') throw new Error('Locked'); return value; }, write: async () => {}, clear: async () => {},
    }, fetchImpl: (async () => { throw new Error('No network expected'); }) as typeof fetch });
    app.subscribe(() => { published++; });
    const result = restoreSession(app, async () => { stopped++; });
    if (value === 'locked') await assert.rejects(result, /Locked/); else await result;
    assert.equal(published, 0); assert.equal(stopped, 1);
  }
});

test('headless publishing uses only its scoped credential and never refreshes account authentication', async () => {
  const calls: Array<{ url: string; options: RequestInit }> = [], token = 'c'.repeat(64);
  let rejected = false;
  const api = createBackgroundTrackingApi({ origin: 'https://taxi.example.test', previewAccess: 'Basic Zml4dHVyZQ==', fetchImpl: (async (url, options) => {
    calls.push({ url: String(url), options: options! });
    if (rejected) return reply({ error: { code: 'UNAUTHENTICATED', message: 'Expired' } }, 401);
    return String(url).endsWith('/stop') ? reply({ stopped: true }) : reply({ share, replayed: false });
  }) as typeof fetch });
  assert.equal((await api.position(token, 2, position)).share.id, id(2));
  await api.stop(token);
  for (const call of calls) {
    assert.match(call.url, /\/api\/mobile\/v1\/tracking\/background\/(position|stop)$/);
    assert.equal(new Headers(call.options.headers).get('Authorization'), `Bearer ${token}`);
    assert.equal(new Headers(call.options.headers).get('X-Taxi-Ai-Preview-Access'), 'Basic Zml4dHVyZQ==');
    assert.equal(call.options.credentials, 'omit'); assert.equal(call.options.redirect, 'error');
    assert.equal(String(call.options.body).includes(token), false);
  }
  rejected = true; await assert.rejects(api.position(token, 3, position), { code: 'UNAUTHENTICATED' });
  assert.equal(calls.length, 3); assert.ok(calls.every(c => !c.url.includes('/auth/')));
  assert.throws(() => createBackgroundTrackingApi({ origin: 'http://untrusted.example.test' }), /HTTPS/);
});

test('food tracking stays on food endpoints and background grants must match the exact job and controller', async () => {
  let badGrant = false, stored = ''; const calls: string[] = [];
  const app = new MobileClient({ origin: 'https://taxi.example.test', vault: { read: async () => stored || null, write: async value => { stored = value; }, clear: async () => { stored = ''; } },
    fetchImpl: (async (url, options) => {
      const path = String(url); calls.push(path);
      if (path.endsWith('/auth/login')) return reply(auth);
      if (path.endsWith('/tracking/background/start')) return reply({ background: { token: 'c'.repeat(64), expiresAt: 60000, kind: 'food', jobId: badGrant ? id(9) : id(1), shareId: id(2), clientId: id(3), sequence: 2 } });
      const foodShare = { ...share, orderId: id(1) }; delete (foodShare as Partial<typeof share>).rideId;
      if (!options?.body) return reply({ orderId: id(1), isCourier: true, canShare: true, required: true, share: foodShare });
      return reply({ share: { ...foodShare, ...(path.includes('/stop?') ? { active: false, position: null, updatedAt: null } : {}) }, replayed: false });
    }) as typeof fetch });
  await app.login(account.email, 'password', 'Phone');
  assert.equal((await app.foodTracking(id(1), id(3))).rideId, id(1));
  assert.equal((await app.startFoodTracking(id(1), id(3), 'food-key')).share.rideId, id(1));
  await app.foodTrackingPosition(id(2), id(3), 2, position); await app.stopFoodTracking(id(2), id(3), 'stop-key');
  assert.ok(calls.slice(1).every(path => path.includes('/eats/')));
  const grant = await app.enableBackgroundTracking('food', id(1), id(2), id(3), 'grant-key');
  assert.equal(grant.background.kind, 'food'); assert.equal(stored.includes(grant.background.token), false);
  badGrant = true; await assert.rejects(app.enableBackgroundTracking('food', id(1), id(2), id(3), 'grant-key'), { code: 'INVALID_RESPONSE' });
});

test('headless transport distinguishes transient outages, Retry-After and malformed success responses', async () => {
  const token = 'c'.repeat(64);
  const apiFor = (fetchImpl: typeof fetch) => createBackgroundTrackingApi({ origin: 'https://taxi.example.test', fetchImpl });
  const offline = apiFor((async () => { throw new TypeError('Fixture network disconnected'); }) as typeof fetch);
  await assert.rejects(offline.position(token, 2, position), { code: 'CONNECTION_INTERRUPTED' });
  const limited = apiFor((async () => new Response('busy', { status: 429, headers: { 'Retry-After': '20' } })) as typeof fetch);
  await assert.rejects(limited.position(token, 2, position), (error: any) => error.status === 429 && error.retryAfterMs === 20_000);
  const unavailable = apiFor((async () => new Response('gateway unavailable', { status: 503 })) as typeof fetch);
  await assert.rejects(unavailable.position(token, 2, position), (error: any) => error.status === 503);
  const malformed = apiFor((async () => new Response('not json', { status: 200 })) as typeof fetch);
  await assert.rejects(malformed.position(token, 2, position), { code: 'INVALID_RESPONSE' });
});
