import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createPaymentsController } from '../public/dashboard/payments-controller.mjs';
import { formatPaymentNaira } from '../../../packages/shared/src/payments.mjs';
import { createApiClient } from '../public/dashboard/api-client.mjs';

const customer = { id: 'customer', role: 'customer' }, driver = { id: 'driver', role: 'driver' }, admin = { id: 'admin', role: 'admin' };
const ride = { id: 'ride-one', status: 'completed' };
const unpaid = { rideId: ride.id, status: 'unpaid', version: 0, amountKobo: 470001, completedAt: 1000, attempt: null };
const pending = { ...unpaid, status: 'pending', version: 1, attempt: { id: 'attempt-one', reference: 'SIM-ONE', status: 'pending' } };
const paid = { ...pending, status: 'paid', version: 2, paidAt: 2000, attempt: { ...pending.attempt, status: 'succeeded' } };
const receipt = { reference: 'SIM-ONE', rideId: ride.id, amountKobo: 470001, pickup: '<script>unsafe()</script>', destination: 'Maitama', completedAt: 1000, paidAt: 2000 };
const settings = { mode: 'simulation', canSimulate: true };
const summary = { completedTrips: 1, paidTrips: 1, pendingTrips: 0, failedTrips: 0, unpaidTrips: 0, grossFareKobo: '470001', simulatedPaidKobo: '470001', outstandingKobo: '0' };
const deferred = () => { let resolve; const promise = new Promise((r) => { resolve = r; }); return { promise, resolve }; };
function setup(client) {
  let state;
  const controller = createPaymentsController({ client, view: { render(next) { state = structuredClone(next); } } });
  return { controller, state: () => state };
}

test('payment polling never starts a charge and delayed data cannot cross accounts or selected trips', async () => {
  const wait = deferred(), requests = []; let writes = 0;
  const { controller, state } = setup({ request: (path) => { requests.push(path); return wait.promise; }, command: () => { writes++; } });
  controller.context(customer, ride); const poll = controller.poll();
  controller.context(customer, { id: 'ride-two', status: 'completed' });
  wait.resolve({ payment: paid, settings }); await poll;
  assert.equal(state().payment, null); assert.equal(state().receipt, null);
  assert.equal(writes, 0); assert.equal(requests.length, 1);
  const late = deferred();
  const next = setup({ request: () => late.promise }); next.controller.context(customer, ride);
  const previous = next.controller.poll(); next.controller.context({ id: 'other', role: 'customer' }, ride);
  late.resolve({ payment: paid, settings }); await previous;
  assert.equal(next.state().payment, null); assert.equal(next.state().user.id, 'other');
});

test('receipt responses are discarded after logout, and staged or driver views cannot simulate', async () => {
  const wait = deferred(); let reads = 0, writes = 0;
  const { controller, state } = setup({ request: async () => { reads++; return reads === 1 ? { payment: paid, settings } : wait.promise; }, command: () => { writes++; } });
  controller.context(customer, ride); const poll = controller.poll();
  await Promise.resolve(); controller.reset(); wait.resolve({ receipt }); await poll;
  assert.equal(state().receipt, null); assert.equal(state().user, null);
  const blocked = setup({ request: async () => ({ payment: unpaid, settings: { ...settings, canSimulate: false } }), command: () => { writes++; } });
  blocked.controller.context(customer, ride); await blocked.controller.poll(); await blocked.controller.start(unpaid);
  assert.equal(writes, 0);
  blocked.controller.context(driver, ride); await blocked.controller.poll(); await blocked.controller.start(unpaid);
  assert.equal(writes, 0);
});

