import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createSafetyController } from '../public/dashboard/safety-controller.mjs';
import { createTripShareController } from '../public/dashboard/trip-share-controller.mjs';

const deferred = () => { let resolve; const promise = new Promise((done) => { resolve = done; }); return { resolve, promise }; };
const customer = { id: 'customer', role: 'customer' }, admin = { id: 'admin', role: 'admin' }, ride = { id: 'ride', status: 'booked' };
const contact = { id: 'friend', name: '<Friend>', phone: '+2348000000000', version: 0 };
const settings = { canSimulate: true, mode: 'simulation' }, secret = 'a'.repeat(64);
const share = { id: 'link', rideId: 'ride', version: 0, active: true, expiresAt: 10000000 };
const incident = { id: 'incident', rideId: 'ride', kind: 'need_help', status: 'open', version: 0, createdAt: 1000000, note: '<Private note>',
  reporter: { id: 'customer', name: 'Customer' }, snapshot: { pickup: 'Wuse II', destination: 'Maitama',
    reporter: { id: 'customer', name: 'Customer', role: 'customer' }, driver: { id: 'driver', name: '<Driver>', vehicle: { model: 'Toyota', plate: 'TEST-PLATE' } },
    location: { lat: 9.08, lng: 7.4, accuracy: 12, capturedAt: 1000000, stale: true } },
  events: [{ action: 'created', actorId: 'customer', createdAt: 1000000, note: '' }],
  notifications: [{ id: 'notice', status: 'queued', recipientName: '<Friend>', recipientPhone: '••••0000', version: 0, attempts: 0,
    events: [{ status: 'queued', attempt: 0, createdAt: 1000000 }] }] };
function controller() {
  const f = { views: [], commands: [], copies: [], saved: [], trips: { rideId: 'ride', canRaise: true, incidents: [], share: null } };
  let who = customer;
  const result = (data) => ({ viewerId: who.id, settings, ...data });
  f.client = { request: async (path) => path.includes('/admin/safety') ? result({ incidents: [incident], nextBefore: null })
    : path.includes('/incidents/') ? result({ incident }) : path.endsWith('/contacts') ? result({ contacts: [contact] }) : result(f.trips),
    command: async (path, data) => { f.commands.push({ path, data }); return result({}); } };
  f.c = createSafetyController({ client: f.client, origin: 'https://preview.test', copy: async (value) => f.copies.push(value),
    view: { render: (value) => f.views.push(structuredClone(value)), reset() {}, clearReview() {}, focusReview() {}, saved: (action) => f.saved.push(action) } });
  f.context = (account = customer, trip = ride) => { who = account; f.c.context(account, trip); };
  f.last = () => f.views.at(-1); f.result = result; return f;
}

test('private safety reads and late SOS replies are discarded after account or trip changes', async () => {
  const f = controller(), pending = deferred(); f.context(); f.client.request = () => pending.promise;
  const load = f.c.poll(); f.context({ id: 'other', role: 'customer' }); pending.resolve({ viewerId: 'customer', contacts: [contact] }); await load;
  assert.equal(f.last().contacts, null); assert.equal(f.last().trip, null);
  const reply = deferred(); f.client.command = () => reply.promise; const action = f.c.raise({ kind: 'need_help', note: '', contactIds: [] });
  f.context(customer, { id: 'another-trip' }); reply.resolve({ viewerId: 'other', incident }); await action;
  assert.equal(f.last().trip, null); assert.deepEqual(f.saved, []); assert.equal(f.last().pending, false);
});

test('cookie-switched private responses clear all safety content instead of showing another account’s contacts', async () => {
  const f = controller(); f.context(); await f.c.poll(); assert.equal(f.last().contacts[0].id, contact.id);
  f.client.request = async () => ({ viewerId: 'different-account', contacts: [contact] }); await f.c.poll();
  assert.equal(f.last().contacts, null); assert.equal(f.last().trip, null); assert.match(f.last().error, /account changed/);
});

test('share secrets are copied only from the current trip, survive polls but not resets, and lost replies require explicit replacement', async () => {
  const f = controller(); f.context(); await f.c.poll();
  f.client.command = async (path, data) => { f.commands.push({ path, data }); f.trips.share = share; return f.result({ share, token: secret }); };
  await f.c.share(15); assert.equal(f.last().shareUrl, `https://preview.test/trip-share#${secret}`);
  await f.c.poll(); await f.c.copy(); assert.equal(f.copies.length, 1);
  assert.deepEqual(f.commands[0].data, { minutes: 15, expectedShareId: null });
  f.c.reset(); f.context(); await f.c.poll(); assert.equal(f.last().shareUrl, '');
  await f.c.copy(); assert.equal(f.copies.length, 1);
  f.client.command = async (path, data) => { f.commands.push({ path, data }); return f.result({ share, token: null, replayed: true }); };
  await f.c.share(30); assert.equal(f.last().shareUrl, ''); assert.match(f.last().message, /Replace the link/);
  assert.equal(f.commands.length, 2); assert.deepEqual(f.commands[1].data, { minutes: 30, expectedShareId: share.id });
  f.context(customer, { id: 'other-trip' }); assert.equal(f.last().shareUrl, '');
});

