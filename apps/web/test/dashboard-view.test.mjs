import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const root = new URL('../public/dashboard/', import.meta.url);
async function moduleUrl(name, dependencies = {}) {
  let source = await readFile(new URL(name, root), 'utf8');
  source = source.replace(/from\s+(['"])(.*?)\1/g, (_, quote, specifier) => {
    const resolved = dependencies[specifier] ?? (specifier.startsWith('/shared/')
      ? new URL('../../../packages/shared/src/' + specifier.slice(8), import.meta.url).href
      : new URL(specifier, root).href);
    return `from${' '}'${resolved}'`;
  });
  return `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;
}
const tripModel = await moduleUrl('trip-model.mjs');
const tripView = await moduleUrl('trip-view.mjs', { './trip-model.mjs': tripModel });
const { createDashboardView } = await import(await moduleUrl('views.mjs', { './trip-view.mjs': tripView, './vehicle-card.mjs': await moduleUrl('vehicle-card.mjs') }));
const { createAccountModeView, modePreferences } = await import(await moduleUrl('account-mode-view.mjs'));
const html = await readFile(new URL('../public/dashboard.html', import.meta.url), 'utf8');

// Strict IDs come from the shipped HTML; the small fixture does not test layout or a browser.
class ElementFixture {
  constructor(tag = 'div') { this.tag = tag; this.children = []; this.dataset = {}; this.textContent = ''; this.value = ''; this.handlers = {}; }
  append(...nodes) { this.children.push(...nodes); }
  replaceChildren(...nodes) { this.children = nodes; }
  setAttribute(name, value) { this[name] = value; }
  addEventListener(type, fn) { this.handlers[type] = fn; }
  closest() { return null; }
  focus() { this.focused = true; }
  reset() { this.resets = (this.resets ?? 0) + 1; }
}
function setup(t) {
  const old = globalThis.document, nodes = new Map(), created = [];
  for (const [, tag, id] of html.matchAll(/<(\w+)\b[^>]*?\bid="([^"]+)"/g)) nodes.set(id, new ElementFixture(tag));
  const node = (id) => { assert.ok(nodes.has(id), `Missing HTML element #${id}`); return nodes.get(id); };
  globalThis.document = { getElementById: node, createElement(tag) { const value = new ElementFixture(tag); created.push(value); return value; },
    querySelectorAll(selector) { const all = [...nodes.values(), ...created]; return selector === 'button'
      ? all.filter((value) => value.tag === 'button') : all.filter((value) => value.dataset.requestExpires); } };
  t.after(() => { globalThis.document = old; });
  const commands = [];
  const view = createDashboardView({ serverNow: () => 1000, onCommand: (...args) => commands.push(args), onReview() {}, onReportReview() {}, onSelectionChange() {}, onHistory() {} });
  return { view, node, commands };
}
const customer = { id: 'customer', name: 'Passenger', role: 'customer' };
const driver = { id: 'driver', name: 'Driver', role: 'driver', driver: { status: 'approved', eligibility: { eligible: true, reviewStatus: 'approved' }, vehicle: { model: 'Toyota', plate: 'TEST-001' } } };
const ride = { id: 'ride-one', status: 'booked', version: 4, createdAt: 1000, suggestedFareKobo: 450000,
  pickup: { name: 'Wuse' }, destination: { name: 'Maitama' }, customer, driver: { id: driver.id, name: driver.name, vehicle: driver.driver.vehicle },
  negotiation: { agreement: { amountKobo: 470001 } }, trip: { pickupPin: '123456' }, activity: [] };
const state = (user, rides = [ride]) => ({ user, rides, history: [], drivers: [], available: [], reports: [], chatUnread: {}, historyCursor: null });

test('dashboard reset removes trip identities, fare, plate, history and PIN before a different account renders', (t) => {
  const h = setup(t); h.view.render(state(customer));
  assert.match(h.node('detail-person').textContent, /TEST-001/);
  assert.equal(h.node('pickup-pin-value').textContent, '123456');
  h.view.reset(); h.view.render(state(null, []));
  for (const id of ['detail-title', 'detail-person', 'detail-reference', 'fare-value', 'account-identity', 'pickup-pin-value']) assert.equal(h.node(id).textContent, '', id);
  assert.equal(h.node('live-offer-amount').value, ''); assert.equal(h.node('accept-fare').onclick, null);
  assert.equal(h.node('dashboard').hidden, true); assert.equal(h.node('ride-detail').hidden, true);
  assert.equal(h.view.selected(), undefined); assert.deepEqual(h.node('ride-list').children, []);
  h.view.render(state(driver, [])); assert.equal(h.node('driver-panel').hidden, false);
  assert.equal(h.node('customer-panel').hidden, true); assert.equal(h.node('ride-detail').hidden, true);
  h.view.reset(); h.view.render(state({ id: 'admin', role: 'admin', name: 'Operator' }, []));
  assert.equal(h.node('admin-dashboard').hidden, false); assert.equal(h.node('ride-dashboard').hidden, true);
  assert.equal(h.node('driver-vehicle').textContent, '');
});

test('fare buttons retain the displayed offer version and never accept a newer price implicitly', (t) => {
  const h = setup(t);
  const negotiating = { ...ride, status: 'negotiating', trip: null,
    negotiation: { currentOffer: { id: 'offer-one', proposedBy: driver.id, amountKobo: 470001, expiresAt: 2000 } } };
  h.view.render(state(customer, [negotiating]));
  const displayed = h.node('accept-fare').onclick;
  h.view.render(state(customer, [{ ...negotiating, version: 5, negotiation: { currentOffer: {
    id: 'offer-two', proposedBy: driver.id, amountKobo: 490000, expiresAt: 2000,
  } } }]));
  displayed();
  assert.deepEqual(h.commands[0].slice(0, 2), ['/api/rides/ride-one/accept', { expectedVersion: 4, offerId: 'offer-one' }]);
  h.node('accept-fare').onclick();
  assert.deepEqual(h.commands[1].slice(0, 2), ['/api/rides/ride-one/accept', { expectedVersion: 5, offerId: 'offer-two' }]);
});


test('mode controls use actual HTML, keep enrollment separate from approval and omit public administrator switching', (t) => {
  const h = setup(t), switches = [], applications = [], opened = [];
  const mode = createAccountModeView({ onSwitch: (...args) => switches.push(args), onCancel() {},
    onAddDriver: (value) => applications.push(value), onOpenRide: (id) => opened.push(id) });
  const customerAccount = { ...customer, capabilities: ['customer'] };
  let value = { account: customerAccount, mode: 'customer', modePrompt: false, activeElsewhere: [] };
  mode.render(value);
  assert.equal(h.node('mode-customer')['aria-pressed'], 'true');
  assert.equal(h.node('mode-work').textContent, 'Apply to drive');
  h.node('mode-work').handlers.click(); assert.equal(h.node('driver-enrollment').hidden, false);
  assert.equal(h.node('driver-profile-model').focused, true);
  h.node('driver-profile-model').value = 'Toyota'; h.node('driver-profile-plate').value = 'TEST-001';
  h.node('driver-enrollment').handlers.submit({ preventDefault() {} });
  assert.deepEqual(applications, [{ model: 'Toyota', plate: 'TEST-001' }]);
  value = { ...value, account: { ...customerAccount, capabilities: ['customer', 'driver'], driver: { status: 'pending' } },
    mode: 'work', modePrompt: true, activeElsewhere: [{ id: 'passenger-journey', mode: 'customer', status: 'booked' }] };
  mode.render(value); assert.equal(h.node('driver-enrollment').hidden, true);
  assert.match(h.node('mode-note').textContent, /Approval.*required/);
  assert.equal(h.node('mode-confirm').hidden, false); assert.equal(h.node('mode-active').hidden, false);
  h.node('mode-active-list').children[0].children[0].handlers.click(); assert.deepEqual(opened, ['passenger-journey']);
  h.node('mode-offline-confirm').handlers.click(); assert.deepEqual(switches, [['customer', true]]);
  mode.render({ ...value, account: { id: 'staff', role: 'admin', capabilities: [] } });
  assert.equal(h.node('account-modes').hidden, true);
  mode.reset(); assert.equal(h.node('mode-active-list').children.length, 0);
});

test('mode preferences are per-account and optional browser storage failure does not block navigation', () => {
  const values = new Map(), storage = { getItem: (key) => values.get(key), setItem: (key, value) => values.set(key, value), removeItem: (key) => values.delete(key) };
  const preference = modePreferences(storage); preference.set('one', 'work'); preference.set('two', 'customer');
  assert.equal(preference.get('one'), 'work'); preference.clear('one'); assert.equal(preference.get('one'), undefined);
  assert.equal(preference.get('two'), 'customer');
  const unavailable = modePreferences(); assert.equal(unavailable.get('one'), null);
  assert.doesNotThrow(() => { unavailable.set('one', 'work'); unavailable.clear('one'); });
});

test('journey cards use the selected trip snapshot and clear the vehicle when no trip or account is selected', (t) => {
  const h = setup(t), original = { ...ride,driver:{ ...ride.driver,vehicle:{ model:'Honda Accord',plate:'OLD-123',colour:'Red',year:2018 } } };
  h.view.render({ ...state(driver,[original]),user:{ ...driver,driver:{ ...driver.driver,vehicle:{ model:'Toyota Corolla',plate:'NEW-456',colour:'Blue' } } } });
  const details = h.node('detail-vehicle-card').children[0].children[1];
  assert.equal(details.children[1].textContent,'Honda Accord'); assert.equal(details.children[3].textContent,'OLD-123');
  h.view.render(state(customer,[])); assert.equal(h.node('detail-vehicle-card').hidden,true); assert.deepEqual(h.node('detail-vehicle-card').children,[]);
  h.view.reset(); assert.deepEqual(h.node('driver-vehicle-card').children,[]);
});
