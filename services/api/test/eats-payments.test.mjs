import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDatabase } from '../src/infrastructure/database.mjs';
import { asAsyncDatabase } from '../src/infrastructure/async-database.mjs';
import { createEatsRepository } from '../src/modules/eats/repository.mjs';
import { createEatsService } from '../src/modules/eats/service.mjs';
import { FOOD_PAYMENT_RESERVATION_MS } from '../src/modules/eats/payments.mjs';
import { deliveryAreas, EATS_LEGACY_AREA_IDS } from '../../../packages/shared/src/eats.mjs';
import { distanceMeters } from '../../../packages/shared/src/locations.mjs';

async function fixture(t, { enabled = true, persistent = false } = {}) {
  const folder = persistent ? await mkdtemp(join(tmpdir(), 'eats-payment-')) : null;
  const filename = folder ? join(folder, 'food.sqlite') : ':memory:';
  let raw = openDatabase(filename), db = asAsyncDatabase(raw), now = Date.UTC(2026, 0, 1), service, repository;
  const accounts = new Map(), closures = [];
  async function user(name, role = 'customer') {
    const account = { id: randomUUID(), name, role, capabilities: role === 'admin' ? [] : ['customer'] };
    await db.prepare('INSERT INTO users(id,email,name,password_hash,role,created_at) VALUES(?,?,?,?,?,?)')
      .run(account.id, `${account.id}@example.test`, name, 'unused', role, now);
    accounts.set(account.id, account); return account;
  }
  function configure(value = enabled) {
    enabled = value;
    repository = createEatsRepository(db, { deliveryAreas, legacyAreaIds: EATS_LEGACY_AREA_IDS, distanceMeters });
    service = createEatsService({ repository, getAccount: async id => accounts.get(id), clock: () => now,
      unitOfWork: work => db.transaction(work), paymentsEnabled: enabled, onPaymentClosed: async value => { closures.push(value); },
      tokens: { id: randomUUID, pickupPin: () => '123456', digest: value => createHash('sha256').update(value).digest('hex'), equal: (a, b) => a === b },
      audit: { record: async () => {} }, availabilityFor: async () => ({ mode: 'sample', areaId: 'wuse-ii' }),
      hasOtherWork: async () => false, onClaim: async () => {} });
  }
  configure();
  t.after(async () => { await db.close(); if (folder) await rm(folder, { recursive: true, force: true }); });
  const customer = await user('Customer'), stranger = await user('Stranger'), admin = await user('Administrator', 'admin'), courier = await user('Courier');
  courier.capabilities.push('driver'); courier.driver = { status: 'approved', eligibility: { eligible: true }, vehicle: { category: 'motorcycle' } };
  const command = (actor, action, id, data, key = randomUUID()) => service.command(actor, action, id, data, key);
  const kitchens = [];
  for (let index = 0; index < 2; index++) {
    const seller = await user(`Seller ${index}`);
    const details = { name: `Payment kitchen ${index}`, cuisine: 'Nigerian', description: 'A test kitchen.', address: '10 Fictional Kitchen Road', areaId: 'wuse-ii', deliveryAreaIds: ['maitama'], prepMinutes: 20, minimumKobo: 0, deliveryFeeKobo: 100_000 };
    let { store } = await command(seller, 'store-create', null, { details });
    const item = { name: 'Jollof rice', description: 'A test portion of rice.', category: 'Meals', priceKobo: 250_000 + index * 100_000, portionsRemaining: 5, available: true };
    let menu;
    ({ store, menu } = await command(seller, 'menu-save', store.id, { expectedVersion: store.version, itemId: null, item }));
    ({ store } = await command(admin, 'store-review', store.id, { expectedVersion: store.version, decision: 'approved', reason: 'Approved fictional kitchen for testing.', reference: 'PAYMENT-TEST' }));
    ({ store } = await command(seller, 'store-open', store.id, { expectedVersion: store.version, isOpen: true }));
    kitchens.push({ seller, store, menu, item });
  }
  async function quote(selected = kitchens, single = false) {
    const groups = [];
    for (const kitchen of selected) {
      const store = await repository.store(kitchen.store.id);
      groups.push({ storeId: store.id, expectedVersion: store.version, items: [{ itemId: kitchen.menu[0].id, quantity: 1 }] });
    }
    const data = { address: { line: '25 Fictional Customer Road', areaId: 'maitama' }, instructions: 'Test only.' };
    return single ? (await command(customer, 'quote', null, { ...groups[0], ...data })).quote
      : (await command(customer, 'meal-quote', null, { groups, ...data })).checkout;
  }
  async function place(single = false, key = randomUUID()) {
    const selected = await quote(single ? [kitchens[0]] : kitchens, single);
    return command(customer, single ? 'place' : 'meal-place', null, { [single ? 'quoteId' : 'checkoutId']: selected.id }, key);
  }
  const paymentRecord = async targetId => ({ id: randomUUID(), ...(await service.paymentContext(customer, targetId)), provider: 'paystack', mode: 'test', reference: 'provider-test-reference', paidAt: now });
  return { customer, stranger, admin, courier, kitchens, closures, command, quote, place, paymentRecord,
    get service() { return service; }, get db() { return db; }, get repository() { return repository; }, get now() { return now; },
    advance: ms => { now += ms; }, configure,
    async restart() { await db.close(); raw = openDatabase(filename); db = asAsyncDatabase(raw); configure(); },
    apply: record => db.transaction(() => service.applyPayment(record)),
    portions: async () => Promise.all(kitchens.map(async kitchen => (await repository.menuItem(kitchen.menu[0].id)).portionsRemaining)),
  };
}

