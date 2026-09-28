import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const uri = (source) => `data:text/javascript,${encodeURIComponent(source)}`;
async function browser(name) {
  let source = await readFile(new URL(`../public/dashboard/${name}.mjs`, import.meta.url), 'utf8');
  for (const file of ['locations', 'matching', 'demo-booking']) source = source.replaceAll(`'/shared/${file}.mjs'`, `'${new URL(`../../../packages/shared/src/${file}.mjs`, import.meta.url)}'`);
  source = source.replaceAll("'./dom.mjs'", `'${new URL('../public/dashboard/dom.mjs', import.meta.url)}'`);
  return import(uri(source));
}
const { createAvailabilityController } = await browser('availability-controller');
const { createAvailabilityView } = await browser('availability-view');
const wait = () => new Promise((resolve) => setImmediate(resolve));
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { resolve, reject, promise }; };
const driver = { id: 'driver', role: 'driver', driver: { status: 'approved', eligibility: { eligible: true, reviewStatus: 'approved' } } };

async function setup(account = driver) {
  const f = { time: 1000000, availability: null, locates: 0, watches: 0, clears: 0, requests: [], commands: [], allowSimulation: true };
  f.fix = () => ({ coords: { latitude: 9.08, longitude: 7.4, accuracy: 12 }, timestamp: f.time });
  const device = { supported: () => true,
    async locate() { f.locates++; return f.locateHook ? f.locateHook() : f.fix(); },
    watch(success, failure) { f.watches++; f.onFix = success; f.onError = failure; f.watchHook?.(success, failure); return () => { f.clears++; }; },
  };
  const client = {
    async command(path, data, options) {
      f.commands.push({ path, data, options }); if (f.commandHook) return f.commandHook(path, data);
      f.availability = path.endsWith('/online') ? { id: `lease-${f.commands.length}`, online: true, owned: true, sequence: 1,
        mode: data.mode, areaId: data.areaId, expiresAt: f.time + (data.mode === 'gps' ? 30000 : 60000) } : null;
      return { availability: f.availability };
    },
    async request(path, options) {
      f.requests.push({ path, options }); if (f.requestHook) return f.requestHook(path, options);
      if (path.endsWith('/position')) f.availability = { ...f.availability, sequence: options.data.sequence,
        expiresAt: f.time + (f.availability.mode === 'gps' ? 30000 : 60000) };
      return { availability: f.availability, settings: { allowSimulation: f.allowSimulation } };
    },
  };
  f.c = createAvailabilityController({ client, device, makeId: () => 'test-window', now: () => f.time, serverNow: () => f.time,
    view: { render: (value) => { f.state = value; } } });
  f.c.context(account); await f.c.poll(); return f;
}

test('availability polls without accessing GPS and sample-area consent sends no device position', async () => {
  const f = await setup(); assert.equal(f.locates, 0); assert.equal(f.watches, 0); assert.equal(f.commands.length, 0);
  await f.c.start('sample', 'wuse-ii'); assert.equal(f.locates, 0); assert.equal(f.watches, 0);
  assert.deepEqual(f.commands[0].data, { mode: 'sample', areaId: 'wuse-ii' });
  f.time += 10000; f.c.tick(); await wait();
  assert.deepEqual(f.requests.at(-1).options.data, { sequence: 2 });
  await f.c.stop(); assert.equal(f.c.active(), false);
  const hosted = await setup(); hosted.allowSimulation = false; await hosted.c.poll(); await hosted.c.start('sample', 'wuse-ii');
  assert.equal(hosted.commands.length, 0);
  const customer = await setup({ id: 'customer', role: 'customer' }); await customer.c.start(); assert.equal(customer.locates, 0);
});

test('GPS starts only on consent, reacquires a stationary fix, and immediately stops its watch on offline', async () => {
  const f = await setup(); await f.c.start(); assert.equal(f.locates, 1); assert.equal(f.watches, 1);
  assert.equal(f.commands[0].data.position.lat, 9.08);
  f.time += 10000; f.c.tick(); await wait(); assert.equal(f.locates, 1);
  f.time += 10000; f.c.tick(); await wait(); assert.equal(f.locates, 2, 'stationary devices need a fresh acquisition');
  assert.equal(f.requests.at(-1).options.data.position.capturedAt, f.time);
  const ending = f.c.stop(); assert.equal(f.clears, 1); assert.equal(f.c.active(), false); await ending;
  f.onFix(f.fix()); f.time += 10000; f.c.tick(); await wait(); assert.equal(f.c.active(), false);
});

test('permission denial, inaccurate/outside locations and missing approval do not create online availability', async () => {
  for (const reason of ['denied', 'outside', 'accuracy']) {
    const f = await setup(); f.locateHook = async () => {
      if (reason === 'denied') throw { code: 1 };
      const point = f.fix(); if (reason === 'outside') point.coords.latitude = 41; else point.coords.accuracy = 201; return point;
    };
    await f.c.start(); assert.equal(f.commands.length, 0); assert.equal(f.watches, 0); assert.equal(f.c.active(), false);
  }
  const pending = await setup({ ...driver, driver: { status: 'pending' } }); await pending.c.start(); assert.equal(pending.locates, 0);
});

