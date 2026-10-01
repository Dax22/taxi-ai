import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createPaymentsController } from '../public/dashboard/payments-controller.mjs';
const uri = (value) => `data:text/javascript;base64,${Buffer.from(value).toString('base64')}`;
const shared = (name) => new URL(`../../../packages/shared/src/${name}.mjs`, import.meta.url).href;
const source = (await readFile(new URL('../public/dashboard/checkout-payments.mjs', import.meta.url), 'utf8')).replace("'/shared/checkout-payments.mjs'", JSON.stringify(shared('checkout-payments')));
const { createCheckoutPayments, combineRidePayments, rideCheckoutTarget, foodCheckoutTarget } = await import(uri(source));
const viewSource = (await readFile(new URL('../public/dashboard/checkout-payment-view.mjs', import.meta.url), 'utf8'))
  .replace("'./dom.mjs'", JSON.stringify(new URL('../public/dashboard/dom.mjs', import.meta.url).href))
  .replace("'/shared/payments.mjs'", JSON.stringify(shared('payments'))).replace("'/shared/checkout-payments.mjs'", JSON.stringify(shared('checkout-payments')));
const { createCheckoutPaymentView } = await import(uri(viewSource));
const uuid = (n) => `00000000-0000-4000-a000-${String(n).padStart(12, '0')}`;
const user = { id: uuid(1), role: 'customer' }, target = { kind: 'food', targetId: uuid(2), title: 'Food test checkout', grouped: true };
const settings = { provider: 'paystack', mode: 'test', enabled: true };
const absent = { settings, payment: null, isPayer: true, canStart: true };
const pending = { id: uuid(3), kind: 'food', targetId: uuid(2), status: 'pending', version: 1, amountKobo: 412501, currency: 'NGN', checkoutUrl: 'https://checkout.paystack.com/test-session', reference: 'PAYSTACK-TEST-ONE', refundRequired: false, createdAt: 1000, updatedAt: 1000, paidAt: null, receipt: null };
const saved = (payment, extra = {}) => ({ settings, payment, isPayer: true, canStart: false, ...extra });
const paid = { ...pending, status: 'paid', version: 2, checkoutUrl: null, paidAt: 2000,
  receipt: { provider: 'paystack', mode: 'test', reference: pending.reference, amountKobo: pending.amountKobo, currency: 'NGN', paidAt: 2000, notice: 'PAYSTACK TEST RECEIPT — NO LIVE MONEY MOVED' } };
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const flush = () => new Promise((resolve) => setImmediate(resolve));
function fixture() {
  const f = { calls: [], response: absent, next: 0, state: null };
  f.client = { async request(path, options) { f.calls.push({ path, options }); return options?.method === 'POST' ? saved(pending) : f.response; } };
  f.c = createCheckoutPayments({ client: f.client, view: { render(state) { f.state = structuredClone(state); } }, makeKey: () => `checkout-key-${++f.next}` });
  f.c.context(user, target); return f;
}

test('checkout reads never charge; rapid start clicks produce one immutable versioned request and then an explicit hosted link', async () => {
  const f = fixture(); await f.c.poll(); assert.equal(f.calls.length, 1); assert.equal(f.calls[0].options, undefined);
  const late = deferred(); f.client.request = async (path, options) => { f.calls.push({ path, options }); return late.promise; };
  const first = f.c.start(0); const second = f.c.start(0); assert.equal(f.calls.length, 2); assert.equal(f.state.busy, true);
  late.resolve(saved(pending)); await Promise.all([first, second]);
  assert.deepEqual(f.calls[1], { path: `/api/checkout-payments/food/${target.targetId}/start`, options: { method: 'POST', data: { expectedVersion: 0 }, key: 'checkout-key-1' } });
  assert.equal(f.state.payment.checkoutUrl, pending.checkoutUrl); assert.equal(f.state.payment.status, 'pending');
  await f.c.start(1); assert.equal(f.calls.length, 2, 'an existing intent never starts another charge');
});

test('an interrupted start freezes new actions and retries the exact key, target and displayed version', async () => {
  const f = fixture(); await f.c.poll(); let attempts = 0;
  f.client.request = async (path, options) => { f.calls.push({ path, options }); if (!attempts++) throw new Error('Lost reply'); return saved(pending); };
  await f.c.start(0); assert.equal(f.state.uncertain, true);
  await f.c.start(0); await f.c.refresh(0); assert.equal(f.calls.length, 2);
  await f.c.retry(); assert.deepEqual(f.calls[1], f.calls[2]); assert.equal(f.state.uncertain, false); assert.equal(f.state.payment.status, 'pending');
});

