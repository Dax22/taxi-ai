import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

// Resolve the browser's allowlisted /shared imports for Node-only interaction tests.
// This small DOM fixture is not a substitute for real-browser layout review.
const shared = new URL('../../../packages/shared/src/', import.meta.url);
function sharedImports(source) {
  return source.replaceAll("'/shared/demo-booking.mjs'", `'${new URL('demo-booking.mjs', shared)}'`)
    .replaceAll("'/shared/pickup-identity.mjs'", `'${new URL('pickup-identity.mjs', shared)}'`)
    .replaceAll("'/shared/trip-lifecycle.mjs'", `'${new URL('trip-lifecycle.mjs', shared)}'`);
}
const modelUrl = `data:text/javascript;base64,${Buffer.from(sharedImports(await readFile(new URL('../public/dashboard/trip-model.mjs', import.meta.url), 'utf8'))).toString('base64')}`;
const viewSource = sharedImports(await readFile(new URL('../public/dashboard/trip-view.mjs', import.meta.url), 'utf8'))
  .replace("'./trip-model.mjs'", `'${modelUrl}'`)
  .replace("'./dom.mjs'", `'${new URL('../public/dashboard/dom.mjs', import.meta.url)}'`);
const { createTripView } = await import(`data:text/javascript,${encodeURIComponent(viewSource)}`);
const { tripControls } = await import(modelUrl);

class NodeFixture {
  constructor() { this.dataset = {}; this.children = []; this.handlers = {}; this.value = ''; this.textContent = ''; this.hidden = false; }
  addEventListener(type, handler) { this.handlers[type] = handler; }
  append(...nodes) { this.children.push(...nodes); }
  replaceChildren(...nodes) { this.children = nodes; }
  focus() { this.focused = true; }
  fire(type) { this.handlers[type]?.({ preventDefault() {} }); }
}

function setup(t) {
  const previous = globalThis.document;
  const nodes = new Map();
  const node = (id) => { if (!nodes.has(id)) nodes.set(id, new NodeFixture()); return nodes.get(id); };
  globalThis.document = { getElementById: node, createElement: () => new NodeFixture() };
  t.after(() => { globalThis.document = previous; });
  let now = 1000;
  const commands = [];
  const view = createTripView({ serverNow: () => now, onCommand: (...args) => commands.push(args) });
  return { node, commands, view, advance(ms) { now += ms; } };
}

const customer = { id: 'customer', role: 'customer' };
const driver = { id: 'driver', role: 'driver', driver: { status: 'approved' } };
const ride = (status = 'booked', extra = {}) => ({ id: 'ride-one', version: 4, status,
  customer: { id: 'customer' }, driver: { id: 'driver' },
  negotiation: { agreement: { amountKobo: 470000 } },
  trip: { pickupPin: '001234', pinBlockedUntil: null }, activity: [], ...extra });

test('parcel recipient arrival has its own versioned driver action and leaves the handover code available', (t) => {
  const { view, node, commands } = setup(t);
  view.render(ride('in_progress', { delivery: { arrivedAt: null } }), driver);
  assert.equal(node('delivery-arrive').hidden, false); assert.equal(node('delivery-pin-form').hidden, false);
  node('delivery-arrive').onclick(); assert.equal(commands[0][0], '/api/rides/ride-one/delivery_arrive');
  assert.deepEqual(commands[0][1], { expectedVersion: 4 });
  view.setBusy(true); assert.equal(node('delivery-arrive').disabled, true); view.setBusy(false);
  view.render(ride('in_progress', { delivery: { arrivedAt: 1000 } }), driver); assert.equal(node('delivery-arrive').hidden, true);
  assert.equal(node('delivery-pin-form').hidden, false);
  view.render(ride('arrived', { delivery: { arrivedAt: null } }), driver); assert.equal(node('delivery-arrive').hidden, true);
  view.render(ride('in_progress', { delivery: { arrivedAt: null } }), customer); assert.equal(node('delivery-arrive').hidden, true);
});

