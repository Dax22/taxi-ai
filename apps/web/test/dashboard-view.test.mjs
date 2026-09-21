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
const { createDashboardView } = await import(await moduleUrl('views.mjs', { './trip-view.mjs': tripView, './vehicle-card.mjs': await moduleUrl('vehicle-card.mjs'), './vehicle-categories.mjs': await moduleUrl('vehicle-categories.mjs') }));
const { createAccountModeView, modePreferences } = await import(await moduleUrl('account-mode-view.mjs', {
  './vehicle-fields.mjs': await moduleUrl('vehicle-fields.mjs'), './vehicle-card.mjs': await moduleUrl('vehicle-card.mjs'),
}));
const html = await readFile(new URL('../public/dashboard.html', import.meta.url), 'utf8');

// Strict IDs come from the shipped HTML; the small fixture does not test layout or a browser.
class ElementFixture {
  constructor(tag = 'div') { this.tag = tag; this.children = []; this.dataset = {}; this.textContent = ''; this.value = ''; this.handlers = {}; }
  append(...nodes) { this.children.push(...nodes); }
  replaceChildren(...nodes) { this.children = nodes; }
  setAttribute(name, value) { this[name] = value; }
  setCustomValidity(value) { this.validationMessage = value; }
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
  const commands = [], mismatches = [];
  const view = createDashboardView({ serverNow: () => 1000, onCommand: (...args) => commands.push(args), onVehicleMismatch: (id) => mismatches.push(id), onReview() {}, onReportReview() {}, onSelectionChange() {}, onHistory() {} });
  return { view, node, commands, mismatches };
}
const customer = { id: 'customer', name: 'Passenger', role: 'customer' };
const driver = { id: 'driver', name: 'Driver', role: 'driver', driver: { status: 'approved', eligibility: { eligible: true, reviewStatus: 'approved' }, vehicle: { model: 'Toyota', plate: 'TEST-001' } } };
const ride = { id: 'ride-one', status: 'booked', version: 4, createdAt: 1000, suggestedFareKobo: 450000,
  pickup: { name: 'Wuse' }, destination: { name: 'Maitama' }, customer, driver: { id: driver.id, name: driver.name, vehicle: driver.driver.vehicle },
  negotiation: { agreement: { amountKobo: 470001 } }, trip: { pickupPin: '123456' }, activity: [] };
const state = (user, rides = [ride]) => ({ user, rides, history: [], drivers: [], available: [], reports: [], chatUnread: {}, historyCursor: null });

test('all categories book the selected service and delivery drafts clear at account boundaries', (t) => {
  const h = setup(t); h.view.render({ ...state(customer, []), sampleMatchingEnabled: true });
  const group = h.node('account-vehicle-categories').children[0];
  const category = (id) => group.children.find((button) => button.dataset.category === id);
  for (const id of ['standard', 'suv', 'van', 'truck', 'motorcycle']) {
    category(id).handlers.click(); h.view.render({ ...state(customer, []), sampleMatchingEnabled: true });
    assert.equal(h.node('standard-ride-planner').hidden, false); assert.equal(h.node('customer-panel').hidden, false);
    assert.equal(category(id)['aria-checked'], 'true');
    const delivery = !['standard', 'suv'].includes(id);
    assert.equal(h.node('delivery-details-form').hidden, !delivery);
    if (delivery) {
      const before = h.commands.length;
      h.node('request-form').handlers.submit({ preventDefault() {} });
      assert.equal(h.commands.length, before, 'required parcel details gate submission');
      h.node('delivery-description').value = 'A small test parcel'; h.node('delivery-weight').value = '2';
      h.node('delivery-recipient').value = 'Test recipient';
    }
    h.node('request-form').handlers.submit({ preventDefault() {} });
    assert.equal(h.commands.at(-1)[1].vehicleCategory, id);
    assert.equal(Boolean(h.commands.at(-1)[1].delivery), delivery);
    h.node('delivery-description').value = ''; h.node('delivery-weight').value = ''; h.node('delivery-recipient').value = '';
  }
  h.node('delivery-recipient').value = 'Private draft';
  category('suv').handlers.click(); h.view.reset(); h.view.render(state(driver, []));
  assert.equal(category('standard')['aria-checked'], 'true'); assert.equal(h.node('delivery-recipient').value, '');
  assert.equal(h.node('vehicle-categories-panel').hidden, true); assert.equal(h.node('standard-ride-planner').hidden, true);
});

test('category keyboard navigation keeps focus and blocks switching while a command is pending', (t) => {
  const h = setup(t); h.view.render(state(customer, []));
  const buttons = h.node('account-vehicle-categories').children[0].children;
  buttons[0].handlers.keydown({ key: 'ArrowRight', preventDefault() {} });
  assert.equal(buttons[1]['aria-checked'], 'true'); assert.equal(buttons[1].focused, true);
  assert.equal(buttons[0].tabIndex, -1); assert.equal(buttons[1].tabIndex, 0);
  h.view.setBusy(true); buttons[1].handlers.keydown({ key: 'End', preventDefault() {} });
  assert.equal(buttons[1]['aria-checked'], 'true');
  h.view.setBusy(false); buttons[1].handlers.keydown({ key: 'Home', preventDefault() {} });
  assert.equal(buttons[0]['aria-checked'], 'true'); assert.equal(buttons[0].focused, true);
});

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

