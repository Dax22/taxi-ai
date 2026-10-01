import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { harness, participants } from './helpers.mjs';
import { readEatsResponse } from '../../../packages/shared/src/eats-contracts.mjs';

async function ok(client, path, data, key) {
  const result = data === undefined ? await client.send(path) : await client.post(path, data, key);
  assert.equal(result.status, 200, JSON.stringify(result.body));
  return path.startsWith('/api/eats') ? readEatsResponse(result.body) : result.body;
}
async function fixture(t) {
  const initializations = [], transactions = new Map();
  const paystackProvider = { enabled: true, configured: true,
    async initialize(value) { initializations.push(value); transactions.set(value.reference, value); return { reference: value.reference, checkoutUrl: 'https://checkout.paystack.com/food-test' }; },
    async verify(reference) { const transaction = transactions.get(reference); return { reference, amountKobo: transaction.amountKobo,
      currency: 'NGN', domain: 'test', status: 'success', transactionId: reference }; } };
  const h = await harness(t, { persistent: true, paystackProvider }), people = await participants(h), kitchens = [];
  for (let index = 0; index < 2; index++) {
    const seller = h.client(); await seller.register(`payment-kitchen-${index}`);
    const details = { name: `HTTP payment kitchen ${index}`, cuisine: 'Nigerian', description: 'Fictional payment test kitchen.',
      address: '10 Fictional Kitchen Road', areaId: 'wuse-ii', deliveryAreaIds: ['maitama'], prepMinutes: 20, minimumKobo: 0, deliveryFeeKobo: 100_000 };
    let { store } = await ok(seller, '/api/eats/stores', { details });
    let menu;
    ({ store, menu } = await ok(seller, `/api/eats/stores/${store.id}/menu`, { expectedVersion: store.version, itemId: null,
      item: { name: 'Jollof rice', description: 'Fictional rice portion.', category: 'Meals', priceKobo: 200_000 + index * 100_000, available: true, portionsRemaining: 5 } }));
    ({ store } = await ok(people.admin, `/api/eats/stores/${store.id}/review`, { expectedVersion: store.version, decision: 'approved', reason: 'Approve fictional kitchen for payment testing.', reference: 'FOOD-PAYMENT-HTTP' }));
    ({ store } = await ok(seller, `/api/eats/stores/${store.id}/open`, { expectedVersion: store.version, isOpen: true }));
    kitchens.push({ seller, store, menu });
  }
  const { checkout } = await ok(people.customer, '/api/eats/checkouts', {
    groups: kitchens.map(({ store, menu }) => ({ storeId: store.id, expectedVersion: store.version, items: [{ itemId: menu[0].id, quantity: 1 }] })),
    address: { line: '25 Fictional Customer Road', areaId: 'maitama' }, instructions: 'No real delivery.' });
  const placed = await ok(people.customer, '/api/eats/checkouts/place', { checkoutId: checkout.id });
  return { h, ...people, kitchens, checkout, placed, initializations, path: `/api/checkout-payments/food/${checkout.id}` };
}

test('real food HTTP checkout makes one verified charge for all kitchens, with protected actions and exact partial refund review', async t => {
  const f = await fixture(t), first = f.placed.orders[0];
  assert.ok(f.placed.orders.every(order => order.payment.status === 'pending' && order.payment.targetId === f.checkout.id));
  assert.equal((await f.kitchens[0].seller.post(`/api/eats/orders/${first.id}/accept`, { expectedVersion: first.version })).status, 409);
  const available = await ok(f.customer, f.path); assert.equal(available.canStart, true); assert.equal(available.payment, null);
  assert.equal((await f.kitchens[0].seller.send(f.path)).status, 404);
  assert.equal((await f.customer.send(`/api/checkout-payments/food/${first.id}`)).status, 404);
  assert.equal((await f.customer.send(`${f.path}/start`, { method: 'POST', data: { expectedVersion: 0 }, headers: { 'Idempotency-Key': randomUUID(), 'X-CSRF-Token': null } })).status, 403);
  assert.equal((await f.customer.post(`${f.path}/start`, { expectedVersion: 0, amountKobo: 1 })).status, 400);
  const key = randomUUID(), started = await ok(f.customer, `${f.path}/start`, { expectedVersion: 0 }, key);
  assert.equal(started.payment.status, 'pending'); assert.equal(started.payment.amountKobo, f.checkout.totals.totalKobo);
  assert.equal((await ok(f.customer, `${f.path}/start`, { expectedVersion: 0 }, key)).replayed, true);
  assert.equal(f.initializations.length, 1); assert.equal(f.initializations[0].amountKobo, f.checkout.totals.totalKobo);
  await f.h.restart();
  const paid = await ok(f.customer, `${f.path}/refresh`, { expectedVersion: started.payment.version });
  assert.equal(paid.payment.status, 'paid'); assert.equal(paid.payment.receipt.notice, 'PAYSTACK TEST RECEIPT — NO LIVE MONEY MOVED');
  for (const order of f.placed.orders) assert.equal((await ok(f.customer, `/api/eats/orders/${order.id}`)).order.payment.status, 'paid');
  assert.equal(f.h.db.prepare('SELECT count(*) AS n FROM checkout_payments').get().n, 1);
  const customerOrder = (await ok(f.customer, `/api/eats/orders/${first.id}`)).order;
  await ok(f.customer, `/api/eats/orders/${first.id}/cancel`, { expectedVersion: customerOrder.version, reason: 'Cancel only this paid kitchen order.' });
  const refund = await ok(f.customer, f.path);
  assert.equal(refund.payment.status, 'refund_required'); assert.equal(refund.payment.refundAmountKobo, first.totals.totalKobo);
  let sibling = (await ok(f.kitchens[1].seller, `/api/eats/orders/${f.placed.orders[1].id}`)).order;
  assert.deepEqual(sibling.payment, { method: 'paystack', status: 'paid' });
  for (const action of ['accept', 'prepare']) sibling = (await ok(f.kitchens[1].seller, `/api/eats/orders/${sibling.id}/${action}`, { expectedVersion: sibling.version })).order;
  assert.equal(sibling.status, 'preparing');
});

test('real HTTP late food payment cannot revive a cancelled checkout or consume inventory twice', async t => {
  const f = await fixture(t), first = f.placed.orders[0];
  await ok(f.customer, `${f.path}/start`, { expectedVersion: 0 });
  await ok(f.customer, `/api/eats/orders/${first.id}/cancel`, { expectedVersion: first.version, reason: 'Cancel this unpaid meal checkout.' });
  const closed = await ok(f.customer, f.path);
  assert.equal(closed.canStart, false); assert.equal(closed.payment.checkoutUrl, null);
  const late = await ok(f.customer, `${f.path}/refresh`, { expectedVersion: closed.payment.version });
  assert.equal(late.payment.status, 'refund_required'); assert.equal(late.payment.refundAmountKobo, f.checkout.totals.totalKobo);
  for (const [index, order] of f.placed.orders.entries()) {
    const current = (await ok(f.customer, `/api/eats/orders/${order.id}`)).order;
    assert.equal(current.status, 'cancelled'); assert.equal(current.payment.status, 'refund_required');
    assert.equal((await ok(f.kitchens[index].seller, '/api/eats/store')).menu[0].portionsRemaining, 5);
  }
  assert.equal(f.initializations.length, 1);
});
