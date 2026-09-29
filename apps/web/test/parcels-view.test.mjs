import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

async function moduleUrl(path, dependencies = {}) {
  const root = new URL('../public/' + path, import.meta.url);
  let source = await readFile(root, 'utf8');
  source = source.replace(/from\s+(['"])(.*?)\1/g, (_, quote, name) => `from '${dependencies[name] ?? (name.startsWith('/shared/') ? new URL('../../../packages/shared/src/' + name.slice(8), import.meta.url).href : new URL(name, root).href)}'`);
  return 'data:text/javascript;base64,' + Buffer.from(source).toString('base64');
}
const map = await moduleUrl('dashboard/map-view.mjs');
const { createParcelsView } = await import(await moduleUrl('parcels/view.mjs', { '../dashboard/map-view.mjs': map }));
const html = await readFile(new URL('../public/parcels.html', import.meta.url), 'utf8');
class NodeFixture {
  constructor(tag = 'div') { this.tag = tag; this.children = []; this.attributes = {}; this.handlers = {}; this.textContent = ''; }
  addEventListener(type, fn) { this.handlers[type] = fn; }
  append(...nodes) { this.children.push(...nodes); }
  replaceChildren(...nodes) { this.children = nodes; }
  setAttribute(key, value) { this.attributes[key] = value; }
}
const descendants = (node) => [node, ...node.children.flatMap(descendants)];
function setup(t) {
  const old = globalThis.document, nodes = new Map();
  for (const [, id] of html.matchAll(/\bid="([^"]+)"/g)) nodes.set(id, new NodeFixture());
  const node = (id) => { assert.ok(nodes.has(id), `Missing shipped #${id}`); return nodes.get(id); };
  globalThis.document = { getElementById: node, createElement: (tag) => new NodeFixture(tag), createElementNS: (_, tag) => new NodeFixture(tag) };
  t.after(() => { globalThis.document = old; });
  let time = 100_000;
  const view = createParcelsView({ now: () => time, onSelect() {}, onAccept() {}, onRefresh() {} });
  return { view, node, time(value) { time = value; } };
}
const parcel = { rideId: 'ride', status: 'in_progress', description: 'Books', weightKg: 2, recipientName: 'Recipient', destination: 'Maitama', reference: 'PARCEL-123', driver: null, location: { lat: 9.08, lng: 7.4, accuracy: 12, capturedAt: 99_000 }, dropoffPin: '123456' };
const state = { user: { name: 'Recipient' }, parcels: [parcel], selectedId: 'ride', settings: { enabled: true, tiles: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png' }, hasInvitation: false };

test('recipient shows real driver GPS only after collection, labels stale updates and requires map opt-in', (t) => {
  const h = setup(t); h.view.render(state);
  assert.match(h.node('parcel-location').textContent, /Driver-shared location: 9.08000/);
  assert.equal(h.node('parcel-pin').textContent, '123456');
  assert.equal(descendants(h.node('parcel-map')).filter((node) => node.tag === 'image').length, 0);
  h.node('parcel-map-enable').handlers.click();
  assert.ok(descendants(h.node('parcel-map')).some((node) => node.tag === 'image'));
  h.time(160_000); h.view.tick(); assert.match(h.node('parcel-location').textContent, /update is stale/);
  h.view.render({ ...state, parcels: [{ ...parcel, status: 'booked' }] });
  assert.equal(h.node('parcel-pin').textContent, ''); assert.equal(h.node('parcel-pin-panel').hidden, true);
  assert.match(h.node('parcel-location').textContent, /after parcel collection/);
  assert.equal(descendants(h.node('parcel-map')).filter((node) => node.tag === 'image').length, 0);
});

test('recipient completion and account clearing erase locations and the private handover code', (t) => {
  const h = setup(t); h.view.render(state); h.node('parcel-map-enable').handlers.click();
  h.view.render({ ...state, parcels: [{ ...parcel, status: 'completed', location: null, dropoffPin: null, verifiedAt: 100_000 }] });
  assert.equal(h.node('parcel-pin').textContent, ''); assert.match(h.node('parcel-location').textContent, /Location sharing has ended/);
  h.view.render({ ...state, user: null, parcels: [] });
  assert.equal(h.node('parcel-identity').textContent, ''); assert.equal(h.node('parcel-detail').hidden, true);
  assert.equal(h.node('parcel-details').children.length, 0); assert.equal(h.node('parcel-location').textContent, '');
});