test('pickup PINs and entered PINs are cleared on participant changes, trip changes, start and reset', (t) => {
  const { view, node } = setup(t);
  view.render(ride(), customer);
  assert.equal(node('pickup-pin-value').textContent, '001234');
  view.render(ride('arrived'), driver);
  assert.equal(node('pickup-pin-value').textContent, '');
  assert.equal(node('pickup-pin-panel').hidden, true);
  node('driver-pickup-pin').value = '001234';
  view.render(ride('arrived'), driver);
  assert.equal(node('driver-pickup-pin').value, '001234', 'polling must not erase a PIN being entered');
  view.render(ride('arrived', { id: 'ride-two' }), driver);
  assert.equal(node('driver-pickup-pin').value, '');
  node('driver-pickup-pin').value = '222222';
  view.render(ride('in_progress', { id: 'ride-two' }), driver);
  assert.equal(node('driver-pickup-pin').value, '');
  view.render(ride(), customer);
  view.reset();
  assert.equal(node('pickup-pin-value').textContent, '');
  assert.equal(node('trip-panel').hidden, true);
});

test('trip buttons preserve their displayed version and cancellation requires the separate confirmation form', (t) => {
  const { view, node, commands } = setup(t);
  view.render(ride(), driver);
  const displayed = node('trip-action').onclick;
  view.render(ride('on_way', { version: 5 }), driver);
  displayed();
  assert.deepEqual(commands[0].slice(0, 2), ['/api/rides/ride-one/depart', { expectedVersion: 4 }]);
  node('cancel-request').fire('click');
  assert.equal(node('trip-cancel-form').hidden, false);
  assert.equal(commands.length, 1, 'opening cancellation does not send a command');
  node('trip-cancel-reason').value = 'pickup_problem';
  node('trip-cancel-form').fire('submit');
  assert.deepEqual(commands[1].slice(0, 2), ['/api/rides/ride-one/cancel', { expectedVersion: 5, reason: 'pickup_problem' }]);
  view.render(ride('arrived', { version: 6 }), driver);
  node('driver-pickup-pin').value = '001234';
  node('pickup-pin-form').fire('submit');
  assert.deepEqual(commands[2].slice(0, 2), ['/api/rides/ride-one/start', { expectedVersion: 6, pickupPin: '001234' }]);
});

test('PIN cooldown, busy states and terminal status prevent UI actions while role controls stay isolated', (t) => {
  const { view, node, commands, advance } = setup(t);
  view.render(ride('arrived', { trip: { pinBlockedUntil: 2000 } }), driver);
  node('driver-pickup-pin').value = '001234';
  assert.equal(node('pickup-pin-fields').disabled, true);
  node('pickup-pin-form').fire('submit');
  assert.equal(commands.length, 0);
  advance(1000); view.tick();
  assert.equal(node('pickup-pin-fields').disabled, false);
  view.setBusy(true); node('pickup-pin-form').fire('submit');
  assert.equal(commands.length, 0);
  view.setBusy(false); node('pickup-pin-form').fire('submit');
  assert.equal(commands.length, 1);
  view.render(ride('completed'), customer);
  assert.equal(node('cancel-request').hidden, true);
  assert.equal(node('pickup-pin-value').textContent, '');
  assert.equal(tripControls(ride('agreed'), driver, 1000).confirm, false);
  assert.equal(tripControls(ride('agreed'), customer, 1000).confirm, true);
  for (const user of [{ id: 'outsider', role: 'customer' }, { id: 'admin', role: 'admin' }, { ...driver, driver: { status: 'pending' } }]) {
    const controls = tripControls(ride(), user, 1000);
    assert.equal(controls.next, null); assert.equal(controls.confirm, false); assert.equal(controls.cancel, false); assert.equal(controls.pin, null);
  }
});
