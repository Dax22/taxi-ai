import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeFoodAddress, normalizeFoodRecipient, normalizeFoodPoint } from '../src/eats-delivery.mjs';
import { createEatsController } from '../src/eats-controller.mjs';
import { readEatsResponse } from '../src/eats-contracts.mjs';
const id = (n) => `00000000-0000-4000-a000-${String(n).padStart(12,'0')}`;
const user = { id: id(1), name: 'Buyer', role: 'customer' };
const address = { line: '10 Test Street, by the gate', areaId: 'wuse-ii', point: { lat: 9.08, lng: 7.49 } };
const recipient = { kind: 'other', name: 'Recipient', phone: '+2348012345678' };
const store = { id: id(2), version: 1, name: 'Test kitchen', cuisine: 'Nigerian', description: 'Kitchen', address: '10 Test Road', areaId: 'wuse-ii', status: 'approved', isOpen: true, prepMinutes: 20, minimumKobo: 0, deliveryFeeKobo: 0 };
const quote = { id: id(4), fulfillment: 'delivery', restaurant: store, address, recipient, instructions: '', lines: [{ itemId: id(3), name: 'Rice', description: 'Rice and stew', priceKobo: 100_000, quantity: 1 }], totals: { subtotalKobo: 100_000, deliveryFeeKobo: 0, serviceFeeKobo: 5_000, totalKobo: 105_000, currency: 'NGN' }, isDemo: true, payment: { method: 'test', status: 'not_charged' }, expiresAt: 100_000 };
const deferred = () => { let resolve; const promise = new Promise((r) => { resolve = r; }); return { resolve, promise }; };
function fixture() {
  let profile = { version: 0, addresses: { home: null, work: null } }; const writes = [], reads = [];
  const api = { async request(path) {
    reads.push(path);
    if (path === '/eats/delivery-profile') return { deliveryProfile: structuredClone(profile), deliverySettings: { tiles: null, attribution: '' } };
    if (path.startsWith('/eats/restaurants/')) return { store, menu: [] };
    if (path.startsWith('/eats/restaurants')) return { restaurants: [store], areas: [] };
    if (path.startsWith('/eats/foods?')) return { foods: [], foodCount: 0, nextOffset: null, area: { id: 'wuse-ii', name: 'Wuse II' } };
    throw new Error(path);
  }, async command(path, data, key) {
    writes.push({ path, data, key });
    if (path === '/eats/delivery-profile') { profile = { version: profile.version + 1, addresses: { ...profile.addresses, [data.label]: data.address } }; return { deliveryProfile: structuredClone(profile) }; }
    if (path === '/eats/delivery-location') return { deliveryLocation: { point: data, line: address.line, areaId: address.areaId, attribution: '' } };
    return { quote: { ...quote, address: data.address, recipient: data.recipient } };
  } };
  let sequence = 0; const c = createEatsController({ api, makeKey: () => `delivery-key-${++sequence}`, now: () => 1000 }); c.context(user);
  return { c, api, writes, reads, setProfile(next) { profile = next; } };
}

test('delivery inputs normalize Nigerian contacts without inferring a home or allowing arbitrary private fields', () => {
  assert.deepEqual(normalizeFoodRecipient({ kind: 'other', name: ' Recipient ', phone: '0801 234 5678' }), recipient);
  assert.deepEqual(normalizeFoodRecipient(undefined, 'Buyer'), { kind: 'self', name: 'Buyer', phone: '' });
  assert.deepEqual(normalizeFoodAddress({ line: address.line, areaId: address.areaId }), { line: address.line, areaId: address.areaId });
  for (const phone of [null, false, 42, '+0bad', '5551234']) assert.throws(() => normalizeFoodRecipient({ kind: 'self', phone }, 'Buyer'));
  assert.throws(() => normalizeFoodAddress({ ...address, userId: id(5) }));
  assert.throws(() => normalizeFoodPoint({ lat: 41.8781, lng: -87.6298 }));
  assert.throws(() => normalizeFoodAddress({ ...address, point: { ...address.point, address: 'secret' } }));
});

test('a recipient destination controls discovery and both recipient and pin reach the quote', async () => {
  const f = fixture(); await f.c.refresh();
  assert.equal(await f.c.confirmDelivery(address, recipient), true); await f.c.selectRestaurant(store.id); await f.c.checkout();
  assert.deepEqual(f.writes.at(-1).data.recipient, recipient); assert.deepEqual(f.writes.at(-1).data.address, address);
  assert.ok(f.reads.some((p) => p.includes('deliveryAreaId=wuse-ii')));
  assert.equal(f.c.snapshot().quote.recipient.name, recipient.name);
  f.c.delivery({ ...address, line: '20 Other Street and landmark', point: { ...address.point } }, '');
  assert.equal(f.c.snapshot().address.point, null); assert.equal(f.c.snapshot().quote, null);
});

