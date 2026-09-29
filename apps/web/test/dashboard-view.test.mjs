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
function setup(t, serverNow = () => 1000) {
  const old = globalThis.document, nodes = new Map(), created = [];
  for (const [, tag, id] of html.matchAll(/<(\w+)\b[^>]*?\bid="([^"]+)"/g)) nodes.set(id, new ElementFixture(tag));
  const node = (id) => { assert.ok(nodes.has(id), `Missing HTML element #${id}`); return nodes.get(id); };
  globalThis.document = { getElementById: node, createElement(tag) { const value = new ElementFixture(tag); created.push(value); return value; },
    querySelectorAll(selector) { const all = [...nodes.values(), ...created]; return selector === 'button'
      ? all.filter((value) => value.tag === 'button') : all.filter((value) => value.dataset.requestExpires); } };
  t.after(() => { globalThis.document = old; });
  const commands = [], mismatches = [], edits = [], categoryChanges = [];
  const view = createDashboardView({ serverNow, onCommand: (...args) => commands.push(args), onVehicleMismatch: (id) => mismatches.push(id), onEditVehicle: () => edits.push(true), onCategoryChange: (...args) => categoryChanges.push(args), onReview() {}, onReportReview() {}, onSelectionChange() {}, onHistory() {} });
  return { view, node, commands, mismatches, edits, categoryChanges };
}
const customer = { id: 'customer', name: 'Passenger', role: 'customer' };
const driver = { id: 'driver', name: 'Driver', role: 'driver', driver: { status: 'approved', eligibility: { eligible: true, reviewStatus: 'approved' }, vehicle: { model: 'Toyota', plate: 'TEST-001' } } };
const ride = { id: 'ride-one', status: 'booked', version: 4, createdAt: 1000, suggestedFareKobo: 450000,
  pickup: { name: 'Wuse' }, destination: { name: 'Maitama' }, customer, driver: { id: driver.id, name: driver.name, vehicle: driver.driver.vehicle },
  negotiation: { agreement: { amountKobo: 470001 } }, trip: { pickupPin: '123456' }, activity: [] };
const state = (user, rides = [ride]) => ({ user, rides, history: [], drivers: [], available: [], reports: [], chatUnread: {}, historyCursor: null });

test('timed ride offers show a road ETA and expiry, send explicit offer consent and block expired actions before the next tick', (t) => {
  let now = 1000; const h = setup(t, () => now);
  const offered = { ...ride, status: 'requested', expiresAt: 301000, hasRoute: true, approximateDistanceKm: 2,
    offer: { id: 'offer-one', expiresAt: 21000, pickupEtaMinutes: 4, etaSource: 'road' } };
  h.view.render({ ...state(driver, []), availabilityOnline: true, dispatchMode: 'sequential', available: [offered] });
  const row = h.node('available-list').children[0], [description, accept, decline] = row.children;
  assert.ok(description.children.some((node) => node.textContent === 'Ride offer'));
  assert.ok(description.children.some((node) => /About 4 min to pickup/.test(node.textContent)));
  assert.ok(description.children.some((node) => /Respond within 20 seconds/.test(node.textContent)));
  assert.ok(description.children.some((node) => /Both sides must agree/.test(node.textContent)));
  assert.equal(accept.textContent, 'Accept and negotiate');
  accept.handlers.click(); assert.deepEqual(h.commands[0].slice(0, 2), ['/api/rides/ride-one/claim', { expectedVersion: 4, offerId: 'offer-one' }]);
  decline.handlers.click(); assert.deepEqual(h.commands[1].slice(0, 2), ['/api/dispatch/offers/offer-one/decline', {}]);
  now = 21000; accept.handlers.click(); decline.handlers.click(); assert.equal(h.commands.length, 2);
  h.view.tick(); assert.equal(accept.disabled, true); assert.equal(decline.disabled, true);
  assert.ok(description.children.some((node) => /Offer expired/.test(node.textContent)));
});

test('sample and fallback ride offers do not claim road pickup times; stale handlers cannot accept a replaced offer', (t) => {
  const h = setup(t), offered = { ...ride, status: 'requested', expiresAt: 301000, hasRoute: true, approximateDistanceKm: 2,
    offer: { id: 'offer-one', expiresAt: 21000, pickupEtaMinutes: null, etaSource: 'distance_fallback' } };
  const next = { ...state(driver, []), availabilityOnline: true, dispatchMode: 'batch', available: [offered] };
  h.view.render(next); const oldAccept = h.node('available-list').children[0].children[1];
  let labels = h.node('available-list').children[0].children[0].children.map((node) => node.textContent).join(' ');
  assert.match(labels, /Road estimate unavailable/); assert.ok(!labels.includes('min to pickup'));
  h.view.render({ ...next, available: [{ ...offered, offer: { ...offered.offer, id: 'offer-two', etaSource: 'sample' } }] });
  oldAccept.handlers.click(); assert.equal(h.commands.length, 0);
  labels = h.node('available-list').children[0].children[0].children.map((node) => node.textContent).join(' ');
  assert.match(labels, /Local sample-area match/); assert.ok(!labels.includes('min to pickup'));
  h.view.reset(); oldAccept.handlers.click(); assert.equal(h.commands.length, 0);
  h.view.render({ ...next, dispatchMode: 'legacy', available: [{ ...offered, offer: undefined }] });
  h.node('available-list').children[0].children[1].handlers.click();
  assert.deepEqual(h.commands[0].slice(0, 2), ['/api/rides/ride-one/claim', { expectedVersion: 4 }]);
});

