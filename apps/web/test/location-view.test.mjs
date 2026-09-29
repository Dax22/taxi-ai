import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { NIGERIA_CENTER } from '../../../packages/shared/src/locations.mjs';

const uri = (source) => `data:text/javascript,${encodeURIComponent(source)}`;
function imports(source) {
  return source.replaceAll("'/shared/locations.mjs'", `'${new URL('../../../packages/shared/src/locations.mjs', import.meta.url)}'`)
    .replaceAll("'/shared/vehicle-profile.mjs'", `'${new URL('../../../packages/shared/src/vehicle-profile.mjs', import.meta.url)}'`)
    .replaceAll("'/shared/demo-booking.mjs'", `'${new URL('../../../packages/shared/src/demo-booking.mjs', import.meta.url)}'`)
    .replaceAll("'/shared/transport-categories.mjs'", `'${new URL('../../../packages/shared/src/transport-categories.mjs', import.meta.url)}'`)
    .replaceAll("'/shared/vehicle-categories.mjs'", `'${new URL('../../../packages/shared/src/vehicle-categories.mjs', import.meta.url)}'`)
    .replaceAll("'/shared/kemmy.mjs'", `'${new URL('../../../packages/shared/src/kemmy.mjs', import.meta.url)}'`)
    .replaceAll("'./dom.mjs'", `'${new URL('../public/dashboard/dom.mjs', import.meta.url)}'`);
}
const mapSource = uri(imports(await readFile(new URL('../public/dashboard/map-view.mjs', import.meta.url), 'utf8')));
const { createMapView } = await import(mapSource);
const viewSource = imports(await readFile(new URL('../public/dashboard/location-view.mjs', import.meta.url), 'utf8'))
  .replace("'./map-view.mjs'", JSON.stringify(mapSource));