test('rapid clicks use one command, preserve the displayed version and reconcile a lost response', async () => {
  let saved = unpaid; const wait = deferred(), commands = [];
  const { controller, state } = setup({ request: async (path) => path.endsWith('/receipt') ? { receipt } : { payment: saved, settings },
    command: async (...args) => { commands.push(args); await wait.promise; saved = pending; throw new Error('Response lost'); } });
  controller.context(customer, ride); await controller.poll();
  const first = controller.start(unpaid); const double = controller.start(unpaid);
  assert.equal(state().busy, true); assert.equal(commands.length, 1);
  wait.resolve(); await Promise.all([first, double]);
  assert.equal(state().payment.status, 'pending'); assert.equal(state().busy, false);
  assert.deepEqual(commands[0], ['/api/payments/rides/ride-one/start', { expectedVersion: 0 }]);
  await controller.start(unpaid); assert.equal(commands.length, 1, 'a stale screen must not replay against a newer version');
});

test('successful commands load the saved receipt; terminal UI state survives polls without further commands', async () => {
  let saved = pending; const commands = [];
  const { controller, state } = setup({ request: async (path) => path.endsWith('/receipt') ? { receipt } : { settings, payment: saved },
    command: async (...args) => { commands.push(args); saved = paid; return { payment: paid, settings }; } });
  controller.context(customer, ride); await controller.poll(); await controller.simulate(pending, 'success');
  assert.deepEqual(commands[0], ['/api/payments/rides/ride-one/attempts/attempt-one/simulate', { expectedVersion: 1, outcome: 'success' }]);
  assert.deepEqual(state().receipt, receipt); await controller.poll(); assert.equal(commands.length, 1);
  controller.context(customer, { ...ride, status: 'cancelled' }); assert.equal(state().receipt, null);
});

test('driver and admin pagination discard stale pages and account changes clear ledger data', async () => {
  const older = deferred(), calls = [];
  const { controller, state } = setup({ request: async (path) => {
    calls.push(path); return path.includes('?') ? older.promise : { summary, payments: [paid], nextBefore: 'ride-one', settings };
  } });
  controller.context(driver, null); await controller.poll();
  assert.equal(state().ledger.summary.grossFareKobo, '470001');
  const oldPage = controller.page('ride-one'); controller.context(admin, null); await controller.poll();
  older.resolve({ payments: [{ ...paid, rideId: 'old-page' }], nextBefore: null }); await oldPage;
  assert.ok(calls.includes('/api/driver/earnings?before=ride-one')); assert.ok(calls.includes('/api/admin/payments'));
  assert.equal(state().ledger.payments[0].rideId, 'ride-one');
  controller.reset(); assert.equal(state().ledger, null);
});

test('payment transport reuses the exact key after 502 or interrupted replies, without changing the outcome', async () => {
  const calls = []; let issued = 0;
  const client = createApiClient({ makeKey: () => `payment-key-${++issued}`, fetchImpl: async (path, options) => {
    calls.push({ path, options });
    if (calls.length === 1) return { ok: false, status: 502, json: async () => ({ error: { code: 'PAYMENT_VERIFICATION_FAILED', message: 'Retry.' } }) };
    if (calls.length === 2) throw new Error('Response lost');
    return { ok: true, status: 200, json: async () => ({ payment: paid }) };
  } });
  client.setCsrf('csrf-value');
  const url = '/api/payments/rides/ride-one/attempts/attempt-one/simulate', data = { expectedVersion: 1, outcome: 'success' };
  await assert.rejects(client.command(url, data)); await assert.rejects(client.command(url, data)); await client.command(url, data);
  assert.equal(new Set(calls.map((item) => item.options.headers['Idempotency-Key'])).size, 1);
  assert.ok(calls.every((item) => item.options.body === JSON.stringify(data) && item.options.headers['X-CSRF-Token'] === 'csrf-value'));
});

const source = (await readFile(new URL('../public/dashboard/payments-view.mjs', import.meta.url), 'utf8'))
  .replace("'./dom.mjs'", `'${new URL('../public/dashboard/dom.mjs', import.meta.url)}'`)
  .replace("'/shared/payments.mjs'", `'${new URL('../../../packages/shared/src/payments.mjs', import.meta.url)}'`);
