import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

// Resolve one browser import for Node fixtures; this is not browser/device QA.
const source = (await readFile(new URL('../public/dashboard/page-controller.mjs', import.meta.url), 'utf8'))
  .replace("'/shared/trip-lifecycle.mjs'", `'${new URL('../../../packages/shared/src/trip-lifecycle.mjs', import.meta.url)}'`);
const { createPageController } = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
const customer = { id: 'customer-one', role: 'customer', name: 'Customer' };
const driver = { id: 'driver-one', role: 'driver', name: 'Driver', driver: { status: 'approved' } };
const admin = { id: 'admin-one', role: 'admin' };
const ride = { id: 'ride-one', status: 'negotiating', version: 2 };
const session = (user = customer, token = 'csrf-one') => ({ user, csrfToken: user ? token : null });
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };

function setup() {
  let current = session(), rendered, selected = null, intercept = async () => undefined;
  const requests = [], feedback = [], resets = [], contexts = [], commands = [];
  const client = { reset() { resets.push('client'); }, setCsrf() {},
    async request(path, options) {
      requests.push(path);
      const result = await intercept(path, options); if (result !== undefined) return result;
      if (path === '/api/session') return current;
      if (path === '/api/rides') return { rides: [ride], available: [], matchingSettings: { allowSimulation: true } };
      if (path === '/api/chat') return { conversations: [{ rideId: ride.id, unread: 1 }] };
      if (path === '/api/rides/history') return { rides: [], nextBefore: null };
      if (path === '/api/admin/drivers') return { drivers: [driver] };
      if (path === '/api/admin/chat-reports') return { reports: [{ id: 'report-one' }] };
      throw new Error(`Unexpected fixture request ${path}`);
    },
    async rideCommand(path, data) { commands.push({ path, data }); return { ride }; },
  };
  const view = { render(next) { rendered = structuredClone(next); selected ??= next.rides[0]?.id; },
    reset() { resets.push('view'); selected = null; }, setBusy() {}, select(id) { selected = id; },
    selected() { return [...(rendered?.rides ?? []), ...(rendered?.history ?? [])].find((item) => item.id === selected); } };
  const feature = (name) => ({ reset() { resets.push(name); }, async poll() {}, async stop() {}, shutdown() {},
    setContext(...args) { contexts.push([name, ...args]); }, context(...args) { contexts.push([name, ...args]); },
    async show(...args) { contexts.push([name, ...args]); } });
  const page = createPageController({ client, view, conversation: feature('conversation'), calls: feature('calls'),
    sharing: feature('sharing'), availability: feature('availability'), planner: feature('planner'), payments: feature('payments'),
    onboarding: feature('onboarding'), safety: feature('safety'),
    conversationView: { setBusy() {} }, authForm: { reset() { resets.push('auth'); } },
    feedback: Object.fromEntries(['clear', 'error', 'notice', 'synced', 'offline'].map((name) => [name, (...args) => feedback.push([name, ...args])])) });
  return { page, requests, feedback, resets, contexts, commands, rendered: () => rendered,
    session(next) { current = next; }, intercept(fn) { intercept = fn; } };
}

test('customer, driver and administrator refreshes select only their role data and initialise feature contexts', async () => {
  const h = setup(); await h.page.refresh();
  assert.equal(h.rendered().chatUnread[ride.id], 1);
  assert.ok(h.contexts.some(([name, user, busy]) => name === 'availability' && user.id === customer.id && busy));
  h.session(session(admin)); h.requests.length = 0; await h.page.refresh();
  assert.deepEqual(h.requests, ['/api/session', '/api/admin/drivers', '/api/admin/chat-reports', '/api/session']);
  assert.deepEqual(h.rendered().rides, []); assert.deepEqual(h.rendered().history, []);
  assert.equal(h.rendered().drivers.length, 1);
  h.session(session(driver)); await h.page.refresh();
  assert.deepEqual(h.rendered().drivers, []); assert.deepEqual(h.rendered().reports, []);
  assert.equal(h.rendered().user.id, driver.id);
});

test('an account switch clears private screens and device contexts before the next role request fails', async () => {
  const h = setup(); await h.page.refresh();
  h.session(session(admin));
  h.intercept(async (path) => {
    if (path === '/api/admin/drivers') {
      assert.equal(h.rendered().user.id, admin.id);
      assert.deepEqual(h.rendered().rides, []); assert.deepEqual(h.rendered().chatUnread, {});
      throw new Error('Offline');
    }
  });
  await h.page.poll();
  assert.deepEqual(h.rendered().rides, []);
  for (const name of ['view', 'conversation', 'calls', 'sharing', 'availability', 'planner', 'payments', 'onboarding', 'safety']) assert.ok(h.resets.includes(name));
  assert.deepEqual(h.feedback.at(-1), ['offline']);
});

