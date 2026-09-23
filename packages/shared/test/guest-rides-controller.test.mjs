import test from 'node:test';
import assert from 'node:assert/strict';
import { createGuestRideController } from '../src/guest-rides-controller.mjs';

const rideId = '00000000-0000-4000-8000-000000000001';
const linkId = '00000000-0000-4000-8000-000000000002';
const otherId = '00000000-0000-4000-8000-000000000003';
const token = 'a'.repeat(64), otherToken = 'b'.repeat(64);
const identity = { userId: 'booker-1', rideId };
const link = (extras = {}) => ({ id: linkId, version: 1, active: true, expiresAt: 2000, ...extras });
const body = (savedLink = null, extras = {}) => ({ guest: { rideId, canCreate: true, link: savedLink }, ...extras });
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
function setup() {
  let response = body(), clock = 1000, key = 0; const calls = [];
  const api = { request: async () => response, command: async (...args) => { calls.push(args); response = body(link()); return { ...response, token }; } };
  const controller = createGuestRideController({ api, makeKey: () => 'key-' + ++key, now: () => clock });
  return { c: controller, api, calls, save: value => { response = value; }, clock: value => { clock = value; } };
}

test('owner must load the current ride before create, then only explicit replace can rotate the current link', async () => {
  const f = setup(); assert.equal(await f.c.create(), false); await f.c.context(identity);
  assert.equal(await f.c.create(), true); assert.equal(f.c.snapshot().token, token);
  assert.deepEqual(f.calls, [[`/guest-rides/${rideId}/link`, { expectedLinkId: null }, 'key-1']]);
  assert.equal(await f.c.create(), false);
  await f.c.replace(); assert.deepEqual(f.calls[1], [`/guest-rides/${rideId}/link`, { expectedLinkId: linkId }, 'key-2']);
});

test('metadata refresh retains only the same active link secret and expiry removes it', async () => {
  const f = setup(); await f.c.context(identity); await f.c.create(); await f.c.load(); assert.equal(f.c.snapshot().token, token);
  f.clock(2000); f.c.tick(); assert.equal(f.c.snapshot().token, null);
  f.clock(1000); f.c.tick(); assert.equal(f.c.snapshot().token, null, 'clock changes never recover erased secrets');
});

test('server clock offset prevents links surviving expiration on a slow device clock', async () => {
  const f = setup(); await f.c.context(identity);
  f.api.command = async () => body(link({ expiresAt: 6000 }), { serverNow: 5500, token });
  await f.c.create(); assert.equal(f.c.snapshot().token, token);
  f.clock(1500); f.c.tick(); assert.equal(f.c.snapshot().token, null);
});

test('revoked, replaced or changed link metadata clears the private token', async () => {
  for (const changed of [link({ active: false }), link({ id: otherId }), link({ version: 2 })]) {
    const f = setup(); await f.c.context(identity); await f.c.create(); f.save(body(changed)); await f.c.load(); assert.equal(f.c.snapshot().token, null);
  }
});

test('network failure on refresh hides all private data and cannot recover the token with a later GET', async () => {
  const f = setup(); await f.c.context(identity); await f.c.create();
  f.api.request = async () => { throw new Error('Offline'); }; await f.c.load();
  assert.equal(f.c.snapshot().value, null); assert.equal(f.c.snapshot().token, null);
  f.api.request = async () => body(link()); await f.c.load(); assert.equal(f.c.snapshot().token, null);
});

test('a lost create reply locks actions and retries the exact command; replay requires explicit replacement', async () => {
  const f = setup(); await f.c.context(identity);
  f.api.command = async (...args) => { f.calls.push(args); if (f.calls.length === 1) throw Object.assign(new Error('Network unavailable'), { status: 0 }); return body(link(), { replayed: true }); };
  assert.equal(await f.c.create(), false); assert.equal(f.c.snapshot().uncertain, true);
  assert.equal(await f.c.create(), false); assert.equal(await f.c.replace(), false); await f.c.load(); assert.equal(f.calls.length, 1);
  assert.equal(await f.c.retry(), true); assert.deepEqual(f.calls[1], f.calls[0]);
  assert.equal(f.c.snapshot().token, null); assert.match(f.c.snapshot().error, /Replace/);
  f.api.command = async (...args) => { f.calls.push(args); return body(link({ id: otherId }), { token: otherToken }); };
  assert.equal(await f.c.replace(), true); assert.equal(f.c.snapshot().token, otherToken);
  assert.deepEqual(f.calls[2], [`/guest-rides/${rideId}/link`, { expectedLinkId: linkId }, 'key-2']);
});

