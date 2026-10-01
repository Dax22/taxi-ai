import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
const uri = (source) => `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;
const shared = (name) => new URL(`../../../packages/shared/src/${name}.mjs`, import.meta.url).href;
const sharingSource = (await readFile(new URL('../public/dashboard/location-sharing.mjs', import.meta.url), 'utf8')).replace("'/shared/locations.mjs'", JSON.stringify(shared('locations')));
const source = (await readFile(new URL('../public/eats/tracking.mjs', import.meta.url), 'utf8'))
  .replace("'../dashboard/location-sharing.mjs'", JSON.stringify(uri(sharingSource))).replace("'/shared/food-tracking.mjs'", JSON.stringify(shared('food-tracking')));
const { createFoodTracking, foodTrackingActive, foodTrackingOrder } = await import(uri(source));
const mapSource = (await readFile(new URL('../public/dashboard/map-view.mjs', import.meta.url), 'utf8'))
  .replace("'/shared/locations.mjs'", JSON.stringify(shared('locations'))).replace("'/shared/vehicle-profile.mjs'", JSON.stringify(shared('vehicle-profile')))
  .replace("'./dom.mjs'", JSON.stringify(new URL('../public/dashboard/dom.mjs', import.meta.url).href));
const viewSource = (await readFile(new URL('../public/eats/tracking-view.mjs', import.meta.url), 'utf8'))
  .replace("'../dashboard/map-view.mjs'", JSON.stringify(uri(mapSource))).replace("'/shared/eats.mjs'", JSON.stringify(shared('eats')))
  .replace("'../dashboard/dom.mjs'", JSON.stringify(new URL('../public/dashboard/dom.mjs', import.meta.url).href));
const { createFoodTrackingView } = await import(uri(viewSource));
const uuid = (n) => `00000000-0000-4000-a000-${String(n).padStart(12,'0')}`;
const courier = { id: uuid(1), role: 'customer', driver: { status: 'approved' } };
const order = { id: uuid(2), role: 'courier', fulfillment: 'delivery', status: 'assigned', address: { line: '20 Fictional Close', point: { lat: 9.08, lng: 7.4 } } };
const flush = () => new Promise((resolve) => setImmediate(resolve));
const deferred = () => { let resolve; const promise = new Promise((done) => { resolve = done; }); return { promise, resolve }; };
function fixture() {
  const f = { now: 1_000_000, locates: 0, watches: 0, clears: 0, commands: [], requests: [], focused: 0, current: order, share: null };
  const dto = () => ({ serverNow: f.now, orderId: f.current.id, isCourier: f.current.role === 'courier', canShare: f.current.role === 'courier', required: f.current.role === 'courier', share: f.share });
  const result = () => ({ serverNow: f.now, replayed: false, share: f.share });
  f.device = { supported: () => true, async locate() { f.locates++; return { coords: { latitude: 9.08, longitude: 7.4, accuracy: 12 }, timestamp: f.now }; }, watch(fix, error) { f.watches++; f.fix = fix; f.fail = error; return () => { f.clears++; }; } };
  f.transport = {
    async request(path, options) { f.requests.push({ path, options }); if (options?.method === 'POST') { f.share = { ...f.share, sequence: options.data.sequence, updatedAt: f.now, position: { ...options.data }, stale: false }; return result(); } return dto(); },
    async command(path, data, key, options) { f.commands.push({ path, data, key, options }); if (path.endsWith('/start')) f.share = { id: uuid(3), orderId: f.current.id, active: true, owned: true, sequence: 0, startedAt: f.now, updatedAt: null, stale: true, position: null }; else f.share = { ...f.share, active: false, position: null, updatedAt: null, stale: true }; return result(); },
  };
  f.c = createFoodTracking({ transport: f.transport, device: f.device, now: () => f.now, serverNow: () => f.now, makeId: () => uuid(4),
    view: { renderTracking(state) { f.rendered = state; }, resetTracking() { f.rendered = null; }, focusSharing() { f.focused++; } } });
  f.context = (next, account = courier) => { f.current = next; f.c.context(account, next); };
  f.context(order); return f;
}

test('food tracking only requests GPS explicitly and uses isolated food endpoints with the browser client header', async () => {
  const f = fixture(); await f.c.poll(); f.c.tick(); assert.equal(f.locates, 0); assert.equal(f.watches, 0);
  assert.equal(f.requests[0].path, `/eats/orders/${order.id}/tracking`); assert.equal(f.requests[0].options.locationClient, uuid(4));
  assert.equal(f.c.beforeAction(order, 'pickup'), false); assert.equal(f.focused, 1); assert.equal(f.locates, 0);
  await f.c.start(); await flush(); assert.equal(f.locates, 1); assert.equal(f.watches, 1);
  assert.equal(f.commands[0].path, `/eats/orders/${order.id}/tracking/start`); assert.equal(f.commands[0].options.locationClient, uuid(4));
  assert.equal(f.requests.at(-1).path, `/eats/tracking/shares/${uuid(3)}/position`); assert.equal(f.c.beforeAction(order, 'pickup'), true);
  f.now += 30_000; assert.equal(f.c.beforeAction(order, 'arrive'), false); assert.equal(f.c.beforeAction(order, 'deliver'), true); assert.equal(f.c.beforeAction(order, 'cancel'), true);
  await f.c.stop(); assert.equal(f.commands.at(-1).path, `/eats/tracking/shares/${uuid(3)}/stop`); assert.equal(f.clears, 1);
});

test('buyers, kitchens, pickup orders and completed deliveries never start courier GPS', async () => {
  const f = fixture();
  for (const next of [{ ...order, role: 'customer' }, { ...order, role: 'store' }, { ...order, fulfillment: 'pickup' }, { ...order, status: 'delivered' }]) {
    f.context(next); await f.c.start(); assert.equal(f.locates, 0);
  }
  assert.equal(foodTrackingActive({ ...order, role: 'admin' }), false); assert.equal(f.c.snapshot().order, null);
});

test('terminal orders release food GPS and late permission results cannot start a replacement account', async () => {
  const f = fixture(); await f.c.start(); await flush(); f.context({ ...order, status: 'delivered' }); await flush();
  assert.equal(f.clears, 1); assert.equal(f.c.snapshot().order, null); assert.match(f.commands.at(-1).path, /\/stop$/);
  const g = fixture(), location = deferred(); g.device.locate = () => location.promise; const pending = g.c.start();
  g.c.reset(); g.context({ ...order, role: 'customer' }, { id: uuid(10), role: 'customer' });
  location.resolve({ coords: { latitude: 9.08, longitude: 7.4, accuracy: 12 }, timestamp: g.now }); await pending;
  assert.equal(g.commands.length, 0); assert.equal(g.watches, 0);
});

test('food tracking rejects a response for another order and does not display its private position', async () => {
  const f = fixture(); f.transport.request = async () => ({ serverNow: f.now, orderId: uuid(99), isCourier: true, canShare: true, required: true, share: null });
  await f.c.poll(); assert.match(f.rendered.error, /incompatible food tracking response/); assert.equal(f.c.snapshot().share, null);
});

test('an active courier keeps sharing while navigating Eats and a refreshed terminal order wins', () => {
  const current = { order, sharing: true };
  assert.equal(foodTrackingOrder({ screen: 'browse' }, current), order);
  assert.equal(foodTrackingOrder({ screen: 'order', order: { ...order, id: uuid(8), role: 'customer' } }, current), order);
  const terminal = { ...order, status: 'delivered' }; assert.equal(foodTrackingOrder({ screen: 'order', order: terminal }, current), terminal);
  assert.equal(foodTrackingOrder({ screen: 'browse' }, { order: { ...order, role: 'customer' }, sharing: false }), null);
});

const html = await readFile(new URL('../public/eats.html', import.meta.url), 'utf8');
function viewFixture(t, loadSettings) {
  const old = globalThis.document, nodes = new Map(), maps = [], actions = [];
  class Node { hidden = false; disabled = false; handlers = {}; textContent = ''; focused = 0; scrolls = 0; addEventListener(type, handler) { this.handlers[type] = handler; } focus() { this.focused++; } scrollIntoView() { this.scrolls++; } }
  for (const [, id] of html.matchAll(/id="([^"]+)"/g)) nodes.set(id, new Node());
  globalThis.document = { getElementById(id) { assert.ok(nodes.has(id), id); return nodes.get(id); } }; t.after(() => { globalThis.document = old; });
  let loads = 0; const view = createFoodTrackingView({ onStart: () => actions.push('start'), onStop: () => actions.push('stop'),
    loadSettings: async () => { loads++; return loadSettings ? loadSettings() : { enabled: true, tiles: 'https://map.test/{z}/{x}/{y}.png', attribution: 'Map provider' }; },
    createMap: () => ({ render(state) { maps.push(state); }, reset() { maps.push({ enabled: false }); } }) });
  const state = { user: courier, order, now: 1_000_000, supported: true, share: null, error: '', pending: false, ending: false, sharing: false };
  return { view, node: (id) => nodes.get('food-tracking' + (id ? '-' + id : '')), maps, actions, state, loads: () => loads };
}

test('food courier controls explain the requirement and buyer maps load only on explicit action with honest missing and stale GPS', async (t) => {
  const f = viewFixture(t); f.view.renderTracking(f.state);
  assert.match(f.node('guidance').textContent, /required.*before collecting/); assert.match(f.node('device').textContent, /cannot guarantee/);
  assert.equal(f.loads(), 0); assert.equal(f.maps.at(-1).enabled, false); assert.equal(f.maps.at(-1).driver, null);
  f.view.focusSharing(); assert.equal(f.node('start').focused, 1); f.node('start').handlers.click(); assert.deepEqual(f.actions, ['start']);
  const buyer = { ...f.state, order: { ...order, role: 'customer' } }; f.view.renderTracking(buyer);
  assert.equal(f.node('start').hidden, true); assert.equal(f.node('stop').hidden, true); assert.match(f.node('status').textContent, /after the food is collected/); assert.match(f.node('guidance').textContent, /hidden to protect a private pickup/);
  await f.node('map-toggle').handlers.click(); assert.equal(f.loads(), 1); assert.equal(f.maps.at(-1).enabled, true);
  assert.equal(f.maps.at(-1).driver, null); assert.deepEqual(f.maps.at(-1).destination, { ...order.address.point, name: 'Delivery destination' });
  f.view.renderTracking({ ...buyer, share: { active: true, position: { lat: 9.1, lng: 7.4, capturedAt: 970000, accuracy: 12 }, stale: false } });
  assert.match(f.node('status').textContent, /Last known.*30s old/); assert.equal(f.maps.at(-1).stale, true);
  f.view.resetTracking(); assert.equal(f.node('').hidden, true); assert.equal(f.maps.at(-1).enabled, false);
});

test('map errors preserve manual delivery details and a late map response cannot reopen another account’s map', async (t) => {
  const late = deferred(), f = viewFixture(t, () => late.promise); f.view.renderTracking(f.state);
  const pending = f.node('map-toggle').handlers.click(); f.view.resetTracking();
  f.view.renderTracking({ ...f.state, user: { id: uuid(90) }, order: { ...order, id: uuid(91), role: 'customer' } });
  late.resolve({ enabled: true, tiles: 'https://map.test/{z}/{x}/{y}.png' }); await pending;
  assert.equal(f.maps.at(-1).enabled, false); assert.equal(f.node('map').hidden, true);
});

test('unavailable online maps keep the delivery address readable without inventing a courier pin', async (t) => {
  const f = viewFixture(t, async () => { throw new Error('Map provider unavailable'); }); f.view.renderTracking(f.state);
  await f.node('map-toggle').handlers.click();
  assert.match(f.node('map-note').textContent, /could not load/); assert.match(f.node('destination').textContent, /20 Fictional Close/);
  assert.equal(f.maps.at(-1).enabled, false); assert.equal(f.maps.at(-1).driver, null); assert.equal(f.node('start').disabled, false);
  f.view.resetTracking(); assert.equal(f.node('destination').textContent, ''); assert.equal(f.node('job').textContent, '');
});