test('Edit / change vehicle is in the driver profile card and stays usable after dashboard ticks', (t) => {
  const h = setup(t), profile = html.match(/<section id="driver-panel"[^>]*>([\s\S]*?)<\/section>/)[1];
  assert.match(profile, /id="driver-edit-vehicle"/);
  h.view.render(state(driver, [])); h.view.tick();
  assert.equal(h.node('driver-edit-vehicle').disabled, false); h.node('driver-edit-vehicle').handlers.click();
  assert.equal(h.edits.length, 1);
  h.view.setBusy(true); h.view.tick(); h.node('driver-edit-vehicle').handlers.click();
  assert.equal(h.edits.length, 1); assert.equal(h.node('driver-edit-vehicle').disabled, true);
  h.view.setBusy(false); h.view.render(state(customer, [])); h.node('driver-edit-vehicle').handlers.click();
  assert.equal(h.edits.length, 1); assert.equal(h.node('driver-panel').hidden, true);
});

test('all categories book the selected service and delivery drafts clear at account boundaries', (t) => {
  const h = setup(t); h.view.render({ ...state(customer, []), sampleMatchingEnabled: true });
  h.node('request-destination').value = 'Mai';
  h.node('request-destination').handlers.input();
  h.node('request-form').handlers.submit({ preventDefault() {} });
  assert.equal(h.commands.length, 0, 'partial destination does not submit');
  h.node('request-destination').value = '  mAiTaMa  ';
  h.node('request-destination').handlers.input();
  const group = h.node('account-vehicle-categories').children[0];
  const category = (id) => group.children.find((button) => button.dataset.category === id);
  for (const id of ['standard', 'suv', 'van', 'truck', 'motorcycle']) {
    category(id).handlers.click(); h.view.render({ ...state(customer, []), sampleMatchingEnabled: true });
    assert.equal(h.node('standard-ride-planner').hidden, false); assert.equal(h.node('customer-panel').hidden, true);
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
    assert.equal(h.commands.at(-1)[1].destinationId, 'maitama');
    assert.equal(Boolean(h.commands.at(-1)[1].delivery), delivery);
    h.node('delivery-description').value = ''; h.node('delivery-weight').value = ''; h.node('delivery-recipient').value = '';
  }
  h.node('delivery-recipient').value = 'Private draft';
  category('suv').handlers.click(); h.view.reset(); h.view.render(state(driver, []));
  assert.equal(category('standard')['aria-checked'], 'true'); assert.equal(h.node('delivery-recipient').value, '');
  assert.equal(h.node('request-destination').value, '');
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

test('courier deep link survives authentication and books standard car parcels without passenger details', (t) => {
  const oldLocation = globalThis.location; globalThis.location = { search: '?service=courier' };
  t.after(() => { globalThis.location = oldLocation; });
  const h = setup(t); h.view.render(state(null, [])); h.view.reset(); h.view.render(state(customer, []));
  assert.equal(h.node('dashboard-title').textContent, 'Send a parcel across Nigeria.');
  assert.equal(h.node('delivery-details-form').hidden, false); assert.equal(h.node('passenger-panel').hidden, true);
  assert.equal(h.node('delivery-weight').max, '30');
  assert.deepEqual(h.categoryChanges.at(-1), ['standard', 'delivery']);
  const group = h.node('account-vehicle-categories').children[0];
  assert.equal(group.children.find((button) => button.dataset.category === 'suv').hidden, true);
  assert.equal(group.children[0].children[1].textContent, 'Car');
  h.node('delivery-description').value = 'Books and clothes'; h.node('delivery-weight').value = '4';
  h.node('delivery-recipient').value = 'Recipient';
  const options = h.view.requestOptions();
  assert.equal(options.vehicleCategory, 'standard'); assert.equal(options.delivery.weightKg, 4); assert.equal(options.passenger, undefined);
  h.view.render(state({ ...customer, id: 'other-customer' }, []));
  assert.equal(h.node('delivery-recipient').value, '', 'replacement accounts never inherit parcel drafts');
  h.node('booking-service-ride').handlers.click();
  assert.deepEqual(h.categoryChanges.at(-1), ['standard', 'ride']);
  assert.equal(h.node('dashboard-title').textContent, 'Where will today take you?');
  assert.equal(h.node('delivery-details-form').hidden, true); assert.equal(h.node('passenger-panel').hidden, false);
  assert.deepEqual(h.view.requestOptions(), { vehicleCategory: 'standard', passenger: { kind: 'self' } });
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
  assert.equal(h.node('fare-negotiation-guide').hidden, false);
  assert.equal(h.node('fare-open-chat').textContent, 'Chat with driver');
  assert.equal(h.node('fare-open-call').textContent, 'Call driver in app');
  assert.match(h.node('accept-fare').textContent, /Accept exact fare/);
  assert.match(h.node('fare-guidance').textContent, /Accept it only if you agree|exact offer/);
  h.node('fare-open-chat').handlers.click(); assert.equal(h.node('chat-message').focused, true);
  h.node('fare-open-call').handlers.click(); assert.equal(h.node('call-start').focused, true);
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

test('guest passenger consent gates booking; repeated renders preserve the exact draft and account/category changes clear it', (t) => {
  const h = setup(t), empty = { ...state(customer, []), sampleMatchingEnabled: true };
  h.view.render(empty);
  assert.equal(h.node('passenger-panel').hidden, false);
  h.node('request-destination').value = 'Maitama'; h.node('request-destination').handlers.input();
  h.node('passenger-kind').value = 'guest'; h.node('passenger-kind').handlers.change();
  h.node('passenger-name').value = 'Test Friend'; h.node('passenger-phone').value = '08012345678';
  h.node('request-form').handlers.submit({ preventDefault() {} }); assert.equal(h.commands.length, 0);
  assert.match(h.node('page-error').textContent, /adult/);
  h.node('passenger-consent').checked = true;
  h.node('passenger-phone').handlers.input(); assert.equal(h.node('passenger-consent').checked, false);
  h.node('passenger-consent').checked = true;
  h.node('request-form').handlers.submit({ preventDefault() {} });
  const payload = h.commands.at(-1)[1];
  assert.deepEqual(payload.passenger, { kind: 'guest', name: 'Test Friend', phone: '+2348012345678', consent: true });
  h.view.setBusy(true); h.view.render(empty); h.view.setBusy(false);
  assert.equal(h.node('passenger-name').value, 'Test Friend');
  h.node('request-form').handlers.submit({ preventDefault() {} }); assert.deepEqual(h.commands.at(-1)[1], payload);
  h.view.rideCreated(); assert.equal(h.node('passenger-name').value, ''); assert.equal(h.node('passenger-kind').value, 'self');
  const categories = h.node('account-vehicle-categories').children[0].children;
  categories.find((button) => button.dataset.category === 'van').handlers.click();
  assert.equal(h.node('passenger-panel').hidden, true); assert.equal(h.node('passenger-name').value, '');
  h.node('delivery-description').value = 'Test parcel'; h.node('delivery-weight').value = '1'; h.node('delivery-recipient').value = 'Recipient';
  assert.equal(Object.hasOwn(h.view.requestOptions(), 'passenger'), false);
  categories.find((button) => button.dataset.category === 'suv').handlers.click();
  assert.deepEqual(h.view.requestOptions().passenger, { kind: 'self' });
  h.node('passenger-kind').value = 'guest'; h.node('passenger-kind').handlers.change(); h.node('passenger-name').value = 'Private draft';
  h.view.render({ ...empty, user: { ...customer, id: 'other-account' } });
  assert.equal(h.node('passenger-name').value, ''); assert.equal(h.node('passenger-kind').value, 'self');
});

test('guest rider is labelled separately from booker, contact is owner-only, and pickup guidance addresses the actual passenger', (t) => {
  const h = setup(t), guest = { ...ride, passenger: { kind: 'guest', name: 'Test Friend', phone: '+2348012345678' } };
  h.view.render(state(customer, [guest]));
  assert.match(h.node('detail-passenger').textContent, /Passenger: Test Friend.*Booked by: Passenger/);
  assert.match(h.node('detail-passenger').textContent, /\+2348012345678/);
  assert.match(h.node('pickup-pin-guidance').textContent, /Do not send the PIN to the driver remotely/);
  assert.match(h.node('ride-list').children[0].children[0].children[2].textContent, /Passenger: Test Friend/);
  h.view.render(state(driver, [guest]));
  assert.ok(!h.node('detail-passenger').textContent.includes('+2348012345678'));
  assert.match(h.node('pickup-pin-help').textContent, /passenger, Test Friend/);
  h.view.reset(); assert.equal(h.node('detail-passenger').textContent, '');
});
