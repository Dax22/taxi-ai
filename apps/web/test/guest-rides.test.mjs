import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createGuestRidesTransport } from '../public/dashboard/guest-rides-transport.mjs';

const root = new URL('../public/dashboard/', import.meta.url);
const source = (await readFile(new URL('guest-rides-panel.mjs', root), 'utf8'))
  .replace(/from\s+(['"])(.*?)\1/g, (_, quote, specifier) => `from '${specifier.startsWith('/shared/')
    ? new URL('../../../packages/shared/src/' + specifier.slice(8), import.meta.url).href : new URL(specifier, root).href}'`);
const { createGuestRidesPanel } = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
const html = await readFile(new URL('../public/dashboard.html', import.meta.url), 'utf8');
const rideId = '11111111-1111-4111-8111-111111111111', linkId = '22222222-2222-4222-8222-222222222222';
const session = { user: { id: 'owner' }, csrfToken: 'csrf-owner' };

test('cross-tab cookie replacement blocks link writes and clears the owner context', async () => {
  const sent = []; let changed = 0;
  const transport = createGuestRidesTransport({ identity: () => 'owner:csrf-owner', onChanged() { changed++; },
    client: { async request(path, options) { sent.push({ path, options }); return { user: { id: 'replacement' }, csrfToken: 'csrf-new' }; } } });
  await assert.rejects(transport.command('/guest-rides/' + rideId + '/link', { expectedLinkId: null }, 'exact-key'), { code: 'SESSION_CHANGED' });
  assert.deepEqual(sent.map((entry) => entry.path), ['/api/session']); assert.equal(changed, 1);
});

test('guest transport retains explicit retry key and checks account again after a successful mutation', async () => {
  const sent = []; let identity = 'owner:csrf-owner', changed = 0;
  const transport = createGuestRidesTransport({ identity: () => identity, onChanged() { changed++; },
    client: { async request(path, options) { sent.push({ path, options }); if (path === '/api/session') return session;
      identity = 'new-account:csrf-new'; return { token: 'must-not-display' }; } } });
  await assert.rejects(transport.command('/guest-rides/' + rideId + '/link', { expectedLinkId: null }, 'exact-key'), { code: 'SESSION_CHANGED' });
  assert.equal(sent[1].options.key, 'exact-key'); assert.equal(changed, 1);
  assert.deepEqual(sent.map((entry) => entry.path), ['/api/session', '/api/guest-rides/' + rideId + '/link', '/api/session']);
});

class ElementFixture {
  constructor() { this.hidden = false; this.disabled = false; this.textContent = ''; this.value = ''; this.handlers = {}; }
  setAttribute(name, value) { this[name] = value; }
  addEventListener(type, handler) { this.handlers[type] = handler; }
}
function setup(t) {
  const previous = globalThis.document, nodes = new Map();
  for (const [, id] of html.matchAll(/\bid="([^"]+)"/g)) nodes.set(id, new ElementFixture());
  const node = (id) => { assert.ok(nodes.has(id), `Missing shipped #${id}`); return nodes.get(id); };
  globalThis.document = { getElementById: node }; t.after(() => { globalThis.document = previous; });
  let saved = null, time = 1000, currentSession = session, changed = 0;
  const commands = [], copied = [];
  const metadata = () => ({ guest: { rideId, canCreate: true, link: saved } });
  const panel = createGuestRidesPanel({ origin: 'https://taxi.example', now: () => time,
    copy: async (text) => { copied.push(text); }, share: null, onSessionChanged() { changed++; },
    client: { async request(path, options) {
      if (path === '/api/session') return currentSession;
      if (options?.method === 'POST') {
        commands.push({ path, options });
        if (path.endsWith('/link')) { saved = { id: linkId, version: 1, active: true, expiresAt: 100_000 }; return { ...metadata(), token: 'a'.repeat(64) }; }
        saved = { ...saved, version: 2, active: false }; return metadata();
      }
      return metadata();
    } },
  });
  panel.session(session);
  const ride = { id: rideId, status: 'booked', customer: { id: 'owner' }, passenger: { kind: 'guest', name: 'Friend' } };
  panel.context({ id: 'owner', role: 'customer' }, ride);
  return { panel, node, ride, commands, copied, changed: () => changed,
    time(value) { time = value; }, session(value) { currentSession = value; } };
}
const flush = () => new Promise((resolve) => setImmediate(resolve));

test('shipped guest link panel creates and copies a fragment-only link, then clears it on background and account change', async (t) => {
  const h = setup(t); await flush();
  assert.equal(h.node('guest-link-panel').hidden, false); assert.equal(h.node('guest-link-create').hidden, false);
  await h.node('guest-link-create').handlers.click();
  assert.deepEqual(h.commands[0].options.data, { expectedLinkId: null });
  assert.ok(h.commands[0].options.key);
  assert.equal(h.node('guest-link-url').value, 'https://taxi.example/guest-trip#' + 'a'.repeat(64));
  h.node('guest-link-copy').handlers.click(); await flush(); assert.equal(h.copied.length, 1);
  h.panel.pause(); assert.equal(h.node('guest-link-url').value, ''); assert.equal(h.node('guest-link-panel').hidden, true);
  h.panel.resume(); await flush(); assert.equal(h.node('guest-link-url').value, '');
  assert.equal(h.node('guest-link-replace').hidden, false);
  h.node('guest-link-replace').handlers.click(); assert.equal(h.node('guest-link-confirm').hidden, false);
  h.session({ user: { id: 'replacement' }, csrfToken: 'new-session' });
  await h.node('guest-link-confirm-replace').handlers.click();
  assert.equal(h.commands.length, 1, 'replacement session must not submit the old owner’s command');
  assert.equal(h.changed(), 1); assert.equal(h.node('guest-link-panel').hidden, true);
});

test('shipped guest panel expiry and trip closure remove private link text and controls', async (t) => {
  const h = setup(t); await flush(); await h.node('guest-link-create').handlers.click();
  h.time(100_000); h.panel.tick(); assert.equal(h.node('guest-link-url').value, ''); assert.equal(h.node('guest-link-secret').hidden, true);
  h.panel.context({ id: 'owner', role: 'customer' }, { ...h.ride, status: 'completed' });
  assert.equal(h.node('guest-link-panel').hidden, true); assert.equal(h.node('guest-link-url').value, '');
});