test('duplicate clicks and stale admin actions send only one command with the displayed version; old polls cannot overwrite success', async () => {
  const f = controller(); f.context(admin, null); await f.c.open(incident.id);
  const old = deferred(); f.client.request = () => old.promise; const polling = f.c.poll();
  const changed = { ...incident, version: 1, status: 'acknowledged' }, reply = deferred();
  f.client.command = (path, data) => { f.commands.push({ path, data }); return reply.promise; };
  const first = f.c.review(incident, 'acknowledge', 'Reviewed in test queue.'); await f.c.review(incident, 'acknowledge', 'Reviewed in test queue.');
  assert.equal(f.commands.length, 1); assert.equal(f.commands[0].data.expectedVersion, 0);
  f.client.request = async (path) => f.result(path.includes('/admin/safety') ? { incidents: [changed] } : { incident: changed });
  reply.resolve(f.result({ incident: changed })); await first; old.resolve(f.result({ incidents: [incident], incident })); await polling;
  assert.equal(f.last().incident.version, 1);
  f.client.command = async () => { throw Object.assign(new Error('Review current version'), { status: 409 }); };
  await f.c.review(incident, 'acknowledge', 'An old note'); assert.match(f.last().error, /current version/); assert.equal(f.commands.length, 1);
  f.client.request = async () => { throw Object.assign(new Error('Sign in'), { status: 401 }); };
  await f.c.poll(); assert.equal(f.last().incident, null); assert.equal(f.last().queue, null);
});

test('admin selection and queue filters reject replies from superseded screens; saved actions distinguish refresh failures', async () => {
  const f = controller(); f.context(admin, null);
  const old = deferred(); f.client.request = () => old.promise; const opening = f.c.open(incident.id);
  f.client.request = async () => f.result({ incidents: [], nextBefore: null }); await f.c.page(null, 'resolved');
  old.resolve(f.result({ incident, incidents: [incident] })); await opening;
  assert.equal(f.last().incident, null); assert.equal(f.last().filter, 'resolved');
  f.context(); f.client.command = async () => f.result({ contact }); f.client.request = async () => { throw new Error('offline'); };
  await f.c.add({ name: 'Friend', phone: '+2348000000000' }); assert.match(f.last().error, /action was saved/);
});

test('shared-trip viewer clears private data on errors, expiry, suspension and page exit, and ignores late replies', async () => {
  let now = 1000, data = { expiresAt: 50000, trip: { location: { capturedAt: 1000, stale: false } } };
  const views = [], requests = [], client = { request: async (path, options) => { requests.push({ path, options }); return data; } };
  const c = createTripShareController({ client, token: secret, now: () => now, view: { render: (value) => views.push(value) } });
  await c.poll(); assert.equal(views.at(-1).data, data); assert.equal(requests[0].options.method, 'POST');
  assert.deepEqual(requests[0].options.data, { token: secret }); assert.equal(requests[0].path.includes(secret), false);
  now = 31000; c.tick(); assert.equal(views.at(-1).data.trip.location.stale, true);
  const reply = deferred(); client.request = () => reply.promise; const poll = c.poll(); c.suspend(); reply.resolve(data); await poll;
  assert.equal(views.at(-1).data, null);
  client.request = async () => { throw new Error('offline'); }; await c.poll(); assert.equal(views.at(-1).data, null);
  client.request = async () => data; await c.poll(); now = 50000; c.tick(); assert.equal(views.at(-1).data, null);
  const count = requests.length; await c.poll(); assert.equal(requests.length, count);
  c.close(); assert.equal(views.at(-1).data, null);
});

const source = (await readFile(new URL('../public/dashboard/safety-view.mjs', import.meta.url), 'utf8'))
  .replace("'./dom.mjs'", `'${new URL('../public/dashboard/dom.mjs', import.meta.url)}'`)
  .replace("'./safety-format.mjs'", `'${new URL('../public/dashboard/safety-format.mjs', import.meta.url)}'`)
  .replace("'/shared/safety.mjs'", `'${new URL('../../../packages/shared/src/safety.mjs', import.meta.url)}'`)
  .replace("'/shared/pickup-identity.mjs'", `'${new URL('../../../packages/shared/src/pickup-identity.mjs', import.meta.url)}'`);