test('single-order payment reserves stock, protects fulfillment and exposes no payer target to sellers', async t => {
  const f = await fixture(t), { order } = await f.place(true), kitchen = f.kitchens[0];
  assert.deepEqual(order.payment, { method: 'paystack', status: 'pending', targetId: order.id, expiresAt: f.now + FOOD_PAYMENT_RESERVATION_MS });
  assert.deepEqual(await f.portions(), [4, 5]);
  const sellerView = (await f.service.order(kitchen.seller, order.id)).order;
  assert.deepEqual(sellerView.payment, { method: 'paystack', status: 'pending' });
  assert.deepEqual(sellerView.actions, ['reject']);
  await assert.rejects(f.command(kitchen.seller, 'accept', order.id, { expectedVersion: order.version }), { code: 'PAYMENT_REQUIRED' });
  await assert.rejects(f.service.paymentContext(f.stranger, order.id), { code: 'NOT_FOUND' });
  await assert.rejects(f.service.paymentContext(kitchen.seller, order.id), { code: 'NOT_FOUND' });
  const record = await f.paymentRecord(order.id);
  assert.equal(record.amountKobo, order.totals.totalKobo);
  assert.deepEqual(await f.apply({ ...record, amountKobo: 1 }), { applied: false });
  assert.deepEqual(await f.apply(record), { applied: true });
  const paid = (await f.service.order(kitchen.seller, order.id)).order;
  assert.deepEqual(paid.payment, { method: 'paystack', status: 'paid' });
  assert.equal(JSON.stringify(paid).includes(record.id), false);
  assert.equal((await f.command(kitchen.seller, 'accept', order.id, { expectedVersion: paid.version })).order.status, 'accepted');
});

test('multi-kitchen checkout has one immutable payment target and idempotent atomic settlement', async t => {
  const f = await fixture(t), checkout = await f.quote(), key = randomUUID(), data = { checkoutId: checkout.id };
  const placed = await f.command(f.customer, 'meal-place', null, data, key);
  assert.equal(placed.payment.targetId, checkout.id);
  assert.ok(placed.orders.every(order => order.payment.targetId === checkout.id));
  assert.deepEqual((await f.command(f.customer, 'meal-place', null, data, key)).orders.map(order => order.id), placed.orders.map(order => order.id));
  await assert.rejects(f.command(f.customer, 'meal-place', null, data), { code: 'QUOTE_USED' });
  await assert.rejects(f.service.paymentContext(f.customer, placed.orders[0].id), { code: 'NOT_FOUND' });
  const record = await f.paymentRecord(checkout.id);
  assert.equal(record.amountKobo, checkout.totals.totalKobo);
  const outcomes = await Promise.all([f.apply(record), f.apply(record)]);
  assert.deepEqual(outcomes, [{ applied: true }, { applied: true }]);
  for (const order of placed.orders) {
    const current = await f.repository.order(order.id);
    assert.equal(current.snapshot.payment.status, 'paid'); assert.equal(current.version, 1);
  }
  assert.deepEqual(await f.portions(), [4, 4]);
});