test('arrival identity belongs to the selected rider journey and mismatch shortcuts cannot act for the driver or after closure', (t) => {
  const h = setup(t), arrived = { ...ride, status: 'arrived', driver: { ...ride.driver, vehicle: { ...ride.driver.vehicle, colour: 'Silver', category: 'suv' } } };
  h.view.render(state(customer, [arrived]));
  assert.equal(h.node('pickup-identity').hidden, false); assert.equal(h.node('arrival-title').textContent, 'Driver has arrived');
  for (const value of ['Driver', 'Toyota', 'TEST-001', 'Silver', 'SUV']) assert.ok(h.node('arrival-body').textContent.includes(value));
  h.node('vehicle-mismatch-report').handlers.click(); assert.deepEqual(h.mismatches, [ride.id]);
  h.view.setBusy(true); h.node('vehicle-mismatch-report').handlers.click(); assert.equal(h.mismatches.length, 1); h.view.setBusy(false);
  h.view.render(state(driver, [arrived])); assert.equal(h.node('pickup-identity').hidden, true);
  h.node('vehicle-mismatch-report').handlers.click(); assert.equal(h.mismatches.length, 1);
  h.view.render(state(customer, [{ ...arrived, status: 'completed' }])); assert.equal(h.node('pickup-identity').hidden, true);
  h.view.reset(); assert.equal(h.node('arrival-body').textContent, '');
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
  assert.equal(h.node('driver-profile-make').focused, true);
  assert.equal(h.node('driver-profile-model').disabled, true);
  for (const name of ['make', 'model', 'year', 'colour']) assert.equal(h.node('driver-profile-' + name).tag, 'select');
  const values = (name) => h.node('driver-profile-' + name).children.map((option) => option.value);
  assert.ok(values('year').includes('2000')); assert.ok(!values('year').includes('1999'));
  assert.equal(values('year')[1], String(new Date().getUTCFullYear()));
  h.node('driver-profile-make').value = 'Toyota'; h.node('driver-profile-make').handlers.change();
  assert.equal(h.node('driver-profile-model').disabled, false);
  assert.ok(values('model').includes('Corolla')); assert.ok(!values('model').includes('Civic'));
  h.node('driver-profile-model').value = 'Corolla'; h.node('driver-profile-year').value = '2020';
  h.node('driver-profile-colour').value = 'Blue'; h.node('driver-profile-colour').handlers.change();
  h.node('driver-profile-plate').value = 'TEST-001'; h.node('driver-profile-plate').handlers.input();
  assert.equal(h.node('driver-profile-preview').children[0].children[0].children[0].src, '/assets/vehicles/sedan-blue.png');
  assert.equal(h.node('onboarding-make').value, '', 'initial and full application selectors have independent state');
  mode.render(value, true);
  h.node('driver-enrollment').handlers.submit({ preventDefault() {} }); assert.equal(applications.length, 0);
  assert.equal(h.node('driver-profile-colour').disabled, true);
  mode.render(value);
  assert.equal(h.node('driver-profile-model').value, 'Corolla', 'polling keeps the chosen model');
  assert.equal(h.node('driver-profile-colour').value, 'Blue');
  h.node('driver-enrollment').handlers.submit({ preventDefault() {} });
  assert.deepEqual(applications, [{ make: 'Toyota', model: 'Corolla', year: 2020, colour: 'Blue', plate: 'TEST-001', category: 'standard', payloadKg: null }]);
  h.node('driver-profile-make').value = 'Honda'; h.node('driver-profile-make').handlers.change();
  assert.equal(h.node('driver-profile-model').value, ''); assert.ok(values('model').includes('Civic'));
  h.node('driver-enrollment-cancel').handlers.click();
  for (const name of ['make', 'model', 'year', 'colour', 'plate']) assert.equal(h.node('driver-profile-' + name).value, '');
  assert.equal(h.node('driver-profile-preview').children.length, 0);
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

test('delivery handover controls require the code, respect lockout, and erase it on account reset', (t) => {
  const h = setup(t), delivery = { ...ride, status: 'in_progress', vehicleCategory: 'van',
    trip: { status: 'in_progress' }, delivery: { description: 'A test parcel', weightKg: 3, recipientName: 'Private recipient',
      pickupInstructions: '', dropoffInstructions: '', pinBlockedUntil: null, dropoffPin: '654321' } };
  h.view.render(state(customer, [delivery])); assert.equal(h.node('delivery-pin-value').textContent, '654321');
  assert.equal(h.node('delivery-pin-panel').hidden, false); assert.equal(h.node('delivery-pin-form').hidden, true);
  h.view.reset(); assert.equal(h.node('delivery-pin-value').textContent, '');
  h.view.render(state(driver, [{ ...delivery, delivery: { ...delivery.delivery, dropoffPin: undefined } }]));
  assert.equal(h.node('delivery-pin-form').hidden, false); assert.equal(h.node('trip-action').hidden, true);
  h.node('driver-delivery-pin').value = '654321'; h.node('delivery-pin-form').handlers.submit({ preventDefault() {} });
  assert.deepEqual(h.commands.at(-1).slice(0, 2), ['/api/rides/ride-one/complete', { expectedVersion: 4, deliveryPin: '654321' }]);
  h.view.render(state(driver, [{ ...delivery, delivery: { ...delivery.delivery, dropoffPin: undefined, pinBlockedUntil: 10000 } }]));
  assert.equal(h.node('delivery-complete').disabled, true);
  h.node('delivery-pin-form').handlers.submit({ preventDefault() {} }); assert.equal(h.commands.length, 1);
  h.view.reset(); assert.equal(h.node('driver-delivery-pin').value, ''); assert.equal(h.node('detail-delivery').textContent, '');
});
