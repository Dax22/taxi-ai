import test from 'node:test';
import assert from 'node:assert/strict';
import { matchMeals, mealQuantity, mealGroups, mealTotals } from '../src/eats-meals.mjs';

test('meal search matches actual listed dishes across a multi-food request and ranks stronger matches first', () => {
  const option = (id, name, priceKobo) => ({ store: { id: 'k-' + id, name: 'Kitchen ' + id }, item: { id, name, priceKobo, description: 'Listed ingredients.', category: 'Meals' } });
  const foods = [option('a', 'Fried plantain', 100_000), option('b', 'Jollof rice and chicken', 300_000), option('c', 'Egusi soup', 200_000)];
  assert.deepEqual(matchMeals(foods, 'I would like jollof rice, chicken and plantain please').map((f) => f.item.id), ['b', 'a']);
  assert.deepEqual(matchMeals(foods, 'pizza'), []);
  assert.equal(matchMeals(foods, '').length, 3);
});

test('mixed baskets keep dishes from different kitchens, group quantities and enforce bounded order size', () => {
  const food = (id, storeId = id, version = 1) => ({ store: { id: storeId, version }, item: { id } });
  let basket = mealQuantity([], food('a', 'one'), 1); basket = mealQuantity(basket, food('b', 'two'), 2); basket = mealQuantity(basket, food('c', 'one', 2), 3);
  assert.deepEqual(mealGroups(basket), [{ storeId: 'one', expectedVersion: 2, items: [{ itemId: 'a', quantity: 1 }, { itemId: 'c', quantity: 3 }] }, { storeId: 'two', expectedVersion: 1, items: [{ itemId: 'b', quantity: 2 }] }]);
  assert.equal(mealQuantity(basket, food('b', 'two'), 0).length, 2);
  assert.throws(() => mealQuantity(basket, food('a'), 21));
  for (const id of ['three', 'four', 'five']) basket = mealQuantity(basket, food(id), 1);
  assert.throws(() => mealQuantity(basket, food('six'), 1));
  const totals = { subtotalKobo: 10_000_000, deliveryFeeKobo: 100_000, serviceFeeKobo: 100_000, totalKobo: 10_200_000 };
  assert.throws(() => mealTotals([{ totals }, { totals }]), /200,000/);
});
