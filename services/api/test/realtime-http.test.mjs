import test from 'node:test';
import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import { harness, PASSWORD } from './helpers.mjs';
import { createRealtimeRepository } from '../src/modules/realtime/repository.mjs';

test('browser update endpoints authenticate, isolate accounts and reject user-selected channels', async t => {
  const h = await harness(t), alice = h.client(), bob = h.client(), anonymous = h.client();
  await alice.register('events-alice'); await bob.register('events-bob');
  assert.equal((await anonymous.send('/api/events?wait=0')).status, 401);
  assert.equal((await alice.send(`/api/events?wait=0&userId=${bob.user.id}`)).status, 400);
  const initial = await alice.send('/api/events?cursor=0&wait=0');
  assert.equal(initial.status, 200, JSON.stringify(initial.body));
  assert.equal(typeof initial.body.cursor, 'string');
  const waiting = alice.send(`/api/events?cursor=${initial.body.cursor}&wait=2000`);
  await delay(20);
  await createRealtimeRepository(h.db).touch([alice.user.id], h.now);
  const changed = await waiting;
  assert.equal(changed.status, 200, JSON.stringify(changed.body)); assert.equal(changed.body.changed, true);
  assert.deepEqual((await bob.send('/api/events?cursor=0&wait=0')).body.changed, false);
  assert.deepEqual(Object.keys(changed.body).sort(), ['changed','cursor','serverNow']);
});

test('native update waits revalidate a revoked session before returning any cursor', async t => {
  const h = await harness(t), owner = h.client(); await owner.register('events-native');
  const send = async (path, token, data) => {
    const response = await fetch(`${h.base}/api/mobile/v1${path}`, { method: data ? 'POST' : 'GET',
      headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(data ? { 'Content-Type': 'application/json' } : {}) },
      ...(data ? { body: JSON.stringify(data) } : {}) });
    return { status: response.status, body: await response.json() };
  };
  const login = await send('/auth/login', null, { email: owner.user.email, password: PASSWORD, deviceName: 'Live updates test' });
  assert.equal(login.status, 200, JSON.stringify(login.body));
  const { accessToken, refreshToken } = login.body.credentials;
  const initial = await send('/events?wait=0', accessToken); assert.equal(initial.status, 200, JSON.stringify(initial.body));
  const waiting = send(`/events?cursor=${initial.body.cursor}&wait=150`, accessToken);
  await delay(20); assert.equal((await send('/auth/logout', null, { refreshToken })).status, 200);
  const result = await waiting;
  assert.equal(result.status, 401, JSON.stringify(result.body)); assert.equal(result.body.error.code, 'UNAUTHENTICATED');
  assert.equal(Object.hasOwn(result.body, 'cursor'), false);
});