test('a lost revoke reply cannot discard the retry payload or share the old secret', async () => {
  const f = setup(); await f.c.context(identity); await f.c.create();
  f.api.command = async (...args) => { f.calls.push(args); throw new Error('Reply lost'); };
  await f.c.revoke(); assert.equal(f.c.snapshot().uncertain, true); assert.equal(f.c.snapshot().token, null);
  f.api.command = async (...args) => { f.calls.push(args); return body(link({ version: 2, active: false }), { replayed: true }); };
  await f.c.retry(); assert.deepEqual(f.calls[2], f.calls[1]);
  assert.deepEqual(f.calls[1], [`/guest-rides/${rideId}/revoke`, { linkId, expectedVersion: 1 }, 'key-2']);
  assert.equal(f.c.snapshot().uncertain, false); assert.equal(f.c.snapshot().value.link.active, false);
});

test('a definite request rejection clears uncertainty so fresh metadata can recover controls', async () => {
  const f = setup(); await f.c.context(identity);
  f.api.command = async () => { throw Object.assign(new Error('Link changed'), { status: 409 }); };
  await f.c.create(); assert.equal(f.c.snapshot().uncertain, false); assert.equal(await f.c.retry(), false);
  f.save(body(link())); await f.c.load(); assert.equal(f.c.snapshot().value.link.id, linkId);
});

test('pending mutation is single flight and erases the previous token immediately', async () => {
  const f = setup(); await f.c.context(identity); await f.c.create(); const gate = deferred();
  f.api.command = async (...args) => { f.calls.push(args); return gate.promise; };
  const replace = f.c.replace(); assert.equal(f.c.snapshot().token, null); assert.equal(f.c.snapshot().pending, true);
  assert.equal(await f.c.replace(), false); assert.equal(await f.c.revoke(), false); assert.equal(await f.c.retry(), false);
  gate.resolve(body(link({ id: otherId }), { token: otherToken })); await replace; assert.equal(f.c.snapshot().token, otherToken);
});

test('account switching discards late command replies and the old exact retry', async () => {
  const f = setup(); await f.c.context(identity); const gate = deferred(); f.api.command = async () => gate.promise;
  const first = f.c.create(); await f.c.context({ ...identity, userId: 'booker-2' });
  gate.resolve(body(link(), { token })); assert.equal(await first, false);
  assert.equal(f.c.snapshot().token, null); assert.equal(f.c.snapshot().value.link, null); assert.equal(await f.c.retry(), false);
});

test('ride switching ignores a late read and leaves the new ride metadata intact', async () => {
  const f = setup(), gate = deferred(); f.api.request = async path => path.endsWith(rideId) ? gate.promise : { guest: { rideId: otherId, canCreate: true, link: null } };
  const first = f.c.context(identity); await f.c.context({ ...identity, rideId: otherId });
  gate.resolve(body(link())); await first; assert.equal(f.c.snapshot().value.rideId, otherId); assert.equal(f.c.snapshot().value.link, null);
});

test('backgrounding erases private data but preserves an unresolved action across same-context resume', async () => {
  const f = setup(); await f.c.context(identity); const gate = deferred();
  f.api.command = async (...args) => { f.calls.push(args); return gate.promise; };
  const first = f.c.create(); f.c.pause(); assert.equal(f.c.snapshot().value, null); assert.equal(f.c.snapshot().uncertain, true);
  await f.c.context(identity); assert.equal(await f.c.create(), false);
  gate.resolve(body(link(), { token })); assert.equal(await first, false); assert.equal(f.c.snapshot().token, null);
  f.api.command = async (...args) => { f.calls.push(args); return body(link(), { replayed: true }); };
  await f.c.retry(); assert.deepEqual(f.calls[1], f.calls[0]); assert.equal(f.c.snapshot().uncertain, false);
});

test('backgrounded successful links remain secret-free on resume and pause invalidates pending reads', async () => {
  const f = setup(); await f.c.context(identity); await f.c.create(); const gate = deferred();
  f.api.request = async () => gate.promise; const read = f.c.load(); f.c.pause(); gate.resolve(body(link())); await read;
  assert.equal(f.c.snapshot().value, null); assert.equal(f.c.snapshot().token, null);
  f.api.request = async () => body(link()); await f.c.context(identity); assert.equal(f.c.snapshot().value.link.id, linkId); assert.equal(f.c.snapshot().token, null);
});

test('wrong-trip and malformed mutation responses leave the original action retryable without exposing a token', async () => {
  const f = setup(); await f.c.context(identity);
  f.api.command = async () => ({ guest: { rideId: otherId, canCreate: true, link: link() }, token });
  await f.c.create(); assert.equal(f.c.snapshot().uncertain, true); assert.equal(f.c.snapshot().token, null);
  f.api.command = async () => body(link(), { replayed: true }); assert.equal(await f.c.retry(), true);
});
