import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
async function browserModule(path) {
  const root = new URL('../public/' + path, import.meta.url);
  let source = await readFile(root, 'utf8');
  source = source.replace(/from\s+(['"])(.*?)\1/g, (_, quote, name) => `from '${name.startsWith('/shared/') ? new URL('../../../packages/shared/src/' + name.slice(8), import.meta.url).href : new URL(name, root).href}'`);
  return import('data:text/javascript;base64,' + Buffer.from(source).toString('base64'));
}
const { createParcelsController } = await browserModule('parcels/controller.mjs');
const { createParcelLinksPanel } = await browserModule('dashboard/parcel-links-panel.mjs');

const token = 'a'.repeat(64), account = { user: { id: 'recipient', name: 'Recipient' }, csrfToken: 'recipient-csrf' };
const rideId = '11111111-1111-4111-8111-111111111111', linkId = '22222222-2222-4222-8222-222222222222';
const parcel = { rideId, reference: 'PARCEL-11111111', description: 'Books', status: 'in_progress', dropoffPin: '123456', weightKg: 2, recipientName: 'Recipient', destination: 'Wuse, Abuja', driver: null, location: null, verifiedAt: null, updatedAt: 1000 };
const flush = () => new Promise((resolve) => setImmediate(resolve));
function setup() {
  let session = account, values = [], renders = [], commands = [], scrubbed = 0, resets = 0, readHook = null, time = 1000;
  const client = { reset() { resets++; }, setCsrf() {},
    async request(path) {
      if (path === '/api/session') return session;
      if (path === '/api/locations') return { settings: { enabled: false } };
      if (path === '/api/parcels/received') { if (readHook) await readHook(); return { parcels: values }; }
      throw new Error(path);
    }, async command(path, data) { commands.push({ path, data }); return { parcel }; } };
  const controller = createParcelsController({ client, token, now: () => time, onAccepted() { scrubbed++; }, view: { render(value) { renders.push(structuredClone(value)); } } });
  return { controller, commands, renders, state: () => renders.at(-1), scrubbed: () => scrubbed, resets: () => resets,
    session(value) { session = value; }, parcels(value) { values = value; }, readHook(fn) { readHook = fn; }, time(value) { time = value; } };
}

test('recipient invitation is never claimed by opening or polling; explicit acceptance saves its inbox and scrubs capability', async () => {
  const h = setup(); h.session({ user: null }); await h.controller.refresh();
  assert.equal(h.state().user, null); assert.equal(h.state().hasInvitation, true); assert.equal(h.commands.length, 0);
  await h.controller.accept(); assert.equal(h.commands.length, 0);
  h.session(account); await h.controller.refresh(); assert.equal(h.commands.length, 0);
  await h.controller.accept();
  assert.deepEqual(h.commands, [{ path: '/api/parcels/accept', data: { token } }]);
  assert.equal(h.scrubbed(), 1); assert.equal(h.state().hasInvitation, false); assert.equal(h.state().selectedId, rideId);
  assert.equal(h.state().parcels[0].dropoffPin, '123456');
  h.parcels([parcel]); await h.controller.refresh(); assert.equal(h.state().parcels.length, 1);
});

test('recipient cookie replacement before acceptance cannot claim for the wrong account', async () => {
  const h = setup(); await h.controller.refresh();
  h.session({ user: { id: 'different', name: 'Other account' }, csrfToken: 'new' });
  await h.controller.accept(); assert.equal(h.commands.length, 0); assert.equal(h.state().user.id, 'different');
  assert.equal(h.state().hasInvitation, true); assert.equal(h.state().parcels.length, 0);
});

test('recipient private reads are discarded on mid-read account change; logout and suspension clear PINs immediately', async () => {
  const h = setup(); h.parcels([parcel]); await h.controller.refresh();
  assert.equal(h.state().parcels.length, 1);
  h.readHook(async () => h.session({ user: { id: 'other' }, csrfToken: 'other' }));
  await h.controller.refresh(); assert.equal(h.state().parcels.length, 0);
  h.readHook(null); await h.controller.refresh(); h.controller.pause();
  assert.equal(h.state().user, null); assert.equal(h.state().parcels.length, 0);
  h.session({ user: null }); await h.controller.resume(); assert.equal(h.state().parcels.length, 0);
});

test('late recipient responses cannot restore private tracking after page suspension', async () => {
  const h = setup(); let release;
  h.parcels([parcel]); h.readHook(() => new Promise((resolve) => { release = resolve; }));
  const pending = h.controller.refresh(); await flush(); h.controller.pause(); release(); await pending;
  assert.equal(h.state().parcels.length, 0); assert.equal(h.state().user, null);
});

test('recipient PIN and location expire from the screen after 30 seconds without a successful read', async () => {
  const h = setup(); h.parcels([parcel]); await h.controller.refresh();
  assert.equal(h.state().parcels[0].dropoffPin, '123456');
  let release; h.readHook(() => new Promise((resolve) => { release = resolve; }));
  const pending = h.controller.refresh(); await flush();
  h.time(31_000); h.controller.tick(); assert.equal(h.state().parcels.length, 0);
  assert.match(h.state().error, /Tracking updates paused/);
  release(); await pending; assert.equal(h.state().parcels.length, 0, 'late stale snapshots cannot restore the PIN');
});

test('resuming after a suspended read starts fresh and an old finally cannot unlock the newer request', async () => {
  const h = setup(); const release = [];
  h.readHook(() => new Promise((resolve) => release.push(resolve)));
  const first = h.controller.refresh(); await flush(); h.controller.pause();
  const second = h.controller.resume(); await flush(); assert.equal(release.length, 2);
  release[0](); await first; assert.equal(h.state().loading, true);
  release[1](); await second; assert.equal(h.state().loading, false);
});

const html = await readFile(new URL('../public/dashboard.html', import.meta.url), 'utf8');
function sender(t) {
  const old = globalThis.document, nodes = new Map();
  for (const [, id] of html.matchAll(/\bid="([^"]+)"/g)) nodes.set(id, { value: '', handlers: {}, addEventListener(type, fn) { this.handlers[type] = fn; } });
  globalThis.document = { getElementById(id) { assert.ok(nodes.has(id), id); return nodes.get(id); } }; t.after(() => { globalThis.document = old; });
  const owner = { user: { id: 'sender' }, csrfToken: 'sender-token' }; let session = owner, link = null, failing = false;
  const commands = [], copies = [], panel = createParcelLinksPanel({ origin: 'https://taxi.example', now: () => 1000, copy: async (value) => copies.push(value), share: null,
    client: { async request(path) { return path === '/api/session' ? session : { invitation: { rideId, canCreate: true, link } }; },
      async command(path, data) {
        commands.push({ path, data }); if (failing) throw new Error('Connection interrupted');
        link = { id: linkId, version: 1, active: !path.endsWith('/revoke'), claimed: false, expiresAt: 100_000 };
        return { invitation: { rideId, canCreate: true, link }, token: path.endsWith('/revoke') ? undefined : token };
      } } });
  panel.session(owner); panel.context({ id: 'sender', role: 'customer' }, { id: rideId, customer: { id: 'sender' }, delivery: {} });
  return { panel, commands, copies, node: (id) => nodes.get('parcel-link-' + id), session(value) { session = value; }, failing(value) { failing = value; }, claim() { link = { ...link, claimed: true }; } };
}

test('sender invitation is fragment-only and never sent automatically; replacement/revocation require confirmation', async (t) => {
  const h = sender(t); await flush(); h.node('create').handlers.click(); await flush();
  assert.equal(h.node('url').value, `https://taxi.example/parcels#token=${token}`); assert.equal(h.copies.length, 0);
  h.node('copy').handlers.click(); await flush(); assert.equal(h.copies.length, 1);
  h.node('revoke').handlers.click(); assert.equal(h.commands.length, 1); assert.equal(h.node('confirm').hidden, false);
  h.node('confirm-action').handlers.click(); await flush();
  assert.deepEqual(h.commands[1], { path: `/api/parcels/${rideId}/revoke`, data: { linkId, expectedVersion: 1 } });
  assert.equal(h.node('url').value, '');
});

test('sender checks cross-tab identity before writes and clears its private link on pause/reset', async (t) => {
  const h = sender(t); await flush(); h.node('create').handlers.click(); await flush();
  h.panel.pause(); assert.equal(h.node('url').value, ''); assert.equal(h.node('panel').hidden, true);
  h.panel.resume(); await flush(); h.session({ user: { id: 'other' }, csrfToken: 'new' });
  h.node('replace').handlers.click(); h.node('confirm-action').handlers.click(); await flush();
  assert.equal(h.commands.length, 1); assert.equal(h.node('panel').hidden, true);
  assert.equal(h.node('url').value, '');
});

test('an uncertain sender write retains the exact action until an explicit retry', async (t) => {
  const h = sender(t); await flush(); h.failing(true); h.node('create').handlers.click(); await flush();
  assert.equal(h.node('retry').hidden, false); assert.equal(h.node('replace').disabled, true);
  h.failing(false); h.node('retry').handlers.click(); await flush();
  assert.deepEqual(h.commands[0], h.commands[1]); assert.equal(h.node('retry').hidden, true);
});

test('claiming removes the invitation capability and terminal deliveries do not prompt booking confirmation', async (t) => {
  const h = sender(t); await flush(); h.node('create').handlers.click(); await flush();
  h.claim(); h.node('refresh').handlers.click(); await flush();
  assert.equal(h.node('url').value, ''); assert.equal(h.node('secret').hidden, true);
  assert.match(h.node('message').textContent, /accepted/);
  h.panel.context({ id: 'sender', role: 'customer' }, { id: rideId, status: 'completed', customer: { id: 'sender' }, delivery: {} });
  assert.match(h.node('message').textContent, /Delivery ended/);
});