test('the old single-place route cannot split a Paystack combined checkout and disabled simulation stays compatible', async t => {
  const f = await fixture(t), checkout = await f.quote(), quoteId = checkout.quotes[0].id;
  await assert.rejects(f.command(f.customer, 'place', null, { quoteId }), { code: 'PAYMENT_NOT_READY' });
  assert.equal((await f.db.prepare('SELECT count(*) AS n FROM eats_orders').get()).n, 0);
  assert.equal((await f.repository.quote(quoteId)).orderId, null);
  assert.deepEqual(await f.portions(), [5, 5]);
  const placed = await f.command(f.customer, 'meal-place', null, { checkoutId: checkout.id });
  assert.ok(placed.orders.every(order => order.payment.targetId === checkout.id));

  const legacy = await fixture(t, { enabled: false }), legacyCheckout = await legacy.quote();
  const { order } = await legacy.command(legacy.customer, 'place', null, { quoteId: legacyCheckout.quotes[0].id });
  assert.deepEqual(order.payment, { method: 'test', status: 'not_charged' });
  assert.deepEqual(await legacy.portions(), [4, 5]);
});

test('failure writing one kitchen payment rolls back the whole group', async t => {
  const f = await fixture(t), placed = await f.place(), record = await f.paymentRecord(placed.checkoutId);
  await f.db.exec(`CREATE TRIGGER fail_second_food_payment BEFORE UPDATE ON eats_orders WHEN NEW.id='${placed.orders[1].id}' AND json_extract(NEW.snapshot_json,'$.payment.status')='paid' BEGIN SELECT RAISE(ABORT,'payment fixture failure'); END`);
  await assert.rejects(f.apply(record), /payment fixture failure/);
  for (const order of placed.orders) assert.equal((await f.repository.order(order.id)).snapshot.payment.status, 'pending');
  await f.db.exec('DROP TRIGGER fail_second_food_payment');
  assert.deepEqual(await f.apply(record), { applied: true });
});

test('pending reservations expire durably across restart and never restock twice or fulfill a late payment', async t => {
  const f = await fixture(t, { persistent: true }), placed = await f.place(), record = await f.paymentRecord(placed.checkoutId);
  f.advance(FOOD_PAYMENT_RESERVATION_MS); await f.restart();
  assert.equal((await f.service.paymentContext(f.customer, placed.checkoutId)).eligible, false);
  assert.deepEqual(await f.service.expirePendingPayments(), { expired: 1 });
  assert.deepEqual(await f.service.expirePendingPayments(), { expired: 0 });
  assert.deepEqual(await f.portions(), [5, 5]);
  for (const order of placed.orders) assert.equal((await f.repository.order(order.id)).status, 'cancelled');
  assert.deepEqual(await f.apply(record), { applied: false });
  assert.deepEqual(await f.portions(), [5, 5]);
  for (const order of placed.orders) assert.equal((await f.repository.order(order.id)).snapshot.payment.status, 'refund_required');
});

test('cancelling any unpaid kitchen closes its group and a late payment only records refund review', async t => {
  const f = await fixture(t), placed = await f.place(), record = await f.paymentRecord(placed.checkoutId), first = placed.orders[0];
  await f.command(f.kitchens[0].seller, 'reject', first.id, { expectedVersion: first.version, reason: 'Kitchen is unable to fulfill this order.' });
  assert.deepEqual(await f.portions(), [5, 5]);
  assert.equal((await f.repository.order(placed.orders[1].id)).status, 'cancelled');
  assert.equal(f.closures[0].refundAmountKobo, record.amountKobo);
  assert.deepEqual(await f.apply(record), { applied: false });
  assert.deepEqual(await f.portions(), [5, 5]);
});

test('paid partial cancellation preserves other kitchens and reports the exact cancelled amount', async t => {
  const f = await fixture(t), placed = await f.place(), record = await f.paymentRecord(placed.checkoutId);
  await f.apply(record);
  const first = (await f.service.order(f.customer, placed.orders[0].id)).order;
  await f.command(f.customer, 'cancel', first.id, { expectedVersion: first.version, reason: 'Cancel only the first kitchen order.' });
  assert.equal(f.closures[0].targetId, placed.checkoutId);
  assert.equal(f.closures[0].orderId, first.id);
  assert.equal(f.closures[0].refundAmountKobo, first.totals.totalKobo);
  assert.equal((await f.repository.order(first.id)).snapshot.payment.status, 'refund_required');
  let second = (await f.service.order(f.kitchens[1].seller, placed.orders[1].id)).order;
  assert.equal(second.payment.status, 'paid');
  for (const action of ['accept', 'prepare']) second = (await f.command(f.kitchens[1].seller, action, second.id, { expectedVersion: second.version })).order;
  assert.equal(second.status, 'preparing'); assert.deepEqual(await f.portions(), [5, 4]);
});

