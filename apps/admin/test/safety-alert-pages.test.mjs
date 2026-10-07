import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
const root = new URL('../public/', import.meta.url), modules = new Map();
async function moduleUrl(name) {
  if (modules.has(name)) return modules.get(name);
  let source = await readFile(new URL(name, root), 'utf8');
  for (const match of [...source.matchAll(/from\s+(['"])(.*?)\1/g)]) {
    const path = match[2], url = path.startsWith('/shared/') ? new URL('../../../packages/shared/src/' + path.slice(8), import.meta.url).href : await moduleUrl(path.replace(/^\.\//, ''));
    source = source.replace(match[0], "from '" + url + "'");
  }
  const url = 'data:text/javascript;base64,' + Buffer.from(source).toString('base64'); modules.set(name, url); return url;
}
const pages = await import(await moduleUrl('safety-alert-pages.mjs'));
const { safetyAlertMap } = await import(await moduleUrl('safety-alert-map.mjs'));
class Element {
  constructor(tag) { this.tag = tag; this.children = []; this.attributes = {}; this.dataset = {}; this.handlers = {}; this.textContent = ''; }
  append(...values) { this.children.push(...values.map(v => typeof v === 'string' ? Object.assign(new Element('#text'), { textContent: v }) : v)); }
  replaceChildren(...values) { this.children = []; this.append(...values); }
  setAttribute(k, v) { this.attributes[k] = String(v); if (k === 'name') this.name = v; }
  getAttribute(k) { return this.attributes[k]; }
  addEventListener(k, fn) { this.handlers[k] = fn; }
}
const flatten = n => [n, ...(n.children || []).flatMap(flatten)];
const text = n => flatten(n).map(x => x.textContent).join(' ');
function setup(t) {
  const before = globalThis.document;
  globalThis.document = { createElement: tag => new Element(tag), createElementNS: (_, tag) => new Element(tag), createTextNode: s => Object.assign(new Element('#text'), { textContent: String(s) }) };
  t.after(() => { globalThis.document = before; });
}
const id = '12345678-1234-4234-8234-123456789012', now = Date.UTC(2026, 0, 1);
const position = { lat: 9.087654, lng: 7.412345, accuracy: 12, capturedAt: now, source: 'reporter_device', ageMs: 10000, stale: false };
const map = { enabled: true, tiles: 'https://tiles.example.test/{z}/{x}/{y}.png' };
const alert = { id, rideId: id, label: 'Possible crash', createdAt: now, dueAt: now + 30000, isTest: true, transportStatus: 'finished', review: { state: 'open', version: 0 }, passenger: { name: '<script>guest</script>' }, customer: { name: 'Booker' }, driver: { name: 'Driver' } };
const detail = { alert, passenger: { name: 'Passenger', kind: 'guest', phone: '+2348000000001', contactSource: 'saved_guest_booking' },
  customer: { name: 'Booker', id, contact: { email: 'booker@example.test', phone: null, source: 'current_account_profile' } },
  driver: { name: 'Driver', id, contact: { email: 'driver@example.test', phone: null }, vehicle: { plate: 'TEST-1', model: 'Fixture car', colour: 'white' } },
  reporter: { name: 'Reporter', id }, signal: { peakG: 6, capturedAt: now }, currentTripStatus: 'booked', incidentPosition: position,
  currentPositionRequested: false, canRequestCurrentPosition: true, map, deliveries: [{ id, status: 'accepted', attempts: 1 }], events: [], notice: 'Historical evidence.',
  readiness: { notice: 'Configuration only, not acceptance.', vehicleVisionConfigured: false, faceComparisonConfigured: false, notificationGatewayConfigured: false, emergencyPartnerConfigured: false } };

test('safety list uses plain text and distinguishes review from finished notifications', t => {
  setup(t); const page = pages.safetyAlerts({ items: [alert], filters: { kind: 'all', state: 'active' }, notice: 'Unverified signals.', nextBefore: null }, { path: '/admin/safety-alerts', query: new URLSearchParams() });
  assert.match(text(page), /<script>guest<\/script>/); assert.ok(!flatten(page).some(n => n.tag === 'script'));
  assert.match(text(page), /Needs acknowledgment/); assert.match(text(page), /Notification processing finished/);
  assert.match(text(page), /TEST \/ SIMULATED INPUT/);
});
test('detail shows distinct participants, unavailable phones and no delivered-to-person claim', t => {
  setup(t); const page = pages.safetyAlertDetail(detail), value = text(page);
  for (const label of ['Actual passenger', 'Booking customer', 'Assigned driver', 'TEST-1', 'booker@example.test', 'Not recorded', 'delivery unconfirmed']) assert.ok(value.includes(label), label);
  assert.ok(flatten(page).some(n => n.attributes.href === '/admin/safety-alerts/' + id + '?live=1'));
  assert.ok(!flatten(page).some(n => n.tag === 'image'), 'No provider tile loads without opt-in.');
});
test('historical map remains historical even for a recent timestamp and requests no device sensors', t => {
  setup(t); const page = safetyAlertMap(position, map), button = flatten(page).find(n => n.tag === 'button');
  assert.match(text(page), /never a live marker/); button.handlers.click();
  assert.equal(flatten(page).filter(n => n.tag === 'image').length, 9);
  assert.equal(flatten(page).find(n => n.tag === 'svg').attributes['aria-label'], 'Map of saved incident position');
});
test('missing, polar and unsafe provider configurations do not fabricate maps', t => {
  setup(t);
  assert.match(text(safetyAlertMap(null, map)), /unavailable/);
  assert.ok(!flatten(safetyAlertMap(position, { enabled: true, tiles: 'javascript:bad/{z}/{x}/{y}' })).some(n => n.tag === 'button'));
  assert.ok(!flatten(safetyAlertMap({ ...position, lat: 90 }, map)).some(n => n.tag === 'button'));
});
test('resolved review offers reopening without silently reopening the trip or resending an alert', t => {
  setup(t); const page = pages.safetyAlertDetail({ ...detail, alert: { ...alert, isTest: null, review: { state: 'resolved', version: 2 } }, canRequestCurrentPosition: false });
  const forms = flatten(page).filter(n => n.tag === 'form');
  assert.deepEqual(forms.map(n => n.actionData.action), ['note', 'reopen']);
  assert.ok(forms.every(n => n.actionData.expectedVersion === 2));
  assert.match(text(page), /incident not independently verified/);
  assert.ok(!flatten(page).some(n => n.attributes.href?.endsWith('?live=1')));
});
