import test from 'node:test';
import assert from 'node:assert/strict';
import { createAdminController } from '../public/controller.mjs';
import { createAdminClient } from '../public/api-client.mjs';
import { routeFor, canAccess, defaultPage } from '../public/navigation.mjs';

function fixture(path = '/admin/cases') {
  const state = { rendered: [], signin: [], errors: [], mfa: [], actions: [], csrf: null, navigated: [], operationErrors: [] };
  const user = { id: 'user-a', name: 'Support staff' };
  const staff = { userId: user.id, role: 'support', version: 1, permissions: ['cases.support', 'accounts.read', 'trips.read'], mfa: { available: true, enrolled: false, required: false, verifiedUntil: null } };
  const session = { user, csrfToken: 'csrf-1', staff, serverNow: 10000 };
  const client = { session: async () => structuredClone(session), setCsrf: (value) => { state.csrf = value; }, reset() { state.csrf = null; },
    login: async () => {}, logout: async () => {}, request: async (path, options) => { if (options?.data) state.actions.push({ path, ...options }); return { viewerId: user.id }; } };
  const view = { clear: () => { state.rendered = []; }, loading() {}, render: (...args) => state.rendered.push(args), signIn: (message) => state.signin.push(message),
    error: (message) => state.errors.push(message), mfa: (...args) => state.mfa.push(args), actionError: (message) => state.operationErrors.push(message) };
  let keys = 0;
  const controller = createAdminController({ client, view, route: routeFor({ pathname: path }), makeKey: () => 'request-key-' + ++keys,
    navigate: (path) => state.navigated.push(path) });
  return { state, session, client, controller };
}
test('new routes carry explicit permissions and least-privilege landing pages', () => {
  for (const path of ['/admin/operations', '/admin/staff', '/admin/audit', '/admin/cases', '/admin/cases/11111111-1111-4111-8111-111111111111']) assert.ok(routeFor({ pathname: path }).permission);
  assert.throws(() => routeFor({ pathname: '/admin/staff/11111111-1111-4111-8111-111111111111' }));
  assert.equal(defaultPage({ permissions: ['operations.read'] }), '/admin/operations');
  assert.equal(defaultPage({ permissions: ['cases.safety'] }), '/admin/cases');
  assert.equal(canAccess({ permissions: ['cases.support'] }, 'cases'), true);
  assert.equal(canAccess(null, 'staff.manage'), false);
});
test('support home redirects to cases and cannot load finance data or staff controls', async () => {
  const h = fixture('/admin'); let requests = 0; h.client.request = async () => { requests++; };
  await h.controller.load(); assert.deepEqual(h.state.navigated, ['/admin/cases']); assert.equal(requests, 0);
  const denied = fixture('/admin/staff'); await denied.controller.load(); assert.equal(denied.state.rendered.length, 0); assert.match(denied.state.signin.at(-1), /staff role/);
});
test('role changes during a read or after foreground revalidation clear private records', async () => {
  const h = fixture(); let calls = 0;
  h.client.session = async () => { calls++; return structuredClone({ ...h.session, staff: { ...h.session.staff, version: calls === 1 ? 1 : 2 } }); };
  await h.controller.load(); assert.equal(h.state.rendered.length, 0); assert.match(h.state.signin.at(-1), /staff access/);
  h.client.session = async () => structuredClone(h.session); await h.controller.load(); assert.equal(h.state.rendered.length, 1);
  h.session.staff.permissions = []; h.session.staff.version++; await h.controller.revalidate(); assert.equal(h.state.rendered.length, 0);
});
test('required MFA prevents page reads and a pending setup key never renders after backgrounding', async () => {
  const h = fixture(); h.session.staff.mfa.required = true; let pageReads = 0;
  h.client.request = async () => { pageReads++; }; await h.controller.load(); assert.equal(pageReads, 0); assert.equal(h.state.mfa.length, 1);
  let resolve; const wait = new Promise((done) => { resolve = done; }); h.client.request = () => wait;
  const setup = h.controller.mfa('enroll', { password: 'test-password' }); await Promise.resolve(); h.controller.conceal();
  resolve({ setup: { secret: 'PRIVATE-KEY' } }); await setup;
  assert.equal(h.state.mfa.length, 1); assert.equal(h.state.csrf, null);
});
test('mutations retry an uncertain response with the same key and payload, then refresh', async () => {
  const h = fixture(); await h.controller.load(); let first = true;
  h.client.request = async (path, options) => {
    if (options?.data) { h.state.actions.push({ path, data: structuredClone(options.data), key: options.key }); if (first) { first = false; throw new Error('Network lost'); } }
    return { viewerId: h.session.user.id };
  };
  await h.controller.mutate('/api/admin/console/cases/example/note', { expectedVersion: 7, body: 'Contact attempt completed.' });
  assert.equal(h.state.rendered.length, 0); assert.equal(h.state.operationErrors.length, 1);
  await h.controller.retry(); assert.equal(h.state.actions.length, 2); assert.deepEqual(h.state.actions[1], h.state.actions[0]); assert.equal(h.state.rendered.length, 1);
  await h.controller.retry(); assert.equal(h.state.actions.length, 2);
});
test('session changes prevent writes and stale-version failures cannot be replayed blindly', async () => {
  const h = fixture(); await h.controller.load(); h.session.staff.version++;
  await h.controller.mutate('/api/admin/console/staff/revoke', { userId: 'target', expectedVersion: 1 }); assert.equal(h.state.actions.length, 0);
  await h.controller.load(); h.client.request = async () => { throw Object.assign(new Error('Refresh this case first.'), { status: 409, code: 'STALE_VERSION' }); };
  await h.controller.mutate('/api/admin/console/cases/example/status', { expectedVersion: 1, status: 'resolved' });
  assert.match(h.state.errors.at(-1), /Refresh/); const errors = h.state.errors.length; await h.controller.retry(); assert.equal(h.state.errors.length, errors);
});
test('mutation access lost during the request clears data and does not offer a retry', async () => {
  const h = fixture(); await h.controller.load();
  h.client.request = async () => { h.session.staff.permissions = []; h.session.staff.version++; return { viewerId: h.session.user.id }; };
  await h.controller.mutate('/api/admin/console/cases/example/note', { expectedVersion: 1, body: 'Saved note' });
  assert.equal(h.state.rendered.length, 0); assert.match(h.state.signin.at(-1), /staff access/); assert.equal(h.state.operationErrors.length, 0);
});
test('transport preserves structured MFA errors and command idempotency keys', async () => {
  const calls = []; const client = createAdminClient({ fetchImpl: async (url, options) => { calls.push(options); return new Response(JSON.stringify({ error: { code: 'MFA_SETUP_REQUIRED', message: 'Set up MFA.' } }), { status: 403 }); } });
  client.setCsrf('csrf'); await assert.rejects(client.request('/api/admin/console/staff/assign', { data: { role: 'support' }, key: 'same-key' }), { status: 403, code: 'MFA_SETUP_REQUIRED' });
  assert.equal(calls[0].headers['Idempotency-Key'], 'same-key'); assert.equal(calls[0].headers['X-CSRF-Token'], 'csrf');
});
