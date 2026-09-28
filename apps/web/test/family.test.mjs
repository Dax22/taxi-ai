import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = (await readFile(new URL('../public/family/controller.mjs', import.meta.url), 'utf8'))
  .replace("'/shared/family.mjs'", `'${new URL('../../../packages/shared/src/family.mjs', import.meta.url)}'`);
const { createFamilyController } = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
const shareId = '11111111-1111-4111-8111-111111111111', rideId = '22222222-2222-4222-8222-222222222222';
const summary = { shareId, version: 1, rideId, status: 'booked', relationship: 'watching', name: 'Passenger', sharingActive: true, safeArrivalAt: null, checkIn: null, endedAt: null, canRequestCheckIn: true, canRespond: false, canRequestHelp: false, canConfirmArrival: false };
const snapshot = () => ({ family: { adultConfirmed: true, contacts: [], availableTrips: [], trips: [summary], inbox: [], limits: { contacts: 5, checkInCooldownMs: 300000 } }, serverNow: 1000 });
const details = () => ({ trip: { ...summary, passengerName: 'Passenger', pickup: 'Wuse', destination: 'Maitama', driver: { name: 'Driver', vehicle: { model: 'Toyota Corolla', plate: 'TEST-001', colour: 'yellow', category: 'standard' } }, location: { lat: 9.08, lng: 7.4, accuracy: 15, capturedAt: 1000, source: 'driver_shared', stale: false } }, serverNow: 1000 });
function setup() {
  let current, time = 1000, account = { user: { id: 'account-one', role: 'customer', name: 'Observer' }, csrfToken: 'csrf-one' };
  let read = async path => path === '/api/session' ? account : path === '/api/family' ? snapshot() : details();
  const commands = [], scopes = [], requests = [];
  const controller = createFamilyController({ client: {
    request: async (path, options) => { requests.push({ path, options }); return read(path, options); },
    command: async (path, data) => { commands.push({ path, data }); return snapshot(); },
    setCsrf() {}, reset() {},
  }, view: { render(state) { current = state; } }, now: () => time, onIdentity: value => scopes.push(value) });
  return { controller, requests, commands, scopes, state: () => current, account: () => account, changeAccount() { account = { ...account, csrfToken: 'csrf-two' }; }, read(fn) { read = fn; }, time(value) { time = value; } };
}

test('family reads recheck the same account and do not use booker ride/chat endpoints', async () => {
  const h = setup(); await h.controller.refresh(); assert.ok(h.state().family);
  await h.controller.select(shareId); assert.ok(h.state().trip);
  assert.ok(h.requests.every(({ path }) => path === '/api/session' || path.startsWith('/api/family')));
  assert.equal(h.state().trip.location.source, 'driver_shared');
});

test('family detail failure clears the map payload and previously loaded private information', async () => {
  const h = setup(); await h.controller.refresh(); await h.controller.select(shareId); assert.ok(h.state().trip);
  h.read(async path => { if (path === '/api/session') return h.account(); if (path === '/api/family') return snapshot(); throw Object.assign(new Error('Sharing ended'), { status: 404 }); });
  await h.controller.refresh(); assert.equal(h.state().trip, null); assert.equal(h.state().family, null);
  assert.match(h.state().error, /Sharing ended/);
});

test('other-tab account changes before a mutation prevent the family command', async () => {
  const h = setup(); await h.controller.refresh(); h.changeAccount();
  await h.controller.command('request-check-in', { shareId, expectedVersion: 1 });
  assert.equal(h.commands.length, 0); assert.equal(h.state().family, null); assert.equal(h.state().signedIn, false);
});

test('backgrounding invalidates late private reads and foreground revalidates access', async () => {
  const h = setup(); await h.controller.refresh();
  let finish; h.read(async path => path === '/api/session' ? h.account() : new Promise(resolve => { finish = resolve; }));
  const pending = h.controller.refresh(); await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
  h.controller.suspend(); assert.equal(h.state().family, null);
  finish(snapshot()); await pending; assert.equal(h.state().family, null);
  h.read(async path => path === '/api/session' ? h.account() : snapshot()); await h.controller.resume(); assert.ok(h.state().family);
});

