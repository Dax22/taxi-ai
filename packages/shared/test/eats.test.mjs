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