test('expired authentication and a failed session recheck cannot leave the previous account visible', async () => {
  const h = setup(); await h.page.refresh();
  h.intercept(async (path) => {
    if (path === '/api/rides') throw Object.assign(new Error('Sign in'), { status: 401 });
  });
  await h.page.poll();
  assert.equal(h.rendered().user, null); assert.deepEqual(h.rendered().rides, []);
  h.intercept(async () => { throw new Error('Disconnected'); });
  await h.page.poll(); assert.equal(h.rendered().user, null);
});

test('a cookie change during dashboard reads discards the entire mixed response', async () => {
  const h = setup(); await h.page.refresh(); let sessionReads = 0;
  h.intercept(async (path) => {
    if (path === '/api/session' && ++sessionReads === 2) return session(admin, 'new-cookie');
    if (path === '/api/rides') return { rides: [{ ...ride, id: 'other-account-ride' }], available: [], matchingSettings: { allowSimulation: true } };
  });
  await h.page.refresh();
  assert.equal(h.rendered().user.id, admin.id); assert.deepEqual(h.rendered().rides, []);
  assert.equal(h.page.snapshot().historyLoaded, false);
});

test('a queued action is not executed under a replacement account or renewed session', async () => {
  for (const next of [session(admin), session(customer, 'new-token')]) {
    const h = setup(); await h.page.refresh(); const waiting = deferred(); let first = true;
    h.intercept(async (path) => { if (path === '/api/session' && first) { first = false; return waiting.promise; } });
    const refresh = h.page.refresh();
    const action = h.page.rideCommand('/api/rides', { pickupId: 'wuse-ii', destinationId: 'maitama' });
    h.session(next); waiting.resolve(next);
    await Promise.all([refresh, action]);
    assert.equal(h.commands.length, 0);
    assert.ok(h.feedback.some(([name, message]) => name === 'error' && message.includes('session changed')));
  }
});

test('refreshes coalesce; repeated clicks run one action and preserve exact offer/version', async () => {
  const h = setup(); await h.page.refresh(); const wait = deferred(); let writes = 0;
  const refresh = h.page.refresh(); assert.equal(h.page.refresh(), refresh); await refresh;
  const action = h.page.runAction(async () => { writes++; await wait.promise; });
  await h.page.runAction(async () => { writes++; }); assert.equal(writes, 1);
  wait.resolve(); await action;
  const displayed = { expectedVersion: 2, offerId: 'exact-offer' };
  await h.page.rideCommand('/api/rides/ride-one/accept', displayed, 'Fare agreed.');
  assert.deepEqual(h.commands, [{ path: '/api/rides/ride-one/accept', data: displayed }]);
  assert.ok(h.feedback.some(([name, message]) => name === 'notice' && message === 'Fare agreed.'));
});

test('a saved command with a failed refresh is reported accurately and is not submitted twice', async () => {
  const h = setup(); await h.page.refresh(); let writes = 0;
  await h.page.runAction(async () => {
    writes++; h.intercept(async () => { throw new Error('Offline'); }); return 'saved';
  }, 'Saved');
  assert.equal(writes, 1);
  assert.ok(h.feedback.some(([name, message]) => name === 'error' && message.includes('action was saved')));
});

test('sign-in, history selection and sign-out clear the previous account and reset feature controllers', async () => {
  const h = setup(); h.session(session(null)); await h.page.refresh();
  const history = { ...ride, id: 'completed-ride', status: 'completed', version: 9 };
  h.intercept(async (path) => {
    if (path === '/api/auth/login') { h.session(session(customer)); return session(customer); }
    if (path === '/api/auth/logout') { h.session(session(null)); return {}; }
    if (path === '/api/rides/completed-ride') return { ride: history };
  });
  await h.page.authenticate('/api/auth/login', { email: 'fixture@example.test', password: 'fixture' });
  assert.equal(h.rendered().user.id, customer.id); assert.ok(h.resets.includes('auth'));
  await h.page.openRide(history.id);
  assert.equal(h.page.snapshot().history[0].id, history.id);
  assert.ok(h.contexts.some(([name, , selected]) => name === 'payments' && selected?.id === history.id));
  await h.page.logout();
  assert.equal(h.rendered().user, null); assert.deepEqual(h.rendered().history, []);
});
