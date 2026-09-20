import test from 'node:test';
import assert from 'node:assert/strict';
import { createGoogleSignIn, googleDestination, consumeGoogleOutcome } from '../public/dashboard/google-auth.mjs';
import { createSignInMethods } from '../public/dashboard/sign-in-methods.mjs';

test('Google login stays unavailable until configured, blocks duplicate taps and rejects untrusted redirects', async () => {
  let enabled = false, visible, count = 0, failure = false, finish;
  const client = { request: async (path) => {
    if (path === '/api/auth/providers') return { google: { enabled } };
    count++; if (failure) throw new Error('Google is unavailable.');
    return new Promise((resolve) => { finish = resolve; });
  } };
  let destination = '', message = '', busy = false;
  const controller = createGoogleSignIn({ client, navigate: (url) => { destination = url; },
    view: { available: (v) => { visible = v; }, busy: (v) => { busy = v; }, error: (v) => { message = v; } } });
  await controller.load(); await controller.start(); assert.equal(visible, false); assert.equal(count, 0);
  enabled = true; await controller.load(); const pending = controller.start(); await controller.start(); assert.equal(count, 1);
  finish({ redirectUrl: 'https://attacker.example' }); await pending; assert.equal(destination, ''); assert.equal(busy, false); assert.match(message, /could not start/);
  failure = true; await controller.start(); assert.equal(busy, false); assert.equal(message, 'Google is unavailable.');
  for (const url of ['javascript:alert(1)', 'https://accounts.google.com.evil.example/o/oauth2/v2/auth', '/app', 'https://user:secret@accounts.google.com/o/oauth2/v2/auth']) assert.throws(() => googleDestination(url));
});
test('Google callback outcomes are allowlisted and removed from browser history', () => {
  let next;
  const message = consumeGoogleOutcome({ href: 'https://taxi.example.test/app?google=existing' }, { replaceState: (_a, _b, value) => { next = value; } });
  assert.match(message, /password/); assert.equal(next, '/app');
  const unknown = consumeGoogleOutcome({ href: 'https://taxi.example.test/app?google=%3Cscript%3E' }, { replaceState() {} });
  assert.ok(!unknown.includes('<script>'));
});
test('sign-in methods never show a profile or redirect after account switching or backgrounding', async () => {
  const user = { id: 'customer-1', role: 'customer', email: 'fixture@example.test' };
  let userNow = user, reads = 0, rendered = null, redirect = '', finish;
  const client = { reset() {}, setCsrf() {}, async request(path) {
    if (path === '/api/session') return { user: userNow, csrfToken: 'session' };
    if (path === '/api/account/sign-in-methods') { reads++; return { methods: { google: false, password: true }, google: { enabled: true } }; }
    return new Promise((resolve) => { finish = resolve; });
  } };
  const view = { clear() { rendered = null; }, status() {}, error() {}, busy() {}, render(value) { rendered = value; } };
  const controller = createSignInMethods({ client, view, navigate: (url) => { redirect = url; } });
  await controller.load(); assert.equal(reads, 1); assert.equal(rendered.id, user.id);
  const pending = controller.submit('never-kept-by-controller'); controller.clear(); userNow = null;
  finish({ redirectUrl: 'https://accounts.google.com/o/oauth2/v2/auth?state=fixture' }); await pending;
  assert.equal(redirect, ''); assert.equal(rendered, null);
  await controller.load(); assert.equal(reads, 1);
});