test('feature changes preserve legacy demo orders and cannot bypass an already pending payment', async t => {
  const f = await fixture(t, { enabled: false }), { order: demo } = await f.place(true);
  assert.deepEqual(demo.payment, { method: 'test', status: 'not_charged' });
  f.configure(true);
  assert.equal((await f.command(f.kitchens[0].seller, 'accept', demo.id, { expectedVersion: demo.version })).order.status, 'accepted');
  const { order: pending } = await f.place(true); f.configure(false);
  await assert.rejects(f.command(f.kitchens[0].seller, 'accept', pending.id, { expectedVersion: pending.version }), { code: 'PAYMENT_REQUIRED' });
  assert.deepEqual(await f.apply(await f.paymentRecord(pending.id)), { applied: true });
});

test('target-specific expiration commits before a rejected transition and respects replacement stock batches', async t => {
  const f = await fixture(t), { order } = await f.place(true), kitchen = f.kitchens[0];
  const store = await f.repository.store(kitchen.store.id);
  await f.command(kitchen.seller, 'menu-save', store.id, { expectedVersion: store.version, itemId: kitchen.menu[0].id, item: { ...kitchen.item, portionsRemaining: 20 } });
  f.advance(FOOD_PAYMENT_RESERVATION_MS + 1);
  await assert.rejects(f.command(kitchen.seller, 'accept', order.id, { expectedVersion: order.version }), { code: 'STALE_VERSION' });
  assert.equal((await f.repository.order(order.id)).status, 'cancelled');
  assert.deepEqual(await f.portions(), [20, 5]);
  assert.deepEqual(await f.service.expirePendingPayments(), { expired: 0 });
});

test('all fulfillment actions and courier discovery independently require paid metadata', async t => {
  const f = await fixture(t), { order } = await f.place(true), kitchen = f.kitchens[0];
  for (const [status, action, actor] of [['accepted', 'prepare', kitchen.seller], ['preparing', 'ready', kitchen.seller], ['ready', 'claim', f.courier], ['assigned', 'pickup', f.courier], ['picked_up', 'arrive', f.courier], ['arrived', 'deliver', f.courier]]) {
    await f.db.prepare('UPDATE eats_orders SET status=?,courier_id=? WHERE id=?').run(status, ['assigned', 'picked_up', 'arrived'].includes(status) ? f.courier.id : null, order.id);
    await assert.rejects(f.command(actor, action, order.id, { expectedVersion: order.version, ...(['pickup', 'deliver'].includes(action) ? { pin: '123456' } : {}) }), { code: 'PAYMENT_REQUIRED' });
    if (status === 'ready') assert.deepEqual((await f.service.work(f.courier)).available, []);
  }
});

test('closed or ineligible provider records cannot mark a still-pending checkout paid', async t => {
  for (const denied of [{ eligible: false }, { closedAt: Date.UTC(2026, 0, 1) }]) {
    const f = await fixture(t), { order } = await f.place(true), record = await f.paymentRecord(order.id);
    assert.deepEqual(await f.apply({ ...record, ...denied }), { applied: false });
    const closed = await f.repository.order(order.id);
    assert.equal(closed.status, 'cancelled'); assert.equal(closed.snapshot.payment.status, 'refund_required');
    assert.deepEqual(await f.portions(), [5, 5]);
  }
});

test('a kitchen closed or suspended after reservation makes the whole checkout ineligible and late payment refundable', async t => {
  for (const suspended of [false, true]) {
    const f = await fixture(t), placed = await f.place(), record = await f.paymentRecord(placed.checkoutId), kitchen = f.kitchens[1];
    const store = await f.repository.store(kitchen.store.id);
    if (suspended) await f.command(f.admin, 'store-review', store.id, { expectedVersion: store.version, decision: 'suspended', reason: 'Kitchen is temporarily unavailable.', reference: 'PAYMENT-SUSPENDED' });
    else await f.command(kitchen.seller, 'store-open', store.id, { expectedVersion: store.version, isOpen: false });
    assert.equal((await f.service.paymentContext(f.customer, placed.checkoutId)).eligible, false);
    assert.deepEqual(await f.apply(record), { applied: false });
    for (const order of placed.orders) {
      const closed = await f.repository.order(order.id);
      assert.equal(closed.status, 'cancelled'); assert.equal(closed.snapshot.payment.status, 'refund_required');
    }
    assert.deepEqual(await f.portions(), [5, 5]);
  }
});