test('a location becomes stale without a network response and an invalidation clears it', async () => {
  const h = setup(); await h.controller.refresh(); await h.controller.select(shareId); h.time(31000); h.controller.tick();
  assert.equal(h.state().trip.location.stale, true); h.controller.invalidate(new Error('Offline')); assert.equal(h.state().trip, null); assert.equal(h.state().family, null);
});

test('revocation clears the current detail before sending the command', async () => {
  const h = setup(); await h.controller.refresh(); await h.controller.select(shareId);
  let finish; h.read(async path => path === '/api/session' ? new Promise(resolve => { finish = resolve; }) : snapshot());
  const pending = h.controller.command('stop-sharing', { shareId, expectedVersion: 1 });
  assert.equal(h.state().trip, null); h.controller.suspend(); finish(h.account()); await pending;
  assert.equal(h.commands.length, 0); assert.equal(h.state().family, null);
});

const mapStub = `data:text/javascript;base64,${Buffer.from('export function createMapView(root) { return { render(value) { root.mapState = value; }, reset() { root.mapState = null; } }; }').toString('base64')}`;
const viewSource = (await readFile(new URL('../public/family/view.mjs', import.meta.url), 'utf8'))
  .replace("'../dashboard/dom.mjs'", `'${new URL('../public/dashboard/dom.mjs', import.meta.url)}'`)
  .replace("'../dashboard/map-view.mjs'", `'${mapStub}'`)
  .replace("'/shared/trip-lifecycle.mjs'", `'${new URL('../../../packages/shared/src/trip-lifecycle.mjs', import.meta.url)}'`);
const { familyLocationStatus, familyDeliveryStatus, createFamilyView } = await import(`data:text/javascript;base64,${Buffer.from(viewSource).toString('base64')}`);
const html = await readFile(new URL('../public/family.html', import.meta.url), 'utf8');
class ElementFixture {
  constructor(tag = 'div') { this.tag = tag; this.children = []; this.textContent = ''; this.value = ''; this.handlers = {}; this.elements = []; }
  append(...nodes) { this.children.push(...nodes); }
  replaceChildren(...nodes) { this.children = nodes; }
  addEventListener(name, action) { this.handlers[name] = action; }
  querySelector(selector) { return this.children.find(node => selector === '.' + node.className) ?? null; }
}
function viewSetup(t) {
  const before = globalThis.document, nodes = new Map();
  for (const [, tag, id] of html.matchAll(/<(\w+)\b[^>]*?\bid="([^"]+)"/g)) nodes.set(id, new ElementFixture(tag));
  globalThis.document = { getElementById: id => { assert.ok(nodes.has(id), `Missing #${id}`); return nodes.get(id); }, createElement: tag => new ElementFixture(tag) };
  t.after(() => { globalThis.document = before; });
  const selections = [];
  return { nodes, selections, view: createFamilyView({ onCommand() {}, onSelect(id) { selections.push(id); }, onClose() {}, onMaps() {} }) };
}

test('vehicle freshness and notification acceptance never imply passenger tracking or contact acknowledgement', () => {
  assert.match(familyLocationStatus(details().trip, 5000), /vehicle’s position, not the passenger’s phone/);
  assert.match(familyLocationStatus(details().trip, 31000), /stale.*cleared/);
  assert.equal(familyDeliveryStatus({ status: 'provider_accepted' }), 'Accepted by notification service');
  assert.equal(familyDeliveryStatus({ status: 'failed' }), 'Notification failed');
});

test('the web map is cleared as soon as GPS goes stale and when private state is removed', t => {
  const h = viewSetup(t), state = { family: snapshot().family, trip: details().trip, user: { name: 'Observer' }, now: 1000, settings: { enabled: true, tiles: '/tiles/{z}/{x}/{y}', tileHost: 'tiles.example.test' }, busy: false, signedIn: true, message: '', error: '' };
  h.view.render(state); h.nodes.get('family-maps-toggle').handlers.click();
  assert.equal(h.nodes.get('family-map').mapState.enabled, true);
  h.view.tick(state.trip, 31000); assert.equal(h.nodes.get('family-map').mapState, null); assert.equal(h.nodes.get('family-map').hidden, true);
  h.view.render({ ...state, family: null, trip: null });
  assert.equal(h.nodes.get('family-private').hidden, true); assert.equal(h.nodes.get('family-detail').hidden, true);
  assert.equal(h.nodes.get('family-trips').children.length, 0); assert.equal(h.nodes.get('family-map').mapState, null);
});

