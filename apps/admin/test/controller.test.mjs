import test from 'node:test';
import assert from 'node:assert/strict';
import { createAdminController } from '../public/controller.mjs';
import { createAdminClient } from '../public/api-client.mjs';
import { routeFor } from '../public/navigation.mjs';

const deferred = () => { let resolve; const promise = new Promise((done) => { resolve = done; }); return { promise, resolve }; };
function setup() {
  const state = { rendered: [], signedIn: [], errors: [], clear: 0, csrf: null }, user = { id: 'staff-one', name: 'Operator' };
  const client = { session: async () => ({ user, csrfToken: 'first-token' }), request: async () => ({ viewerId: user.id }),
    login: async () => {}, logout: async () => {}, setCsrf: (value) => { state.csrf = value; }, reset: () => { state.csrf = null; } };
  const view = { clear() { state.clear++; state.rendered = []; }, loading(value) { state.loading = value; }, signIn(message) { state.signedIn.push(message); },
    error(message) { state.errors.push(message); }, render(...args) { state.rendered.push(args); } };
  const controller = createAdminController({ client, view, route: { apiPath: '/api/admin/console/accounts' } });
  return { state, client, controller, user };
}
test('all dashboard routes support direct links, filters and independent account and trip details', () => {
  const id = '11111111-1111-4111-8111-111111111111';
  for (const [path, name, section] of [['/admin', 'overview', 'overview'], ['/admin/accounts', 'accounts', 'accounts'],
    ['/admin/trips', 'trips', 'trips'], ['/admin/analytics', 'analytics', 'analytics'], ['/admin/accounts/' + id, 'account', 'accounts'], ['/admin/trips/' + id, 'trip', 'trips']]) {
    const result = routeFor({ pathname: path, search: '?q=Test&limit=2' });
    assert.equal(result.name, name); assert.equal(result.section, section); assert.equal(result.query.get('q'), 'Test');
    assert.ok(result.apiPath.startsWith('/api/admin/console/'));
  }
  assert.throws(() => routeFor({ pathname: '/admin/analytics/' + id }));
  assert.throws(() => routeFor({ pathname: '/admin/../../api' }));
});
test('private data renders only after both session checks agree; sign-out and backgrounding invalidate late reads', async () => {
  const h = setup(); await h.controller.load(); assert.equal(h.state.rendered.length, 1); assert.equal(h.state.csrf, 'first-token');
  const delayed = deferred(); h.client.request = () => delayed.promise;
  const reading = h.controller.load(); await Promise.resolve(); await h.controller.logout();
  delayed.resolve({ viewerId: h.user.id }); await reading;
  assert.equal(h.state.rendered.length, 0); assert.equal(h.state.csrf, null); assert.equal(h.state.signedIn.at(-1), 'Signed out.');
  const next = deferred(); h.client.request = () => next.promise;
  const background = h.controller.load(); await Promise.resolve(); h.controller.conceal();
  next.resolve({ viewerId: h.user.id }); await background; assert.equal(h.state.rendered.length, 0); assert.equal(h.state.csrf, null);
});
test('changed cookies, revoked sessions and failed reads cannot leave an old account page visible', async () => {
  const h = setup(); let reads = 0;
  h.client.session = async () => ({ user: h.user, csrfToken: ++reads === 1 ? 'old' : 'replacement' });
  await h.controller.load(); assert.equal(h.state.rendered.length, 0); assert.match(h.state.signedIn.at(-1), /account changed/);
  h.client.session = async () => ({ user: h.user, csrfToken: 'current' }); h.client.request = async () => ({ viewerId: 'other-admin' });
  await h.controller.load(); assert.equal(h.state.rendered.length, 0);
  h.client.request = async () => { throw Object.assign(new Error('Access revoked'), { status: 403 }); };
  await h.controller.load(); assert.equal(h.state.signedIn.at(-1), 'Access revoked');
  h.client.request = async () => { throw new Error('Connection unavailable'); }; await h.controller.load();
  assert.equal(h.state.rendered.length, 0); assert.equal(h.state.errors.at(-1), 'Connection unavailable'); assert.equal(h.state.loading, false);
});
test('staff client keeps same-origin credentials, explicit CSRF, bounded requests and no stale session side effects', async () => {
  const calls = [], fetchImpl = async (url, options) => { calls.push({ url, options }); return new Response(JSON.stringify({ user: { id: 'staff' }, csrfToken: 'returned-token' }), { status: 200 }); };
  const client = createAdminClient({ fetchImpl }); await client.session(); client.setCsrf('accepted-token'); await client.logout();
  assert.equal(calls[0].options.credentials, 'same-origin'); assert.equal(calls[0].options.cache, 'no-store');
  assert.equal(calls[1].options.headers['X-CSRF-Token'], 'accepted-token');
  client.reset(); await client.logout(); assert.equal(calls[2].options.headers['X-CSRF-Token'], undefined);
  await assert.rejects(client.request('https://untrusted.test/api/admin/console/accounts'), /Unsupported/);
  const denied = createAdminClient({ fetchImpl: async () => new Response(JSON.stringify({ error: { message: 'No access' } }), { status: 403 }) });
  await assert.rejects(denied.session(), { message: 'No access', status: 403 });
});
