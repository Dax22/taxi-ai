import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { routeFor } from '../public/navigation.mjs';
import { createAdminController } from '../public/controller.mjs';

const base = new URL('../public/', import.meta.url), urls = new Map();
async function moduleUrl(name) {
  if (urls.has(name)) return urls.get(name);
  let source = await readFile(new URL(name, base), 'utf8');
  for (const [, specifier] of source.matchAll(/from\s+'([^']+)'/g)) {
    const url = specifier.startsWith('/shared/') ? new URL('../../../packages/shared/src/' + specifier.slice(8), import.meta.url).href : await moduleUrl(specifier.slice(2));
    source = source.replace(`'${specifier}'`, `'${url}'`);
  }
  const url = 'data:text/javascript;base64,' + Buffer.from(source).toString('base64'); urls.set(name, url); return url;
}
const { coverage } = await import(await moduleUrl('coverage-page.mjs'));
const { coverageQuery, shiftBounds, mapProjection, cellTone, waitLabel } = await import(await moduleUrl('coverage-map-model.mjs'));
const { NIGERIA_BOUNDS } = await import('../../../packages/shared/src/locations.mjs');
class Node {
  constructor(tag) { this.tag = tag; this.children = []; this.attributes = {}; this.dataset = {}; this.events = {}; this.textContent = ''; this.value = ''; }
  append(...children) { for (const child of children) { child.parent = this; this.children.push(child); } }
  replaceChildren(...children) { this.children = []; this.append(...children); }
  setAttribute(name, value) { this.attributes[name] = String(value); if (name.startsWith('data-')) this.dataset[name.slice(5)] = String(value); }
  addEventListener(name, handler) { this.events[name] = handler; }
  focus() { globalThis.document.activeElement = this; }
  fire(name, values = {}) { let prevented = false; this.events[name]?.({ key: '', preventDefault() { prevented = true; }, ...values }); return prevented; }
  set innerHTML(value) { throw new Error('Unsafe innerHTML: ' + value); }
}
const all = (node) => [node, ...node.children.flatMap(all)];
const text = (node) => all(node).map((item) => item.textContent).join(' ').replace(/\s+/g, ' ');
function fixture(t) {
  const before = globalThis.document;
  globalThis.document = { createElement: (tag) => new Node(tag), createElementNS: (ns, tag) => new Node(tag), createTextNode: (text) => { const node = new Node('#text'); node.textContent = text; return node; } };
  t.after(() => { globalThis.document = before; });
}
const route = (search = '') => routeFor({ pathname: '/admin/coverage', search });
const historic = (requests = 0, wait = null) => ({ requests, unserved: requests ? 1 : 0, pickupWaitObservations: wait == null ? 0 : 2, meanPickupWaitSeconds: wait });
const current = (waitingRequests = 0, availableDrivers = 0) => ({ waitingRequests, availableDrivers, waitingObservations: waitingRequests, meanWaitingSeconds: waitingRequests ? 90 : null, maxWaitingSeconds: waitingRequests ? 120 : null });
const bounds = { west: 7.44, south: 9.06, east: 7.48, north: 9.1 };
const data = () => ({ asOf: Date.parse('2026-09-25T12:00:00Z'), filters: { from: '2026-09-01', to: '2026-09-25', service: 'ride', place: 'map-wuse', bbox: '', layer: 'coverage' },
  viewport: { bounds, cellDegrees: 0.01, place: { id: 'map-wuse', name: 'Wuse', stateId: 'fct' }, maxCells: 1600, approximate: true },
  historicalTotals: historic(8, 180), currentTotals: current(3, 2),
  cells: [{ key: '744:906', bounds: { west: 7.44, south: 9.06, east: 7.45, north: 9.07 }, ...historic(5, 0), ...current(2, 0) },
    { key: '745:906', bounds: { west: 7.45, south: 9.06, east: 7.46, north: 9.07 }, ...historic(3, null), ...current(1, 2) }],
  outsideViewport: { historical: historic(9, 40), current: current(4, 5) },
  offMap: { scope: 'nationwide', historical: { sample: historic(12), unlocated: historic(2) }, current: { sample: current(6, 7), unlocated: current(1, 0) } },
  nationwideTotals: { historical: historic(31, 120), current: current(14, 14) },
});
const button = (root, label) => all(root).find((node) => node.tag === 'button' && node.textContent === label);
const cells = (root) => all(root).filter((node) => node.tag === 'rect' && node.attributes.role === 'button');