test('late permission and online responses after cancellation or account change cannot restart location updates', async () => {
  const f = await setup(), permission = deferred(); f.locateHook = () => permission.promise;
  const start = f.c.start(); await f.c.stop(); permission.resolve(f.fix()); await start;
  assert.equal(f.commands.length, 0); assert.equal(f.watches, 0);
  const g = await setup(), response = deferred();
  g.commandHook = async (path) => path.endsWith('/online') ? response.promise : { availability: null };
  const starting = g.c.start(); await wait(); g.c.context({ id: 'new-user', role: 'customer' });
  response.resolve({ availability: { id: 'late-lease', online: true, owned: true } }); await starting; await wait();
  assert.equal(g.watches, 0); assert.equal(g.c.snapshot().availability, null);
  assert.ok(g.commands.some((entry) => entry.path === '/api/availability/late-lease/offline'));
});

test('claim, remote closure, session failure, GPS errors and lost contact stop without automatic resumption', async () => {
  for (const reason of ['claimed', 'closed', 'session', 'gps', 'contact']) {
    const f = await setup(); await f.c.start();
    if (reason === 'claimed') f.c.context(driver, true);
    if (reason === 'closed') { f.availability = null; await f.c.poll(); }
    if (reason === 'session') { f.requestHook = async () => { throw Object.assign(new Error('Sign in'), { status: 401 }); }; await f.c.poll(); }
    if (reason === 'gps') f.onError({ code: 1 });
    if (reason === 'contact') { f.time += 35000; f.c.tick(); }
    await wait(); assert.equal(f.clears, 1, reason); assert.equal(f.c.active(), false, reason);
    f.c.context(driver, false); await f.c.poll(); assert.equal(f.locates, 1, reason);
  }
  const sync = await setup(); sync.watchHook = (_, failure) => failure({ code: 1 });
  await sync.c.start(); await wait(); assert.equal(sync.clears, 1); assert.equal(sync.c.active(), false);
});

test('an old poll cannot replace a newer location acknowledgement and pending GPS has a deadline', async () => {
  const f = await setup(); await f.c.start(); const stale = { ...f.availability };
  f.time += 10000; f.c.tick(); await wait(); assert.equal(f.c.snapshot().availability.sequence, 2);
  f.requestHook = async () => ({ availability: stale, settings: { allowSimulation: true } }); await f.c.poll();
  assert.equal(f.c.snapshot().availability.sequence, 2);
  const g = await setup(), pending = deferred(); g.locateHook = () => pending.promise;
  const start = g.c.start(); g.time += 20000; g.c.tick(); await wait();
  pending.resolve(g.fix()); await start; assert.equal(g.commands.length, 0); assert.equal(g.c.active(), false);
});

test('availability view exposes explicit consent, a usable stop button, and hides simulation for hosted settings', async (t) => {
  const original = globalThis.document;
  const html = await readFile(new URL('../public/dashboard.html', import.meta.url), 'utf8');
  const ids = new Set([...html.matchAll(/id="([^"]+)"/g)].map((match) => match[1])), nodes = new Map();
  class Node {
    value = ''; hidden = false; disabled = false; textContent = ''; handlers = {}; children = [];
    addEventListener(name, handler) { this.handlers[name] = handler; }
    append(...children) { this.children.push(...children); }
  }
  const node = (id) => { assert.ok(ids.has(id), id); if (!nodes.has(id)) nodes.set(id, new Node()); return nodes.get(id); };
  globalThis.document = { getElementById: node, createElement: () => new Node() };
  t.after(() => { globalThis.document = original; });
  const events = [], view = createAvailabilityView({ onOnline: (...args) => events.push(args), onOffline: () => events.push('offline') });
  const state = { user: driver, busy: false, pending: false, ending: false, running: false, availability: null, online: false, settings: { allowSimulation: false }, supported: true };
  view.render(state); assert.equal(node('availability-sample').hidden, true); assert.equal(node('availability-online').disabled, false);
  node('availability-online').handlers.click(); assert.deepEqual(events[0], ['gps']);
  view.render({ ...state, pending: true }); assert.equal(node('availability-offline').hidden, false); assert.equal(Boolean(node('availability-offline').disabled), false);
  node('availability-offline').handlers.click(); assert.equal(events.at(-1), 'offline');
  view.render({ ...state, settings: { allowSimulation: true } }); assert.equal(node('availability-sample').hidden, false);
  node('availability-area').value = 'jabi'; node('availability-sample-online').handlers.click(); assert.deepEqual(events.at(-1), ['sample', 'jabi']);
  view.render({ ...state, busy: true }); assert.equal(node('availability-online').disabled, true);
  view.render({ ...state, user: { id: 'customer', role: 'customer' } }); assert.equal(node('availability-panel').hidden, true);
  assert.match(html, /Customers cannot see this location/);
});

test('mode switching checks server availability, requires consent and confirms offline after the write', async () => {
  const f = await setup(); await f.c.start(); const count = f.commands.length;
  assert.equal(await f.c.prepareSwitch(), false);
  assert.equal(f.commands.length, count); assert.equal(f.clears, 0);
  f.commandHook = async () => { throw new Error('Offline write failed'); };
  await assert.rejects(f.c.prepareSwitch(true), /Offline write failed/);
  assert.equal(f.clears, 1); assert.equal(f.c.snapshot().availability.online, true);
  f.commandHook = null;
  assert.equal(await f.c.prepareSwitch(true), true); assert.equal(f.c.snapshot().availability, null);
  const other = await setup(); other.availability = { id: 'other-window', online: true, owned: false };
  assert.equal(await other.c.prepareSwitch(), false);
  other.commandHook = async () => ({ availability: null }); // A different window immediately came online again.
  await assert.rejects(other.c.prepareSwitch(true), /another window/);
});