const { createLocationView } = await import(uri(viewSource));
const html = await readFile(new URL('../public/dashboard.html', import.meta.url), 'utf8');
const ids = new Set([...html.matchAll(/id="([^"]+)"/g)].map((match) => match[1]));

class NodeFixture {
  constructor(tag = 'div') { this.tag = tag; }
  dataset = {}; handlers = {}; children = []; attributes = {}; textContent = ''; value = ''; hidden = false;
  addEventListener(type, handler) { this.handlers[type] = handler; }
  setAttribute(name, value) { this.attributes[name] = value; }
  append(...nodes) { this.children.push(...nodes); }
  replaceChildren(...nodes) { this.children = nodes; }
  set innerHTML(_) { throw new Error('Untrusted map labels must use textContent'); }
  getBoundingClientRect() { return { left: 20, top: 10, width: 400, height: 200 }; }
  fire(type, details = {}) { let prevented = false; this.handlers[type]?.({ preventDefault() { prevented = true; }, ...details }); return prevented; }
}
function setup(t) {
  const previous = globalThis.document, nodes = new Map();
  const node = (id) => { assert.ok(ids.has(id), `Dashboard HTML must contain #${id}`); if (!nodes.has(id)) nodes.set(id, new NodeFixture()); return nodes.get(id); };
  const stars = [1,2,3,4,5].map((value) => { const item = new NodeFixture('button'); item.dataset.kemmyStars = String(value); return item; });
  globalThis.document = { getElementById: node, createElement: (tag) => new NodeFixture(tag), createElementNS: (_, tag) => new NodeFixture(tag),
    querySelectorAll: (selector) => selector === '[data-kemmy-stars]' ? stars : [] };
  t.after(() => { globalThis.document = previous; });
  return { node, stars };
}
const descendants = (node) => [node, ...node.children.flatMap(descendants)];
const tiles = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';

test('map opt-in gates all external tiles; re-renders preserve caching and late tile failures remain visible', (t) => {
  setup(t);
  const root = new NodeFixture(), picked = [], map = createMapView(root, { onPick: (point) => picked.push(point) });
  map.render({ enabled: false, tiles });
  assert.equal(descendants(root).filter((n) => n.tag === 'image').length, 0);
  map.render({ enabled: true, tiles });
  const images = descendants(root).filter((n) => n.tag === 'image');
  assert.ok(images.length > 0 && images.length <= 15, 'only the visible viewport is loaded');
  assert.ok(images.every((n) => /^https:\/\/tile.openstreetmap.org\/\d+\/\d+\/\d+\.png$/.test(n.attributes.href)));
  map.render({ enabled: true, tiles });
  assert.equal(descendants(root).find((n) => n.tag === 'image'), images[0]);
  images[0].fire('error'); map.render({ enabled: true, tiles });
  assert.match(root.children.at(-1).textContent, /could not load/);
  const canvas = descendants(root).find((n) => n.tag === 'svg');
  canvas.fire('click', { clientX: 220, clientY: 110 });
  assert.ok(Math.abs(picked[0].lat - NIGERIA_CENTER.lat) < 0.00001);
  assert.ok(Math.abs(picked[0].lng - NIGERIA_CENTER.lng) < 0.00001);
  assert.equal(canvas.fire('keydown', { key: 'ArrowRight' }), true);
  canvas.fire('keydown', { key: 'Enter' }); assert.ok(picked[1].lng > picked[0].lng);
  map.reset(); images[0].fire('error'); canvas.fire('click', { clientX: 220, clientY: 110 });
  assert.equal(picked.length, 2); assert.equal(descendants(root).filter((n) => n.tag === 'image').length, 0);
  assert.match(root.children.at(-1).textContent, /Enable online maps/);
});

function locationSetup(t) {
  const { node, stars } = setup(t), actions = [];
  const view = createLocationView(Object.fromEntries(['Enable', 'UsePickup', 'Search', 'FindRide', 'Clear', 'Select', 'ChooseOption', 'Pick', 'Target', 'Preview', 'Book', 'Start', 'Stop', 'Rate']
    .map((name) => [`on${name}`, (...args) => actions.push([name, ...args])])));
  return { node, stars, actions, view };
}
const pickup = { lat: 9.08, lng: 7.4, name: '<img src=x onerror=alert(1)>' }, destination = { lat: 9.1, lng: 7.45, name: 'Destination' };
const settings = { enabled: true, tiles, searchHost: 'search.test', routeHost: 'route.test', tileHost: 'tiles.test' };

test('planner binds actual HTML controls, renders plain-text places and prevents expired or conflicting bookings', (t) => {
  const { node, actions, view } = locationSetup(t);
  const state = { user: { role: 'customer' }, online: true, settings, searching: { pickup: false, destination: false },
    results: { pickup: [], destination: [destination] }, pickup, destination, target: 'destination', error: '',
    blocked: false, booking: false, locatingPickup: false, supported: true, quoting: false, expired: false, rideDiscovery: true, vehicleCategory: 'standard', quote: { id: 'quote', route: {
      distanceMeters: 7000, durationSeconds: 1200, suggestedFareKobo: 250000, coordinates: [[7.4, 9.08], [7.45, 9.1]],
      pricing: { baseKobo: 50000, perKmKobo: 20000, perMinuteKobo: 3000, minimumKobo: 100000, incrementKobo: 5000 },
    } } };
  view.renderPlanner(state);
  assert.equal(node('location-distance').textContent, '7.0 km'); assert.equal(node('location-duration').textContent, '20 min');
  assert.equal(node('location-book').disabled, false);
  assert.equal(node('location-ride-options').children.length, 2);
  assert.equal(node('location-ride-options').children[0].attributes['aria-checked'], 'true');
  assert.match(node('location-pickup-selected').textContent, /<img src=x/);
  assert.equal(node('location-pickup-manual').hidden, true);
  assert.equal(node('location-target-pickup').disabled, true);
  assert.equal(node('location-pickup-current').textContent, 'Refresh current pickup');
  view.renderPlanner({ ...state, locatingPickup: true });
  assert.equal(node('location-destination-search').disabled, true);
  assert.equal(node('location-destination-search').textContent, 'Reading your location…');
  view.renderPlanner(state);
  view.renderPlanner({ ...state, service: 'delivery', rideDiscovery: false, target: 'pickup' });
  assert.equal(node('location-pickup-manual').hidden, false);
  assert.equal(node('location-target-pickup').disabled, false);
  assert.equal(node('location-target-pickup').checked, true);
  assert.equal(node('location-destination-search').textContent, 'Search destination');
  assert.equal(node('location-ride-options').children.length, 1);
  assert.match(node('location-book').textContent, /delivery driver/);
  view.renderPlanner(state);
  node('location-pickup-current').fire('click'); assert.equal(actions.pop()[0], 'UsePickup');
  const result = node('location-destination-results').children[0].children[0];
  assert.equal(result.textContent, destination.name); result.fire('click'); assert.deepEqual(actions.pop(), ['Select', 'destination', destination]);
  node('location-destination-query').value = 'Maitama'; node('location-destination-form').fire('submit');
  assert.deepEqual(actions.pop(), ['FindRide', 'destination', 'Maitama']);
  node('location-latitude').value = '9.08'; node('location-longitude').value = '7.4'; node('location-pin-name').value = ' Test pin ';
  node('location-coordinate-form').fire('submit'); assert.deepEqual(actions.pop(), ['Pick', { lat: 9.08, lng: 7.4, name: 'Test pin' }]);
  // The shipped numeric inputs must allow nationwide points before browser validation lets the submit handler run.
  for (const point of [{ lat: 6.6018, lng: 3.3515, name: 'Lagos' }, { lat: 12.0022, lng: 8.592, name: 'Kano' }]) {
    for (const [id, value] of [['location-latitude', point.lat], ['location-longitude', point.lng]]) {
      const input = html.match(new RegExp(`<input\\b[^>]*id="${id}"[^>]*>`))?.[0];
      const minimum = Number(input?.match(/\bmin="([^"]+)"/)?.[1]), maximum = Number(input?.match(/\bmax="([^"]+)"/)?.[1]);
      assert.ok(Number.isFinite(minimum) && Number.isFinite(maximum), `${id} has numeric HTML bounds`);
      assert.ok(value >= minimum && value <= maximum, `${point.name} passes ${id} browser range validation`);
      node(id).value = String(value);
    }
    node('location-pin-name').value = point.name;
    node('location-coordinate-form').fire('submit'); assert.deepEqual(actions.pop(), ['Pick', point]);
  }
  view.renderPlanner({ ...state, expired: true }); assert.equal(node('location-book').disabled, true); assert.match(node('location-expiry').textContent, /expired/);
  view.renderPlanner({ ...state, blocked: true }); assert.equal(node('location-preview').disabled, true); assert.equal(node('location-book').disabled, true);
  view.resetPlanner(); assert.equal(node('location-pickup-selected').textContent, ''); assert.equal(node('location-destination-query').value, ''); assert.equal(node('location-destination-results').children.length, 0);
  assert.equal(descendants(node('planner-map')).filter((n) => n.tag === 'image').length, 0);
});

test('tracking distinguishes last-known GPS and exposes a stop control during permission lookup', (t) => {
  const { node, actions, view } = locationSetup(t);
  view.setOnline(true, settings);
  const state = { user: { role: 'driver', driver: { status: 'approved' } }, ride: { id: 'ride', status: 'booked' },
    supported: true, now: 100000, error: '', pending: true, share: null };
  view.renderTracking(state);
  assert.equal(node('tracking-start').hidden, true); assert.equal(node('tracking-stop').hidden, false);
  node('tracking-stop').fire('click'); assert.equal(actions.pop()[0], 'Stop');
  view.renderTracking({ ...state, pending: false, sharing: true,
    share: { active: true, stale: false, position: { ...pickup, accuracy: 12, capturedAt: 70000 } } });
  assert.match(node('tracking-status').textContent, /Last known location.*30s old/);
  assert.ok(descendants(node('tracking-map')).some((n) => n.attributes.class === 'map-marker map-marker-stale'));
  view.renderTracking({ ...state, pending: false, user: { role: 'customer' } });
  assert.equal(node('tracking-start').hidden, true); assert.equal(node('tracking-stop').hidden, true);
  view.resetTracking(); assert.equal(node('location-tracking').hidden, true);
  assert.equal(descendants(node('tracking-map')).filter((n) => n.tag === 'image').length, 0);
});

test('the driver marker uses the trip vehicle colour only with a reported position, keeps stale state and clears on opt-out', (t) => {
  setup(t); const root = new NodeFixture(), map = createMapView(root);
  const vehicle = { model:'Toyota Corolla',plate:'TEST-123',colour:'Blue' };
  const cars = () => descendants(root).filter((n) => n.tag === 'image' && n.attributes.href.startsWith('/assets/vehicles/'));
  map.render({ enabled:true,tiles,vehicle }); assert.equal(cars().length,0);
  map.render({ enabled:true,tiles,vehicle,driver:NIGERIA_CENTER,stale:true });
  assert.equal(cars().length,1); assert.equal(cars()[0].attributes.href,'/assets/vehicles/sedan-blue.png');
  assert.equal(cars()[0].attributes.opacity,'.55');
  assert.ok(descendants(root).some((n) => n.tag === 'g' && n.attributes.class === 'map-marker map-marker-stale'));
  map.render({ enabled:false,tiles,vehicle,driver:NIGERIA_CENTER }); assert.equal(cars().length,0);
});

test('Kemmy uses the map ETA, prompts after arrival and submits one completed ride rating', (t) => {
  const { node, stars, actions, view } = locationSetup(t);
  const ride = { id: 'ride', status: 'on_way', service: 'ride', pickup, destination,
    driver: { name: 'James', vehicle: { make: 'Toyota', model: 'Camry', colour: 'Black' } },
    route: { pickup, destination, distanceMeters: 7000, durationSeconds: 2400, coordinates: [[7.4,9.08],[7.45,9.1]] }, trip: { startedAt: 100000 }, rating: null };
  const state = { user: { role: 'customer' }, ride, supported: true, now: 100000, error: '', pending: false,
    share: { active: true, stale: false, position: { ...pickup, accuracy: 10, capturedAt: 99000 } } };
  view.renderTracking(state);
  assert.match(node('kemmy-message').textContent, /James.*Black Toyota Camry/);
  assert.match(node('tracking-eta').textContent, /Estimated pickup: about 1 min/);
  view.renderTracking({ ...state, ride: { ...ride, status: 'arrived' } });
  assert.match(node('kemmy-message').textContent, /approximately 40 min/);
  view.renderTracking({ ...state, ride: { ...ride, status: 'completed' } });
  assert.equal(node('kemmy-rating').hidden, false);
  stars[4].fire('click'); node('kemmy-rate').fire('click');
  assert.deepEqual(actions.at(-1), ['Rate', ride.id, 5]);
  view.renderTracking({ ...state, ride: { ...ride, status: 'completed', rating: 5 } });
  assert.equal(node('kemmy-rating').hidden, true);
});