const { createPaymentsView } = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
class NodeFixture {
  constructor(tag = '') { this.tagName = tag; this.children = []; this.handlers = {}; this.hidden = false; this.textContent = ''; }
  addEventListener(event, fn) { this.handlers[event] = fn; }
  append(...children) { this.children.push(...children); }
  replaceChildren(...children) { this.children = children; }
  fire(event) { this.handlers[event]?.(); }
}
function dom(t) {
  const previous = globalThis.document, nodes = new Map();
  const node = (id) => { if (!nodes.has(id)) nodes.set(id, new NodeFixture()); return nodes.get(id); };
  globalThis.document = { getElementById: node, createElement: (tag) => new NodeFixture(tag) };
  t.after(() => { globalThis.document = previous; }); return node;
}

test('payment presentation preserves exact cents, labels simulations, gates actions and renders receipt text safely', (t) => {
  const node = dom(t), commands = [];
  const view = createPaymentsView({ onStart: (...args) => commands.push(args), onSimulate: (...args) => commands.push(args), onPage() {}, onOpenRide() {}, onPrint() { commands.push('print'); } });
  const base = { user: customer, ride, payment: unpaid, receipt: null, settings, busy: false, ledger: null, before: null, detailError: '', ledgerError: '', message: '' };
  view.render(base); assert.equal(node('payment-amount').textContent, '₦4,700.01'); assert.equal(node('payment-start').hidden, false);
  const displayed = node('payment-start').onclick;
  view.render({ ...base, payment: pending, busy: true }); assert.equal(node('payment-success').disabled, true);
  node('payment-success').onclick(); assert.equal(commands.length, 0);
  displayed(); assert.equal(commands[0][0].version, 0);
  view.render({ ...base, payment: paid, receipt }); assert.equal(node('payment-status').textContent, 'Paid (simulated)');
  assert.equal(node('payment-start').hidden, true); assert.equal(node('payment-outcomes').hidden, true);
  assert.ok(node('receipt-details').children.some((item) => item.tagName === 'dd' && item.textContent === '<script>unsafe()</script>'));
  assert.ok(node('receipt-details').children.every((item) => item.tagName !== 'script'));
  node('receipt-print').fire('click'); assert.equal(commands.at(-1), 'print');
  view.render({ ...base, user: driver, payment: pending }); assert.equal(node('payment-outcomes').hidden, true);
  view.render({ ...base, settings: { ...settings, canSimulate: false } }); assert.equal(node('payment-start').hidden, true);
  view.render({ ...base, user: driver, ledger: { summary, payments: [paid], nextBefore: null } });
  assert.equal(node('earnings-paid').textContent, '₦4,700.01'); assert.equal(node('earnings-panel').hidden, false);
  const renderedRow = node('earnings-list').children[0];
  view.render({ ...base, user: driver, ledger: { summary, payments: [paid], nextBefore: null, serverNow: 5000 } });
  assert.equal(node('earnings-list').children[0], renderedRow, 'unchanged polls must preserve focused row controls');
  view.render({ ...base, user: null, ride: null, payment: null });
  assert.equal(node('earnings-paid').textContent, '—'); assert.equal(node('receipt-details').children.length, 0);
  assert.equal(node('earnings-list').children.length, 0); assert.equal(node('payment-panel').hidden, true);
});

test('lifetime totals retain integer-kobo precision beyond Number.MAX_SAFE_INTEGER', () => {
  assert.equal(formatPaymentNaira('225179981368524775'), '₦2,251,799,813,685,247.75');
  assert.equal(formatPaymentNaira(Number.MAX_SAFE_INTEGER), '₦90,071,992,547,409.91');
  assert.equal(formatPaymentNaira(0), '₦0.00');
  for (const value of [NaN, Infinity, -1, 1.5, Number.MAX_SAFE_INTEGER + 1, '1.5', '-1', '01', null]) assert.throws(() => formatPaymentNaira(value));
});
