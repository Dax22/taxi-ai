import test from 'node:test';
import assert from 'node:assert/strict';
import { eatsTotals, cartQuantity, eatsActions } from '../src/eats.mjs';

test('cart quantities are immutable, bounded and removed at zero', () => {
  const original = [{ itemId: 'rice', quantity: 1 }];
  assert.deepEqual(cartQuantity(original, 'rice', 3), [{ itemId: 'rice', quantity: 3 }]);
  assert.equal(original[0].quantity, 1); assert.deepEqual(cartQuantity(original, 'rice', 0), []);
  for (const n of [-1, 21, 1.5, NaN]) assert.throws(() => cartQuantity(original, 'rice', n));
});
test('food totals use bounded integer money and show the capped service fee separately', () => {
  assert.deepEqual(eatsTotals([{ priceKobo: 250_000, quantity: 2 }], 150_000), { subtotalKobo: 500_000, serviceFeeKobo: 25_000, deliveryFeeKobo: 150_000, totalKobo: 675_000, currency: 'NGN' });
  assert.equal(eatsTotals([{ priceKobo: 5_000_000, quantity: 2 }], 0).serviceFeeKobo, 100_000);
  assert.throws(() => eatsTotals([{ priceKobo: 0.5, quantity: 1 }], 0));
  assert.throws(() => eatsTotals([{ priceKobo: 5_000_000, quantity: 20 }], 0));
  assert.throws(() => eatsTotals([{ priceKobo: 5_000_000, quantity: 4 }], 150_000));
});
test('food action hints follow participant roles and stop at terminal states', () => {
  assert.deepEqual(eatsActions({ status: 'placed' }, 'customer'), ['cancel']);
  assert.deepEqual(eatsActions({ status: 'accepted' }, 'customer'), []);
  assert.deepEqual(eatsActions({ status: 'ready' }, 'store'), []);
  assert.deepEqual(eatsActions({ status: 'assigned' }, 'courier'), ['pickup']);
  for (const role of ['customer', 'store', 'courier', 'admin']) assert.deepEqual(eatsActions({ status: 'delivered' }, role), []);
});

test('home-kitchen discovery respects delivery options, filters, stock labels and customer pickup actions', async () => {
  const { discoverKitchens, foodAvailable, foodStock } = await import('../src/eats.mjs');
  const kitchens = [
    { name: 'Zest', cuisine: 'Nigerian', description: 'Rice', areaId: 'wuse-ii', sellerType: 'home_kitchen', isOpen: true, pickupEnabled: true, deliveryEnabled: false, prepMinutes: 20, deliveryFeeKobo: 0 },
    { name: 'Bistro', cuisine: 'Grills', description: 'Chicken', areaId: 'maitama', isOpen: true, prepMinutes: 30, deliveryFeeKobo: 100 },
    { name: 'Auntie', cuisine: 'Nigerian', description: 'Rice', areaId: 'wuse-ii', sellerType: 'home_kitchen', isOpen: false, pickupEnabled: true, prepMinutes: 10, deliveryFeeKobo: 10 },
  ];
  assert.deepEqual(discoverKitchens(kitchens, { fulfillment: 'pickup', sellerType: 'home_kitchen', openOnly: true }).map((s) => s.name), ['Zest']);
  assert.deepEqual(discoverKitchens(kitchens, { fulfillment: 'delivery' }).map((s) => s.name), ['Bistro', 'Auntie']);
  assert.deepEqual(discoverKitchens(kitchens, { fulfillment: '', q: ' rice ', areaId: 'wuse-ii', sort: 'prep' }).map((s) => s.name), ['Zest', 'Auntie']);
  assert.equal(foodAvailable({ available: true, portionsRemaining: 0 }), false); assert.equal(foodStock({ available: true, portionsRemaining: 3 }), '3 portions left');
  assert.deepEqual(eatsActions({ status: 'ready', fulfillment: 'pickup' }, 'courier'), []);
  assert.deepEqual(eatsActions({ status: 'ready', fulfillment: 'pickup' }, 'store'), ['complete_pickup']);
});