test('coverage route uses existing demand permission and does not fetch for finance staff', async () => {
  assert.equal(route('?place=map-wuse').apiPath, '/api/admin/console/demand/coverage?place=map-wuse'); assert.equal(route().permission, 'demand.read');
  assert.throws(() => routeFor({ pathname: '/admin/coverage/11111111-1111-4111-8111-111111111111', search: '' }));
  const paths = [], errors = [], client = { session: async () => ({ user: { id: 'staff' }, staff: { role: 'finance', permissions: ['finance.read'] } }), setCsrf() {}, reset() {}, request: async (path) => paths.push(path) };
  await createAdminController({ client, route: route(), view: { clear() {}, loading() {}, signIn: (message) => errors.push(message), error() {}, render() {} } }).load();
  assert.equal(paths.length, 0); assert.match(errors.at(-1), /does not have access/);
});
test('viewport controls preserve historical filters, bound navigation to Nigeria and discard stale place identity', () => {
  const filters = data().filters, moved = shiftBounds(bounds, 'east'), url = new URL(coverageQuery(filters, { bbox: [moved.west, moved.south, moved.east, moved.north].join(','), place: '', layer: 'wait' }), 'https://example.test');
  assert.equal(url.searchParams.get('from'), filters.from); assert.equal(url.searchParams.get('to'), filters.to); assert.equal(url.searchParams.get('service'), 'ride'); assert.equal(url.searchParams.get('layer'), 'wait'); assert.equal(url.searchParams.has('place'), false);
  let expanded = bounds; for (let step = 0; step < 12; step++) expanded = shiftBounds(expanded, 'out');
  for (const key of ['west', 'south', 'east', 'north']) assert.ok(Math.abs(expanded[key] - NIGERIA_BOUNDS[key]) < 1e-9);
  for (const direction of ['north', 'south', 'east', 'west']) {
    const shifted = shiftBounds(expanded, direction); assert.ok(shifted.west >= NIGERIA_BOUNDS.west - 1e-9); assert.ok(shifted.east <= NIGERIA_BOUNDS.east + 1e-9); assert.ok(shifted.south >= NIGERIA_BOUNDS.south - 1e-9); assert.ok(shifted.north <= NIGERIA_BOUNDS.north + 1e-9);
  }
  const projection = mapProjection(bounds), northwest = projection.point([bounds.west, bounds.north]), southeast = projection.point([bounds.east, bounds.south]);
  assert.ok(northwest[0] < southeast[0]); assert.ok(northwest[1] < southeast[1]); assert.ok(northwest[0] >= 0 && southeast[0] <= 900); assert.ok(northwest[1] >= 0 && southeast[1] <= 560);
});
test('map renders a nationwide outline, measured cells and distinct snapshot/cohort/off-map disclosures', (t) => {
  fixture(t); const output = coverage(data(), route()), rendered = text(output);
  assert.match(rendered, /Wuse · approximate view/); assert.match(rendered, /includes waiting requests regardless of those dates/); assert.match(rendered, /not city, district or ward boundaries/);
  assert.match(rendered, /Saved sample locations · nationwide/); assert.match(rendered, /These counts are not demand for the selected city/); assert.match(rendered, /booking to first recorded driver arrival/); assert.match(rendered, /sample label such as Wuse does not establish a real pickup position/);
  assert.equal(cells(output).length, 2); assert.match(cells(output)[0].attributes.class, /tone-no-supply/); assert.match(cells(output)[1].attributes.class, /tone-covered/);
  assert.ok(all(output).some((node) => node.tag === 'path' && node.attributes.d.length > 10000)); assert.ok(all(output).some((node) => node.tag === 'option' && node.attributes.value === 'map-yenagoa')); assert.ok(all(output).some((node) => node.tag === 'option' && node.attributes.value === 'map-maitama'));
  assert.ok(all(output).some((node) => node.tag === 'a' && node.attributes.href === 'https://www.openstreetmap.org/copyright'));
  assert.doesNotMatch(rendered, /NaN|undefined|Infinity/);
});
test('layer switching updates the map, preserved navigation and forms locally without confusing valid zero waits with missing waits', (t) => {
  fixture(t); const output = coverage(data(), route()); button(output, 'Pickup waiting time').fire('click');
  assert.equal(button(output, 'Pickup waiting time').attributes['aria-pressed'], 'true'); assert.match(cells(output)[0].attributes.class, /tone-level-1/); assert.match(cells(output)[1].attributes.class, /tone-none/);
  assert.match(text(output), /0 sec · observed/); assert.doesNotMatch(text(output), /No measured values for this layer/);
  assert.equal(all(output).filter((node) => node.attributes.name === 'layer').every((node) => node.value === 'wait'), true);
  const zoom = all(output).find((node) => node.tag === 'a' && node.textContent === '+ Zoom in'); assert.equal(new URL(zoom.attributes.href, 'https://example.test').searchParams.get('layer'), 'wait');
  const wuse = all(output).find((node) => node.tag === 'a' && node.textContent === 'Explore Wuse ↗'); assert.equal(new URL(wuse.attributes.href, 'https://example.test').searchParams.get('service'), 'ride');
  button(output, 'Unserved requests').fire('click'); assert.match(text(output), /No unserved requests/);
  assert.equal(waitLabel(null), '—'); assert.equal(waitLabel(0), '0 sec'); assert.equal(waitLabel(59.6), '1 min 0 sec');
  assert.equal(cellTone({ ...historic(2), ...current(0, 2) }, 'coverage', 0), 'supply');
});
test('cell selection works with keyboard, touch/click and the numerical table', (t) => {
  fixture(t); const output = coverage(data(), route()), grid = cells(output);
  assert.equal(grid[0].attributes.tabindex, '0'); assert.equal(grid[1].attributes.tabindex, '-1'); assert.equal(grid[0].fire('keydown', { key: 'ArrowRight' }), true);
  assert.equal(globalThis.document.activeElement, grid[1]); assert.equal(grid[1].attributes['aria-pressed'], 'true'); assert.equal(grid[0].attributes.tabindex, '-1');
  assert.match(text(output), /GPS grid 745:906/); grid[0].fire('click'); assert.match(text(output), /GPS grid 744:906/); assert.equal(grid[0].attributes['aria-pressed'], 'true');
  const inspect = all(output).find((node) => node.attributes['aria-label'] === 'Inspect grid 745:906'); inspect.fire('click'); assert.equal(grid[1].attributes['aria-pressed'], 'true'); assert.match(text(output), /Mean observed pickup wait —/);
});
test('empty GPS view retains off-map counts and renders missing timing without inventing map observations', (t) => {
  fixture(t); const value = data(); value.cells = []; value.historicalTotals = historic(); value.currentTotals = current(); const output = coverage(value, route()); button(output, 'Pickup waiting time').fire('click');
  assert.equal(cells(output).length, 0); assert.match(text(output), /No mapped observations in this view/); assert.match(text(output), /No measured values for this layer/); assert.match(text(output), /0 valid arrival observations/); assert.match(text(output), /Saved sample locations · nationwide 12/);
  assert.doesNotMatch(text(output), /NaN|undefined|Infinity/);
});
test('numeric table pages mapped cells without changing map totals and treats unsafe labels as text', (t) => {
  fixture(t); const value = data(); value.viewport.place.name = '<img src=x onerror=alert(1)>'; const template = value.cells[0]; value.cells = Array.from({ length: 101 }, (_, index) => ({ ...template, key: 'cell-' + index }));
  const output = coverage(value, route()); assert.equal(cells(output).length, 101); assert.equal(all(output).filter((node) => node.tag === 'button' && node.textContent === 'Inspect cell').length, 100); assert.match(text(output), /Cells 1–100 of 101/);
  button(output, 'Next →').fire('click'); assert.match(text(output), /Cells 101–101 of 101/); assert.equal(all(output).filter((node) => node.tag === 'button' && node.textContent === 'Inspect cell').length, 1); assert.equal(cells(output).length, 101);
  assert.match(text(output), /<img src=x onerror=alert\(1\)> · approximate view/); assert.equal(all(output).some((node) => node.tag === 'img'), false);
});