test('Check payment verifies the existing intent; stale UI versions, nonpayers and failed intents cannot start a new charge', async () => {
  const f = fixture(); f.response = saved(pending); await f.c.poll();
  await f.c.refresh(0); assert.equal(f.calls.length, 1);
  f.client.request = async (path, options) => { f.calls.push({ path, options }); return saved(paid); };
  await f.c.refresh(1); assert.equal(f.state.payment.status, 'paid'); assert.match(f.calls.at(-1).path, /\/refresh$/);
  f.response = saved({ ...pending, status: 'failed', checkoutUrl: null });
  const g = fixture(); g.response = f.response; await g.c.poll(); await g.c.start(1); assert.equal(g.calls.length, 1);
  g.response = saved({ ...pending, checkoutUrl: null, reference: null }, { isPayer: false }); await g.c.poll(); await g.c.refresh(1); assert.equal(g.calls.length, 2);
});

test('late payment responses and private checkout URLs cannot cross accounts or selected targets', async () => {
  const f = fixture(), late = deferred(); f.client.request = () => late.promise; const read = f.c.poll();
  f.c.context({ id: uuid(9), role: 'customer' }, target); late.resolve(saved(paid)); await read;
  assert.equal(f.state.payment, null); assert.equal(f.state.user.id, uuid(9));
  const g = fixture(); await g.c.poll(); const write = deferred(); g.client.request = () => write.promise; const start = g.c.start(0);
  g.c.reset(); g.c.context(user, { ...target, targetId: uuid(8) }); write.resolve(saved(pending)); await start;
  assert.equal(g.state.payment, null); assert.equal(g.state.uncertain, false);
});

test('returning to a target during its pending write unlocks after reconciliation without applying stale UI data', async () => {
  const f = fixture(); await f.c.poll(); const late = deferred(); let write = true;
  f.client.request = async () => { if (write) { write = false; return late.promise; } return saved(pending); };
  const start = f.c.start(0); f.c.context(user, null); f.c.context(user, target); assert.equal(f.state.busy, true);
  late.resolve(saved(pending)); await start; await flush(); assert.equal(f.state.busy, false); assert.equal(f.state.payment.status, 'pending');
});

test('malformed target or unsafe checkout responses are rejected and cannot unlock payment actions', async () => {
  const f = fixture(); f.response = saved({ ...pending, checkoutUrl: 'https://checkout.paystack.com.evil.test/payment' }); await f.c.poll();
  assert.equal(f.state.payment, null); assert.match(f.state.error, /incompatible/); await f.c.start(0); assert.equal(f.calls.length, 1);
  f.response = saved({ ...pending, targetId: uuid(88) }); await f.c.poll(); assert.equal(f.state.payment, null);
});

test('ride simulator remains available only for disabled legacy targets without a historical Paystack intent', async () => {
  const f = fixture(); let simState, legacyReads = 0;
  const simulation = createPaymentsController({ client: { async request() { legacyReads++; return { settings: { canSimulate: true }, payment: null }; } }, view: { render(state) { simState = { ...state }; } } });
  const payments = combineRidePayments({ simulation, checkout: f.c });
  const ride = { id: uuid(2), status: 'completed' }; payments.context(user, ride);
  assert.equal(simState.hostedCheckout, true);
  f.response = { ...absent, canStart: false, settings: { ...settings, enabled: false } }; await payments.poll(); assert.equal(legacyReads, 1); assert.equal(simState.hostedCheckout, false);
  f.response = saved({ ...paid, kind: 'ride' }, { settings: { ...settings, enabled: false } }); await payments.poll(); assert.equal(simState.hostedCheckout, true); assert.equal(legacyReads, 1);
  assert.equal(rideCheckoutTarget(user, { ...ride, status: 'booked', delivery: {} }).title, 'Courier test checkout');
  assert.equal(rideCheckoutTarget(user, { ...ride, status: 'cancelled', trip: null }), null, 'An unbooked cancellation has no payable trip.');
  assert.equal(rideCheckoutTarget(user, { ...ride, status: 'cancelled', trip: { paymentMode: 'paystack_test' } }).targetId, ride.id, 'Cancelled booked payments remain reviewable.');
});

test('food targets preserve one combined checkout and never expose seller, courier or legacy payment actions', () => {
  const order = { id: uuid(5), role: 'customer', payment: { method: 'paystack', targetId: uuid(2), status: 'pending' } };
  assert.deepEqual(foodCheckoutTarget(user, order), target);
  for (const role of ['store', 'courier', 'admin']) assert.equal(foodCheckoutTarget(user, { ...order, role }), null);
  assert.equal(foodCheckoutTarget(user, { ...order, payment: { method: 'test', status: 'not_charged' } }), null);
});

class Node {
  constructor(tag = 'div') { this.tag = tag; }
  children = []; handlers = {}; textContent = ''; hidden = false; disabled = false;
  append(...nodes) { this.children.push(...nodes); }
  addEventListener(type, handler) { this.handlers[type] = handler; }
  setAttribute(name, value) { this[name] = value; }
  removeAttribute(name) { delete this[name]; }
}
function viewFixture(t) {
  const previous = globalThis.document; globalThis.document = { createElement: (tag) => new Node(tag) }; t.after(() => { globalThis.document = previous; });
  const root = new Node(), actions = [], view = createCheckoutPaymentView(root, Object.fromEntries(['Start', 'Refresh', 'Retry', 'Reload'].map((name) => [`on${name}`, (...args) => actions.push([name, ...args])])));
  const all = (node) => [node, ...node.children.flatMap(all)];
  return { root, view, actions, node: (text) => all(root).find((node) => node.textContent === text), all: () => all(root) };
}
const state = { user, target, ...saved(pending), busy: false, loaded: true, loading: false, uncertain: false, error: '' };