test('ended journeys display passenger arrival separately and never recreate a location map', t => {
  const h = viewSetup(t), ended = { ...summary, status: 'completed', sharingActive: false, endedAt: 5000, canRequestCheckIn: false };
  h.view.render({ family: { ...snapshot().family, trips: [ended] }, trip: ended, now: 6000, settings: null, busy: false, signedIn: true, message: '', error: '' });
  const strings = node => [node.textContent, ...node.children.flatMap(strings)];
  const copy = strings(h.nodes.get('family-detail-copy')).join(' ');
  assert.match(copy, /Driver marked trip completed/); assert.match(copy, /Not confirmed by passenger/);
  assert.equal(h.nodes.get('family-map').mapState, null); assert.equal(h.nodes.get('family-maps-toggle').hidden, true);
});

test('a new check-in remains pending after an earlier okay response', t => {
  const h = viewSetup(t), current = { ...summary, checkIn: { requestedAt: 302000, respondedAt: 1500, response: 'okay' } };
  h.view.render({ family: { ...snapshot().family, trips: [current] }, trip: null, now: 303000, settings: null, busy: false, signedIn: true, message: '', error: '' });
  const row = h.nodes.get('family-trips').children[0], paragraphs = row.children.filter(child => child.tag === 'p').map(child => child.textContent);
  assert.ok(paragraphs.some(text => /awaiting a response/.test(text)));
  assert.ok(paragraphs.some(text => /Previous response: Passenger said “I’m okay”/.test(text)));
  assert.ok(paragraphs.findIndex(text => /awaiting a response/.test(text)) < paragraphs.findIndex(text => /Previous response/.test(text)));
});

test('offline invalidation prevents an already pending response from restoring private trips', async () => {
  const h = setup(); await h.controller.refresh();
  let finish; h.read(async path => path === '/api/session' ? h.account() : new Promise(resolve => { finish = resolve; }));
  const pending = h.controller.refresh(); await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
  h.controller.invalidate(new Error('Offline')); assert.equal(h.state().family, null);
  finish(snapshot()); await pending; assert.equal(h.state().family, null); assert.match(h.state().error, /Offline/);
  h.read(async path => path === '/api/session' ? h.account() : snapshot()); await h.controller.refresh(); assert.ok(h.state().family);
});

test('help remains available immediately after okay while normal responses are cooling down', t => {
  const h = viewSetup(t), current = { ...summary, relationship: 'sharing_with', name: 'Contact', canRequestCheckIn: false, canRespond: false, canRequestHelp: true, checkIn: { requestedAt: null, respondedAt: 1500, response: 'okay' } };
  h.view.render({ family: { ...snapshot().family, trips: [current] }, trip: null, now: 2000, settings: null, busy: false, signedIn: true, message: '', error: '' });
  const buttons = node => [...(node.tag === 'button' ? [node.textContent] : []), ...node.children.flatMap(buttons)];
  const labels = buttons(h.nodes.get('family-trips'));
  assert.ok(labels.includes('I need help')); assert.ok(!labels.includes('I’m okay'));
});

test('inbox links only current shared trips and labels acknowledgement as the current user’s action', t => {
  const h = viewSetup(t), event = { id: '55555555-5555-4555-8555-555555555555', shareId, kind: 'help', title: 'A passenger requested help', createdAt: 1000, state: 'acknowledged', acknowledgedAt: 1500 };
  const base = { family: { ...snapshot().family, inbox: [event, { ...event, id: '66666666-6666-4666-8666-666666666666', shareId: '77777777-7777-4777-8777-777777777777' }] }, trip: null, now: 2000, settings: null, busy: false, signedIn: true, message: '', error: '' };
  h.view.render(base);
  const links = node => [...(node.tag === 'button' && node.textContent === 'Review shared trip' ? [node] : []), ...node.children.flatMap(links)];
  const review = links(h.nodes.get('family-inbox')); assert.equal(review.length, 1); review[0].handlers.click(); assert.deepEqual(h.selections, [shareId]);
  assert.ok(h.nodes.get('family-inbox').children[0].children.some(node => /Acknowledged by you in app/.test(node.textContent)));
});
