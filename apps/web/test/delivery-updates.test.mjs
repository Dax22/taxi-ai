import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const moduleUri = source => `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;
const source = (await readFile(new URL('../public/dashboard/delivery-updates.mjs', import.meta.url), 'utf8'))
  .replace("'/shared/delivery-updates.mjs'", JSON.stringify(new URL('../../../packages/shared/src/delivery-updates.mjs', import.meta.url).href));
const { createDeliveryUpdates, foodDeliveryTarget, parcelDeliveryTarget, deliveryUpdatePath } = await import(moduleUri(source));
const viewSource = (await readFile(new URL('../public/dashboard/delivery-update-view.mjs', import.meta.url), 'utf8'))
  .replace("'./dom.mjs'", JSON.stringify(new URL('../public/dashboard/dom.mjs', import.meta.url).href));
const { createDeliveryUpdateView } = await import(moduleUri(viewSource));
const uuid = n => `00000000-0000-4000-a000-${String(n).padStart(12, '0')}`;
const account = { user: { id: uuid(1) }, csrfToken: 'session-one' }, identity = `${account.user.id}:${account.csrfToken}`;
const target = { kind: 'food', targetId: uuid(2) };
const pickup = { id: uuid(3), ...target, phase: 'picked_up', title: 'Kemmy · Food collected',
  body: 'Your food has been picked up. It should be delivered in approximately 18 minutes.', note: 'Map route estimate. Traffic may change the time.', etaMinutes: 18, createdAt: 1000, readAt: null };
const arrival = { ...pickup, id: uuid(4), phase: 'arrived', title: 'Kemmy · Food has arrived', body: 'Your food has arrived at the delivery address.', etaMinutes: null, createdAt: 2000 };
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
function setup() {
  const f = { session: account, notices: [pickup], update: pickup, renders: [], calls: [], destinations: [], hook: null };
  f.client = { async request(path, options) {
    f.calls.push({ path, options }); if (f.hook) { const result = f.hook(path, options); if (result !== undefined) return result; }
    if (path === '/api/session') return f.session;
    if (path === '/api/delivery-updates') return { updates: f.notices, unread: f.notices.length, nextBefore: null };
    if (path.endsWith('/open')) return { target: { screen: 'food-order', id: target.targetId } };
    return { update: f.update };
  } };
  f.c = createDeliveryUpdates({ client: f.client, view: { render(s) { f.renders.push(structuredClone(s)); } }, onOpen: value => f.destinations.push(value) });
  f.c.context(identity, target); f.state = () => f.renders.at(-1); return f;
}

test('Kemmy uses saved road ETA and emits each unread milestone only once while the page stays open', async () => {
  const f = setup(); await f.c.poll(); assert.deepEqual(f.state().update, pickup); assert.equal(f.state().alert.id, pickup.id);
  f.c.dismiss(); await f.c.poll(); assert.equal(f.state().alert, null); assert.equal(f.state().update.etaMinutes, 18);
  f.update = arrival; f.notices = [arrival, pickup]; await f.c.poll(); assert.equal(f.state().alert.phase, 'arrived');
  assert.equal(f.state().update.etaMinutes, null); f.c.dismiss(); await f.c.poll(); assert.equal(f.state().alert, null);
});

test('a same-ID ETA enrichment replaces the displayed snapshot without replaying a dismissed notification', async () => {
  const f = setup(); f.update = { ...pickup, etaMinutes: null, body: 'Your food has been picked up. A map ETA is not available yet.' }; f.notices = [f.update];
  await f.c.poll(); assert.equal(f.state().alert.etaMinutes, null);
  f.update = pickup; f.notices = [pickup]; await f.c.poll(); assert.equal(f.state().alert.etaMinutes, 18); assert.equal(f.state().update.etaMinutes, 18);
  f.c.dismiss(); await f.c.poll(); assert.equal(f.state().alert, null);
});

test('revocation during a pending detail read clears that delivery without discarding an unrelated feed update', async () => {
  const f = setup(); await f.c.poll(); const wait = deferred();
  const other = { ...arrival, targetId: uuid(9) }; f.notices = [other, pickup];
  f.hook = path => path.includes(`/food/${target.targetId}`) ? wait.promise : undefined;
  const reading = f.c.poll(); wait.reject(Object.assign(new Error('Not found'), { status: 404 })); await reading;
  assert.equal(f.state().update, null); assert.equal(f.state().alert.id, other.id); assert.match(f.state().error, /no longer available/);
  const g = setup(); await g.c.poll(); g.hook = path => path.includes(`/food/${target.targetId}`) ? Promise.reject(Object.assign(new Error('Not found'), { status: 404 })) : undefined;
  await g.c.poll(); assert.equal(g.state().alert, null); assert.equal(g.state().update, null);
});

test('a displayed alert removed from the authorized feed cannot linger after a parcel invitation is revoked', async () => {
  const f = setup(); await f.c.poll(); f.notices = []; f.update = null; await f.c.poll();
  assert.equal(f.state().alert, null); assert.equal(f.state().update, null);
});

test('concurrent polls coalesce and a replacement account cannot receive late messages or ETA', async () => {
  const f = setup(), wait = deferred(); f.hook = path => path === '/api/delivery-updates' ? wait.promise : undefined;
  const first = f.c.poll(); const second = f.c.poll(); assert.equal(first, second);
  f.c.context(`${uuid(8)}:another-session`, target); wait.resolve({ updates: [pickup], unread: 1, nextBefore: null }); await first;
  assert.equal(f.state().update, null); assert.equal(f.state().alert, null);
});

test('cookie replacement clears previous messages and target navigation discards an old detail response', async () => {
  const f = setup(); await f.c.poll(); f.session = { user: { id: uuid(8) }, csrfToken: 'other' };
  await f.c.poll(); assert.equal(f.state().identity, null); assert.equal(f.state().update, null); assert.equal(f.state().alert, null);
  const g = setup(), wait = deferred(); g.hook = path => path.includes(`/food/${target.targetId}`) ? wait.promise : undefined;
  const read = g.c.poll(); g.c.context(identity, { kind: 'parcel', targetId: uuid(9) }); wait.resolve({ update: pickup }); await read;
  assert.equal(g.state().update, null); assert.equal(g.state().target.kind, 'parcel');
});

test('opening an alert requires a new authorized target and never trusts a supplied URL or sends twice', async () => {
  const f = setup(); await f.c.poll(); const wait = deferred();
  f.hook = path => path.endsWith('/open') ? wait.promise : undefined;
  const opening = f.c.open(); await f.c.open(); await new Promise(resolve => setImmediate(resolve));
  assert.equal(f.calls.filter(call => call.path.endsWith('/open')).length, 1);
  wait.resolve({ target: { screen: 'parcels', id: uuid(9), url: 'https://untrusted.test/' } }); await opening;
  assert.deepEqual(f.destinations, [{ screen: 'parcels', id: uuid(9) }]); assert.equal(f.state().alert, null);
  assert.equal(deliveryUpdatePath(f.destinations[0]), `/parcels?id=${uuid(9)}`);
});

test('opening a revoked notification clears its previously displayed content and never navigates', async () => {
  const f = setup(); await f.c.poll();
  f.hook = path => path.endsWith('/open') ? Promise.reject(Object.assign(new Error('This delivery is unavailable.'), { status: 404 })) : undefined;
  await f.c.open(); assert.equal(f.state().update, null); assert.equal(f.state().alert, null); assert.equal(f.destinations.length, 0);
  const g = setup(); await g.c.poll(); g.session = { user: { id: uuid(8) }, csrfToken: 'other' };
  await g.c.open(); assert.equal(g.calls.some(call => call.path.endsWith('/open')), false); assert.equal(g.state().identity, null);
});

test('unavailable routing stays unavailable and malformed or mismatched notice data is never displayed', async () => {
  const f = setup(); f.update = { ...pickup, etaMinutes: null, body: 'Your food has been picked up. A map ETA is not available.' };
  f.notices = [f.update]; await f.c.poll(); assert.equal(f.state().update.etaMinutes, null);
  const g = setup(); g.update = { ...pickup, targetId: uuid(44) }; await g.c.poll(); assert.equal(g.state().update, null); assert.equal(g.state().alert.id, pickup.id); assert.match(g.state().error, /could not refresh/);
});

test('customer pickup, sellers, couriers, passengers and unrelated accounts do not mount a delivery detail card', () => {
  const order = { id: uuid(2), role: 'customer', fulfillment: 'delivery' }; assert.deepEqual(foodDeliveryTarget(order), target);
  for (const role of ['store', 'courier', 'admin']) assert.equal(foodDeliveryTarget({ ...order, role }), null);
  assert.equal(foodDeliveryTarget({ ...order, fulfillment: 'pickup' }), null);
  const user = { id: uuid(1), role: 'customer' }, ride = { id: uuid(4), customer: user, delivery: {} };
  assert.equal(parcelDeliveryTarget(user, ride).kind, 'parcel'); assert.equal(parcelDeliveryTarget(user, { ...ride, delivery: null }), null);
  assert.equal(parcelDeliveryTarget({ ...user, id: uuid(8) }, ride), null); assert.equal(parcelDeliveryTarget({ ...user, role: 'driver' }, ride), null);
});

class Node {
  constructor(tag = 'section') { this.tag = tag; }
  children = []; handlers = {}; attributes = {}; textContent = ''; hidden = false; classList = { add() {} };
  append(...nodes) { this.children.push(...nodes); }
  setAttribute(key, value) { this.attributes[key] = value; }
  addEventListener(event, callback) { this.handlers[event] = callback; }
}
const all = root => [root, ...root.children.flatMap(all)];
test('delivery card and new-update banner use accessible text nodes, show recorded estimate and clear all account content', t => {
  const old = globalThis.document; globalThis.document = { createElement: tag => new Node(tag) }; t.after(() => { globalThis.document = old; });
  const root = new Node(), banner = new Node(); let opened = 0, dismissed = 0;
  const view = createDeliveryUpdateView({ root, banner, onOpen: () => opened++, onDismiss: () => dismissed++ });
  view.render({ identity, target, update: pickup, alert: pickup, error: '', opening: false });
  assert.equal(root.hidden, false); assert.equal(banner.hidden, false);
  assert.ok(all(root).some(node => node.textContent === pickup.body));
  assert.ok(all(banner).some(node => node.attributes['aria-live'] === 'polite'));
  all(banner).find(node => node.textContent === 'View delivery').handlers.click(); assert.equal(opened, 1);
  all(banner).find(node => node.textContent === 'Dismiss update').handlers.click(); assert.equal(dismissed, 1);
  view.render({ identity: null, target: null, update: null, alert: null, error: '', opening: false });
  assert.equal(root.hidden, true); assert.equal(banner.hidden, true); assert.ok(!all(root).some(node => node.textContent === pickup.body));
});

test('all shipped delivery surfaces load the registered controller, parser, card and stylesheet', async () => {
  const server = await readFile(new URL('../server.mjs', import.meta.url), 'utf8');
  for (const asset of ['/shared/delivery-updates.mjs', '/dashboard/delivery-updates.mjs', '/dashboard/delivery-update-view.mjs', '/delivery-updates.css']) assert.ok(server.includes(asset), asset);
  for (const page of ['dashboard', 'eats', 'parcels']) {
    const html = await readFile(new URL(`../public/${page}.html`, import.meta.url), 'utf8');
    for (const id of ['delivery-update-card', 'delivery-update-banner']) assert.equal((html.match(new RegExp(`id="${id}"`, 'g')) ?? []).length, 1);
    assert.ok(html.includes('/delivery-updates.css'));
  }
});