test('saving Home is explicit and does not silently change the confirmed destination or existing quote', async () => {
  const f = fixture(); await f.c.refresh(); await f.c.confirmDelivery(address, recipient); await f.c.selectRestaurant(store.id); await f.c.checkout();
  const home = { ...address, line: '30 Private Home address' };
  assert.equal(await f.c.saveDeliveryAddress('home', home), true);
  assert.deepEqual(f.c.snapshot().deliveryProfile.addresses.home, home); assert.deepEqual(f.c.snapshot().address, address);
  assert.deepEqual(f.c.snapshot().quote.address, address);
  await f.c.saveDeliveryAddress('home', null); assert.equal(f.c.snapshot().deliveryProfile.addresses.home, null);
  assert.deepEqual(f.c.snapshot().quote.address, address);
});

test('an uncertain saved-address write freezes edits and retries the same version and key', async () => {
  const f = fixture(); await f.c.refresh(); const original = f.api.command; let lost = true;
  f.api.command = async (...args) => { if (lost) { lost = false; f.writes.push({ path: args[0], data: structuredClone(args[1]), key: args[2] }); throw new Error('lost reply'); } return original(...args); };
  assert.equal(await f.c.saveDeliveryAddress('work', address), false); assert.equal(f.c.snapshot().uncertain, true);
  assert.equal(await f.c.confirmDelivery(address, recipient), false); assert.equal(await f.c.saveDeliveryAddress('home', address), false);
  assert.equal(await f.c.retry(), true); assert.deepEqual(f.writes[0], f.writes[1]);
  assert.deepEqual(f.c.snapshot().deliveryProfile.addresses.work, address);
});

test('late saved addresses and GPS replies cannot populate a replacement account or edited destination', async () => {
  const f = fixture(); await f.c.refresh(); const wait = deferred(); f.api.command = () => wait.promise;
  const locating = f.c.locateDelivery(address.point); f.c.delivery({ ...address, line: 'Changed during location lookup' }, '');
  wait.resolve({ deliveryLocation: { point: address.point, line: address.line, areaId: address.areaId, attribution: '' } });
  assert.equal(await locating, null);
  const pending = deferred(), read = f.api.request; f.api.request = (path) => path === '/eats/delivery-profile' ? pending.promise : read(path);
  const refreshing = f.c.refresh(); f.c.context({ id: id(10), name: 'Another buyer', role: 'customer' });
  pending.resolve({ deliveryProfile: { version: 1, addresses: { home: address, work: null } } }); await refreshing;
  assert.equal(f.c.snapshot().deliveryProfile, null); assert.equal(f.c.snapshot().recipient.name, 'Another buyer');
});

test('saved-address and location failures leave manual Nigerian delivery usable', async () => {
  const f = fixture(), read = f.api.request;
  f.api.request = (path) => path === '/eats/delivery-profile' ? Promise.reject(new Error('Address book offline')) : read(path);
  await f.c.refresh(); assert.equal(f.c.snapshot().stale, false); assert.equal(f.c.snapshot().deliveryProfile, null);
  assert.equal(await f.c.saveDeliveryAddress('home', address), false);
  f.api.command = async () => { throw new Error('Location offline'); };
  await assert.rejects(f.c.locateDelivery(address.point), /offline/); assert.equal(f.c.snapshot().uncertain, false);
  assert.equal(await f.c.confirmDelivery(address, recipient), true);
});

test('delivery response boundaries reject executable map URLs and private data in courier offers', () => {
  assert.throws(() => readEatsResponse({ deliverySettings: { tiles: 'javascript:bad/{z}/{x}/{y}', attribution: '' } }));
  assert.throws(() => readEatsResponse({ deliveryProfile: { version: 0, addresses: { home: address, work: null, anotherUser: address } } }));
  assert.throws(() => readEatsResponse({ deliveryLocation: { point: { lat: 41, lng: -87 }, line: '', areaId: null, attribution: '' } }));
  const work = { current: [], available: [{ id: id(5), version: 0, restaurant: store, deliveryArea: { name: 'Wuse II' }, deliveryFeeKobo: 0, recipient }], online: true, eligible: true, isDemo: true };
  assert.throws(() => readEatsResponse(work));
  const order = { ...quote, status: 'placed', version: 0, role: 'store', actions: [], customerName: user.name, courier: null, events: [], createdAt: 1, updatedAt: 1 };
  assert.throws(() => readEatsResponse({ order }));
  assert.equal(readEatsResponse({ order: { ...order, address: { areaId: address.areaId }, recipient: { kind: 'other', name: recipient.name } } }).order.recipient.name, recipient.name);
});