test('payment UI shows server amount, explicit protected new-tab checkout, combined-order guidance and server-only verification', (t) => {
  const f = viewFixture(t); f.view.render(state);
  assert.ok(f.node('Server total · ₦4,125.01')); assert.ok(f.all().some((n) => /Pay once/.test(n.textContent)));
  const link = f.node('Open Paystack test checkout ↗'); assert.equal(link.href, pending.checkoutUrl); assert.equal(link.target, '_blank'); assert.equal(link.rel, 'noopener noreferrer');
  f.node('Check payment').handlers.click(); assert.deepEqual(f.actions, [['Refresh', 1]]);
  f.view.render({ ...state, payment: { ...pending, status: 'unknown', checkoutUrl: null } }); assert.equal(link.hidden, true); assert.equal(link.href, undefined); assert.ok(f.all().some((n) => /Do not pay again/.test(n.textContent)));
  f.view.render({ ...state, payment: paid }); assert.ok(f.all().some((n) => /server verified/.test(n.textContent))); assert.ok(f.all().some((n) => /PAYSTACK TEST RECEIPT/.test(n.textContent)));
  f.view.render({ ...state, payment: { ...paid, status: 'refund_required', refundRequired: true } }); assert.ok(f.all().some((n) => /has not been completed automatically/.test(n.textContent)));
  f.view.render({ ...state, user: null, target: null, payment: null }); assert.equal(f.root.hidden, true); assert.equal(link.href, undefined);
  let prevented = false; link.handlers.click({ preventDefault() { prevented = true; } }); assert.equal(prevented, true);
});

test('payment UI hides malformed checkout links, freezes uncertain actions and preserves historical disabled receipts', (t) => {
  const f = viewFixture(t); f.view.render({ ...state, payment: { ...pending, checkoutUrl: 'javascript:alert(1)' } }); assert.equal(f.node('Open Paystack test checkout ↗').hidden, true);
  f.view.render({ ...state, uncertain: true }); assert.equal(f.node('Check payment').hidden, true); assert.equal(f.node('Retry the same payment action').hidden, false);
  f.view.render({ ...state, settings: { ...settings, enabled: false }, payment: paid }); assert.equal(f.root.hidden, false);
  f.view.render({ ...state, settings: { ...settings, enabled: false }, payment: null }); assert.equal(f.root.hidden, true);
});

test('hosted return page is neutral, has no query-driven script and directs users to authenticated verification', async () => {
  const html = await readFile(new URL('../public/payment-return.html', import.meta.url), 'utf8');
  assert.match(html, /This page does not confirm payment/); assert.match(html, /Check payment/); assert.match(html, /No real money/);
  assert.doesNotMatch(html, /<script|URLSearchParams|transaction_status/i);
});

test('a definitive stale-version failure after navigation cannot leave that target locked in an uncertain retry', async () => {
  const f = fixture(); await f.c.poll(); const late = deferred(); let writing = true;
  f.client.request = async () => { if (writing) { writing = false; return late.promise; } return saved(pending); };
  const start = f.c.start(0); f.c.context(user, { ...target, targetId: uuid(8) }); f.c.context(user, target);
  late.reject(Object.assign(new Error('Payment changed'), { status: 409, code: 'STALE_VERSION' })); await start; await flush();
  assert.equal(f.state.busy, false); assert.equal(f.state.uncertain, false); assert.equal(f.state.payment.version, 1);
});

test('shipped pages contain payment roots and imports, and dashboard busy updates leave their controls to the payment controller', async () => {
  const [dashboard, eats, entry, foodEntry, views, server] = await Promise.all([
    readFile(new URL('../public/dashboard.html', import.meta.url), 'utf8'), readFile(new URL('../public/eats.html', import.meta.url), 'utf8'),
    readFile(new URL('../public/dashboard.mjs', import.meta.url), 'utf8'), readFile(new URL('../public/eats.mjs', import.meta.url), 'utf8'),
    readFile(new URL('../public/dashboard/views.mjs', import.meta.url), 'utf8'), readFile(new URL('../server.mjs', import.meta.url), 'utf8')]);
  assert.equal((dashboard.match(/id="checkout-payment-panel"/g) ?? []).length, 1); assert.equal((eats.match(/id="food-checkout-payment"/g) ?? []).length, 1);
  assert.match(entry, /createCheckoutPaymentView\(\$\('checkout-payment-panel'\)/); assert.match(foodEntry, /createCheckoutPaymentView\(document\.getElementById\('food-checkout-payment'\)/);
  assert.match(views, /#checkout-payment-panel/);
  for (const path of ['/dashboard/checkout-payments.mjs', '/dashboard/checkout-payment-view.mjs', '/shared/checkout-payments.mjs', '/payment-return']) assert.ok(server.includes(path), path);
});
