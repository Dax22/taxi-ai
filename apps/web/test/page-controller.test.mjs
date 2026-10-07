import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

// Resolve one browser import for Node fixtures; this is not browser/device QA.
const source = (await readFile(new URL('../public/dashboard/page-controller.mjs', import.meta.url), 'utf8'))
  .replace(/from\s+(['"])(.*?)\1/g, (_, quote, specifier) => `from${' '}'${new URL('../../../packages/shared/src/' + specifier.slice(8), import.meta.url)}'`);
const { createPageController } = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
const customer = { id: 'customer-one', role: 'customer', capabilities: ['customer'], name: 'Customer' };
const driver = { id: 'driver-one', role: 'driver', capabilities: ['customer', 'driver'], name: 'Driver', driver: { status: 'approved' } };
const admin = { id: 'admin-one', role: 'admin' };
const ride = { id: 'ride-one', status: 'negotiating', version: 2 };
const session = (user = customer, token = 'csrf-one') => ({ user, csrfToken: user ? token : null });
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };

test('confirmed Work deletion clears driver controls and restores Customer without signing out', async () => {
  const h = setup(); h.session(session(driver)); await h.page.refresh(); await h.page.switchMode('work');
  const deleted = { ...driver, capabilities: ['customer'], driver: null };
  h.session(session(deleted)); await h.page.driverDeleted(deleted);
  assert.equal(h.rendered().mode, 'customer'); assert.equal(h.rendered().user.role, 'customer');
  assert.equal(h.rendered().account.id, driver.id); assert.equal(h.rendered().account.driver, null);
  assert.ok(h.resets.includes('availability')); assert.ok(h.resets.includes('onboarding'));
  assert.ok(h.feedback.some(([name, message]) => name === 'notice' && /Work profile was deleted/.test(message)));
});

function setup(options = {}) {
  let current = session(), rendered, selected = null, intercept = async () => undefined;
  const requests = [], feedback = [], resets = [], contexts = [], commands = [];
  let mode = 'customer', writes = false, offline = true;
  const client = { setMode(value) { mode = value; }, pendingWrites: () => writes, reset() { resets.push('client'); }, setCsrf() {},
    async request(path, options) {
      requests.push(path);
      const result = await intercept(path, options); if (result !== undefined) return result;
      if (path === '/api/session') return current;
      if (path.startsWith('/api/rides?')) return { rides: [ride], available: [], matchingSettings: { allowSimulation: true } };
      if (path === '/api/chat') return { conversations: [{ rideId: ride.id, unread: 1 }] };
      if (path.startsWith('/api/rides/history?')) return { rides: [], nextBefore: null };
      if (path === '/api/admin/drivers') return { drivers: [driver] };
      if (path === '/api/admin/chat-reports') return { reports: [{ id: 'report-one' }] };
      throw new Error(`Unexpected fixture request ${path}`);
    },
    async rideCommand(path, data) { commands.push({ path, data }); return { ride }; },
    async command(path, data) {
      commands.push({ path, data });
      const result = await intercept(path, { method: 'POST', data });
      if (result?.user) current = { ...current, user: result.user };
      return result;
    },
  };
  const view = { render(next) { rendered = structuredClone(next); selected ??= next.rides[0]?.id; },
    reset() { resets.push('view'); selected = null; }, setBusy() {}, select(id) { selected = id; },
    selected() { return [...(rendered?.rides ?? []), ...(rendered?.history ?? [])].find((item) => item.id === selected); } };
  const feature = (name) => ({ reset() { resets.push(name); }, async poll() {}, async stop() {}, shutdown() {},
    async editVehicle() { contexts.push([name, 'editVehicle']); return true; },
    focus() { contexts.push([name, 'focus']); },
    setContext(...args) { contexts.push([name, ...args]); }, context(...args) { contexts.push([name, ...args]); },
    async show(...args) { contexts.push([name, ...args]); } });
  const calls = feature('calls'), sharing = feature('sharing'), availability = feature('availability');
  availability.prepareSwitch = async (confirmed) => confirmed || offline;
  const activityClient = { reset() { resets.push('activityClient'); }, setCsrf() {} };
  const page = createPageController({ ...options, client, activityClient, view, conversation: feature('conversation'), calls, sharing, availability, planner: feature('planner'), payments: feature('payments'),
    onboarding: feature('onboarding'), safety: feature('safety'),
    conversationView: { setBusy() {} }, authForm: { reset() { resets.push('auth'); } },
    feedback: Object.fromEntries(['clear', 'error', 'notice', 'synced', 'offline'].map((name) => [name, (...args) => feedback.push([name, ...args])])) });
  return { page, calls, sharing, availability, setWrites(value) { writes = value; }, setOffline(value) { offline = value; }, requests, feedback, resets, contexts, commands, rendered: () => rendered,
    session(next) { current = next; }, intercept(fn) { intercept = fn; } };
}

test('Courier entry opens customer booking despite saved Work mode, then respects explicit mode changes', async () => {
  const saved = new Map([[driver.id, 'work']]);
  const h = setup({ initialMode: 'customer', preferences: { get: (id) => saved.get(id), set: (id, value) => saved.set(id, value) } });
  h.session(session(driver)); h.setOffline(false);
  let offlineRequests = 0;
  h.availability.prepareSwitch = async (confirmed) => { offlineRequests++; return confirmed; };
  h.availability.stop = async () => { offlineRequests++; };
  await h.page.refresh();
  assert.equal(h.rendered().mode, 'customer'); assert.equal(h.rendered().user.role, 'customer');
  assert.equal(h.rendered().account.role, 'driver', 'the account and its capabilities stay unchanged');
  assert.ok(h.requests.includes('/api/rides?mode=customer'));
  assert.ok(!h.requests.includes('/api/rides?mode=work'));
  assert.equal(offlineRequests, 0, 'opening a booking link does not change Work availability');
  assert.equal(saved.get(driver.id), 'work', 'the entry intent does not overwrite the saved preference');
  assert.equal(await h.page.switchMode('work'), true);
  await h.page.refresh();
  assert.equal(h.rendered().mode, 'work', 'later refreshes do not replay the entry intent');
  assert.equal(await h.page.switchMode('customer'), false, 'later switches retain offline confirmation');
  assert.equal(h.page.snapshot().modePrompt, true);
  assert.equal(await h.page.switchMode('customer', true), true);
});

test('Courier entry intent survives anonymous checks until the first sign-in', async () => {
  const h = setup({ initialMode: 'customer', preferences: { get: () => 'work' } });
  h.session(session(null)); await h.page.refresh(); await h.page.refresh();
  assert.equal(h.rendered().user, null);
  h.intercept(async (path) => {
    if (path === '/api/auth/login') { h.session(session(driver)); return session(driver); }
  });
  await h.page.authenticate('/api/auth/login', { email: 'courier-sender@example.test', password: 'fixture' });
  assert.equal(h.rendered().mode, 'customer'); assert.equal(h.rendered().user.role, 'customer');
  assert.ok(h.requests.includes('/api/rides?mode=customer'));
  assert.ok(!h.requests.includes('/api/rides?mode=work'));
});

test('ordinary account entry retains saved Work mode and booking intent grants no administrator capabilities', async () => {
  const h = setup({ preferences: { get: () => 'work' } });
  h.session(session(driver)); await h.page.refresh();
  assert.equal(h.rendered().mode, 'work'); assert.equal(h.rendered().user.role, 'driver');
  assert.ok(h.requests.includes('/api/rides?mode=work'));
  const staff = setup({ initialMode: 'customer', preferences: { get: () => 'work' } });
  staff.session(session(admin)); await staff.page.refresh();
  assert.deepEqual(staff.rendered().user, admin);
  assert.ok(staff.requests.includes('/api/admin/drivers'));
  assert.ok(!staff.requests.some((path) => path.startsWith('/api/rides')));
  assert.equal(await staff.page.switchMode('customer'), false);
});

test('declining a timed offer refreshes Work without treating the result as a claimed journey', async () => {
  const h = setup(); h.session(session(driver));
  h.intercept(async (path) => {
    if (path === '/api/dispatch/offers/offer-one/decline') return { declined: true, replayed: false };
    if (path.startsWith('/api/rides?')) return { rides: [], available: [], matchingSettings: { allowSimulation: true, dispatchMode: 'sequential' } };
  });
  await h.page.refresh(); await h.page.switchMode('work');
  const result = await h.page.rideCommand('/api/dispatch/offers/offer-one/decline', {}, 'Offer declined.');
  assert.equal(result.declined, true);
  assert.deepEqual(h.commands.at(-1), { path: '/api/dispatch/offers/offer-one/decline', data: {} });
  assert.equal(h.rendered().dispatchMode, 'sequential');
  assert.ok(!h.feedback.some(([name]) => name === 'error'));
  assert.ok(h.feedback.some(([name, message]) => name === 'notice' && message === 'Offer declined.'));
});

test('vehicle edit enters Work, establishes the driver context and opens the editor on every click', async () => {
  const h = setup(); h.session(session(driver)); await h.page.refresh();
  assert.equal(h.rendered().mode, 'customer'); assert.equal(await h.page.editVehicle(), true);
  assert.equal(h.rendered().mode, 'work');
  assert.deepEqual(h.contexts.slice(-2), [['onboarding', h.rendered().user], ['onboarding', 'editVehicle']]);
  assert.equal(await h.page.editVehicle(), true);
  assert.equal(h.contexts.filter(([name, action]) => name === 'onboarding' && action === 'editVehicle').length, 2);
  h.session(session(customer)); await h.page.refresh(); assert.equal(await h.page.editVehicle(), false);
});

test('choosing a car saves the structured selection and opens the full application in Work on the same account', async () => {
  const h = setup(); await h.page.refresh();
  const vehicle = { make: 'Toyota', model: 'Corolla', year: 2020, colour: 'Blue', plate: 'TEST-001' };
  h.intercept(async (path) => path === '/api/account/driver-profile'
    ? { user: { ...customer, capabilities: ['customer', 'driver'], driver: { status: 'pending' } }, replayed: false } : undefined);
  await h.page.addDriver(vehicle);
  assert.deepEqual(h.commands, [{ path: '/api/account/driver-profile', data: { vehicle } }]);
  assert.equal(h.rendered().mode, 'work'); assert.equal(h.rendered().account.id, customer.id);
  assert.equal(h.rendered().user.role, 'driver'); assert.ok(h.contexts.some(([name, action]) => name === 'onboarding' && action === 'focus'));
  assert.ok(h.feedback.some(([name, message]) => name === 'notice' && /car details are saved/.test(message)));
});

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
    if (path.startsWith('/api/rides?')) throw Object.assign(new Error('Sign in'), { status: 401 });
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
    if (path.startsWith('/api/rides?')) return { rides: [{ ...ride, id: 'other-account-ride' }], available: [], matchingSettings: { allowSimulation: true } };
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


test('one account switches modes with isolated history, selections and cache resets, while session activity survives', async () => {
  const h = setup(); h.session(session(driver)); await h.page.refresh();
  const workRide = { ...ride, id: 'work-ride', customer, driver: { id: driver.id }, status: 'booked' };
  h.intercept(async (path) => path === '/api/rides?mode=work'
    ? { rides: [workRide], available: [], matchingSettings: { allowSimulation: true } } : undefined);
  h.calls.hasMedia = () => true; h.calls.snapshot = () => ({ selected: workRide });
  h.sharing.sharing = () => true; h.sharing.snapshot = () => ({ ride: workRide });
  h.resets.length = 0;
  assert.equal(await h.page.switchMode('work'), true);
  assert.equal(h.page.snapshot().user.role, 'driver'); assert.equal(h.page.snapshot().account.role, 'driver');
  assert.ok(h.requests.includes('/api/rides?mode=work'));
  assert.ok(h.requests.includes('/api/rides/history?mode=work'));
  assert.ok(h.resets.includes('payments')); assert.ok(h.resets.includes('conversation'));
  for (const name of ['calls', 'sharing', 'availability', 'activityClient']) assert.ok(!h.resets.includes(name), name);
  assert.equal(await h.page.switchMode('customer'), true);
  assert.equal(h.page.snapshot().user.role, 'customer'); assert.equal(h.page.snapshot().account.role, 'driver');
  const tracks = h.contexts.filter(([name]) => name === 'sharing');
  assert.ok(tracks.slice(-2).every(([, actor, selected]) => actor.role === 'driver' && selected.id === workRide.id));
  assert.ok(!h.resets.includes('calls')); assert.ok(!h.resets.includes('sharing'));
});

test('changing to Customer requires explicit offline confirmation and stays in Work on failure', async () => {
  const h = setup(); h.session(session(driver)); await h.page.refresh(); await h.page.switchMode('work');
  h.setOffline(false);
  assert.equal(await h.page.switchMode('customer'), false);
  assert.equal(h.page.snapshot().mode, 'work'); assert.equal(h.page.snapshot().modePrompt, true);
  h.page.cancelSwitch(); assert.equal(h.page.snapshot().modePrompt, false);
  h.availability.prepareSwitch = async () => { throw new Error('Offline confirmation failed'); };
  assert.equal(await h.page.switchMode('customer', true), false); assert.equal(h.page.snapshot().mode, 'work');
  h.availability.prepareSwitch = async (confirmed) => confirmed;
  assert.equal(await h.page.switchMode('customer', true), true);
});

test('late reads from the previous mode cannot populate the new mode and pending writes prevent switching', async () => {
  const h = setup(); h.session(session(driver)); await h.page.refresh();
  const wait = deferred(); let waiting = false;
  h.intercept(async (path) => { if (path === '/api/rides?mode=customer') { waiting = true; return wait.promise; } });
  const old = h.page.refresh();
  while (!waiting) await new Promise((resolve) => setImmediate(resolve));
  assert.equal(await h.page.switchMode('work'), true);
  wait.resolve({ rides: [{ ...ride, id: 'late-customer-trip' }], available: [], matchingSettings: { allowSimulation: true } });
  await old;
  assert.equal(h.page.snapshot().mode, 'work');
  assert.ok(!h.page.snapshot().rides.some((item) => item.id === 'late-customer-trip'));
  h.setWrites(true); assert.equal(await h.page.switchMode('customer'), false);
  assert.equal(h.page.snapshot().mode, 'work');
  assert.ok(h.feedback.some(([name, text]) => name === 'error' && text.includes('current action')));
});

test('an unavailable mode cannot be selected and an enrolled driver profile does not require another login', async () => {
  const h = setup(); await h.page.refresh();
  assert.equal(await h.page.switchMode('work'), false); assert.equal(h.page.snapshot().mode, 'customer');
  // Adding capabilities through a server session does not invalidate the cookie or activity contexts.
  h.session(session({ ...customer, capabilities: ['customer', 'driver'], driver: { status: 'pending' } }));
  h.resets.length = 0; await h.page.refresh();
  assert.equal(await h.page.switchMode('work'), true);
  assert.equal(h.page.snapshot().user.id, customer.id);
  assert.ok(!h.resets.includes('activityClient'));
});

test('ride and parcel progress require a fresh shared position and guide the driver without blocking completion or cancellation', async () => {
  let focused = 0, now = 1_000_000;
  const h = setup({ serverNow: () => now, onLocationRequired: () => { focused++; } });
  h.session(session(driver)); await h.page.refresh(); await h.page.switchMode('work');
  const active = { ...ride, status: 'booked' }; let tracking = { ride: active, share: null };
  h.sharing.snapshot = () => tracking;
  for (const action of ['depart', 'arrive', 'start']) await h.page.rideCommand(`/api/rides/${ride.id}/${action}`, {});
  assert.equal(h.commands.length, 0); assert.equal(focused, 3); assert.match(h.feedback.at(-1)[1], /Share my location is required/);
  tracking = { ride: active, share: { active: true, stale: false, position: { capturedAt: now - 30_000 } } };
  await h.page.rideCommand(`/api/rides/${ride.id}/depart`, {}); assert.equal(h.commands.length, 0);
  tracking.share.position.capturedAt = now; await h.page.rideCommand(`/api/rides/${ride.id}/depart`, {}); assert.equal(h.commands.length, 1);
  tracking.share = null;
  await h.page.rideCommand(`/api/rides/${ride.id}/complete`, {}); await h.page.rideCommand(`/api/rides/${ride.id}/cancel`, {});
  assert.equal(h.commands.length, 3); assert.equal(focused, 4);
});


test('fresh closed journey state replaces stale media context and reaches call teardown immediately', async () => {
  const h = setup(); await h.page.refresh();
  h.calls.hasMedia = () => true;
  h.calls.snapshot = () => ({ selected: ride });
  const completed = { ...ride, status: 'completed', version: 9 };
  h.intercept(async path => path.startsWith('/api/rides?')
    ? { rides: [completed], available: [], matchingSettings: { allowSimulation: false,
        passengerRides: { paused: true, coverage: 'nigeria' } } } : undefined);
  await h.page.refresh();
  assert.equal(h.contexts.filter(([name]) => name === 'calls').at(-1)[2].status, 'completed');
  assert.deepEqual(h.page.snapshot().passengerRides, { paused: true, coverage: 'nigeria' });
  h.session(session(null)); await h.page.refresh();
  assert.equal(h.page.snapshot().passengerRides, null);
});