const { createSafetyView } = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
const html = await readFile(new URL('../public/dashboard.html', import.meta.url), 'utf8');
function dom(t) {
  const original = globalThis.document, nodes = new Map(), actions = [];
  class Element {
    constructor(tag) { this.tag = tag; this.children = []; this.handlers = {}; this.value = ''; this.checked = false; this.textContent = ''; }
    append(...children) { this.children.push(...children); }
    replaceChildren(...children) { this.children = children; }
    addEventListener(name, fn) { this.handlers[name] = fn; }
    scrollIntoView() {}
    focus() { this.focused = true; }
  }
  for (const [, tag, id] of html.matchAll(/<(\w+)\b[^>]*?\bid="([^"]+)"/g)) nodes.set(id, new Element(tag));
  const node = (id) => { assert.ok(nodes.has(id), id); return nodes.get(id); };
  globalThis.document = { getElementById: node, createElement: (tag) => new Element(tag) }; t.after(() => { globalThis.document = original; });
  const callbacks = Object.fromEntries(['Add', 'Remove', 'Raise', 'Share', 'Revoke', 'Copy', 'Open', 'Page', 'Review', 'Simulate'].map((name) => ['on' + name, (...args) => actions.push([name, ...args])]));
  const view = createSafetyView(callbacks); view.reset();
  const state = { user: customer, ride, contacts: [contact], trip: { canRaise: true, incidents: [], share: null }, settings, pending: false, filter: 'open' };
  return { node, view, actions, state, event: { preventDefault() {} }, render: (extra = {}) => view.render({ ...state, ...extra }) };
}
const strings = (node) => [node.textContent, ...node.children.flatMap(strings)].join(' ');

test('safety UI preserves notes and selected contacts during polls, uses text for private input and clears drafts at account boundaries', (t) => {
  const f = dom(t); f.render(); assert.equal(f.node('safety-fields').disabled, false);
  const input = f.node('safety-recipients').children[0].children[0]; input.checked = true; input.handlers.change();
  f.node('safety-note').value = '<My note>'; f.render(); assert.equal(f.node('safety-note').value, '<My note>');
  f.node('safety-form').handlers.submit(f.event); assert.deepEqual(f.actions.at(-1), ['Raise', { kind: 'need_help', note: '<My note>', contactIds: ['friend'] }]);
  f.render({ trip: { canRaise: true, incidents: [incident], share } });
  assert.equal(f.node('safety-fields').disabled, true); assert.equal(f.node('safety-share-recover').hidden, false);
  assert.match(strings(f.node('safety-incidents')), /<Private note>/); assert.match(strings(f.node('safety-incidents')), /TEST-PLATE/);
  assert.match(strings(f.node('safety-incidents')), /stale update/); assert.match(strings(f.node('safety-incidents')), /Test alert queued/);
  f.view.reset(); f.render({ user: null, ride: null, contacts: null, trip: null });
  assert.equal(f.node('safety-note').value, ''); assert.equal(f.node('safety-panel').hidden, true); assert.equal(f.node('safety-incidents').children.length, 0);
});

test('vehicle-mismatch shortcuts select the current trip and require an explicit bounded report submission', (t) => {
  const f = dom(t); f.render(); f.view.vehicleMismatch('different-trip'); assert.equal(f.node('safety-kind').value, 'need_help');
  f.view.vehicleMismatch(ride.id); assert.equal(f.node('safety-kind').value, 'vehicle_mismatch'); assert.equal(f.actions.length, 0);
  assert.equal(f.node('safety-note').focused, true); assert.equal(f.node('safety-note').maxLength, 480);
  f.node('safety-note').value = 'Red van, TEST-999'; f.node('safety-form').handlers.submit(f.event);
  assert.deepEqual(f.actions[0], ['Raise', { kind: 'unsafe_behaviour', note: 'Vehicle mismatch: Red van, TEST-999', contactIds: [] }]);
  f.node('safety-note').value = 'x'.repeat(481); f.node('safety-form').handlers.submit(f.event);
  assert.equal(f.actions.length, 1); assert.match(f.node('safety-error').textContent, /480/);
  f.view.reset(); assert.equal(f.node('safety-kind').value, 'need_help'); assert.equal(f.node('safety-note').value, '');
});

test('administrator notes stay with the shown incident version, simulation controls respect state, and inactive trip controls are disabled', (t) => {
  const f = dom(t), extra = { user: admin, ride: null, incident, queue: { incidents: [incident], nextBefore: 'older' } };
  f.render(extra); f.node('safety-review-note').value = 'Reviewed this test case.'; f.render(extra);
  f.node('safety-review-form').onsubmit(f.event); assert.equal(f.actions.at(-1)[0], 'Review'); assert.equal(f.actions.at(-1)[1].version, 0);
  const row = f.node('safety-admin-detail').children[0].children.at(-1); row.children.at(-1).children[0].handlers.click();
  assert.deepEqual(f.actions.at(-1), ['Simulate', incident.notifications[0], 'sent']);
  f.render({ ...extra, incident: { ...incident, version: 1, status: 'acknowledged' } }); assert.equal(f.node('safety-review-note').value, '');
  assert.equal(f.node('safety-review-submit').textContent, 'Close test incident');
  f.render({ ...extra, pending: true }); assert.equal(f.node('safety-review-fields').disabled, true);
  f.render({ trip: { canRaise: false, incidents: [], share: null } }); assert.equal(f.node('safety-fields').disabled, true); assert.equal(f.node('safety-share-create').disabled, true);
  f.render({ contacts: [contact, { ...contact, id: 'second' }, { ...contact, id: 'third' }] }); assert.equal(f.node('contact-fields').disabled, true);
});
