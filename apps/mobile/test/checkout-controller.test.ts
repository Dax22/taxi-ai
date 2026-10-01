import test from 'node:test';
import assert from 'node:assert/strict';
import { CheckoutPaymentController } from '../src/payments/checkout-controller.ts';
import { showJourneyCheckout } from '../src/payments/checkout-eligibility.ts';
import type { CheckoutPaymentDetail, CheckoutPayment } from '../../../packages/shared/src/checkout-payments.mjs';
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const tick = () => new Promise<void>(resolve => setImmediate(resolve));
function deferred<T>() { let resolve!: (value: T) => void; let reject!: (error: unknown) => void; const promise = new Promise<T>((ok, no) => { resolve = ok; reject = no; }); return { promise, resolve, reject }; }
const payment: CheckoutPayment = { id: id(2), kind: 'food', targetId: id(1), status: 'pending', amountKobo: 125000, currency: 'NGN', version: 1,
  checkoutUrl: 'https://checkout.paystack.com/test-example', reference: 'taxiai_test_example', refundRequired: false,
  createdAt: 1000, updatedAt: 1000, paidAt: null, receipt: null };
const detail = (value: CheckoutPayment | null = null): CheckoutPaymentDetail => ({ settings: { provider: 'paystack', mode: 'test', enabled: true }, payment: value, isPayer: true, canStart: value === null });
test('cancelled requests expose checkout only when a confirmed trip payment mode was projected', () => {
  for (const status of ['requested', 'negotiating', 'agreed', 'cancelled', 'expired']) assert.equal(showJourneyCheckout({ status }), false);
  for (const paymentMode of ['simulation', 'paystack_test'] as const) assert.equal(showJourneyCheckout({ status: 'cancelled', paymentMode }), true);
  for (const status of ['booked', 'on_way', 'arrived', 'in_progress', 'completed']) assert.equal(showJourneyCheckout({ status }), true);
});
function fixture() {
  const calls: unknown[][] = [];
  const f = { next: detail(), read: null as null | (() => Promise<CheckoutPaymentDetail>), command: null as null | (() => Promise<CheckoutPaymentDetail>), calls, reads: 0, keys: 0 };
  const api = { checkoutPayment: async (...args: unknown[]) => { f.reads++; calls.push(['read', ...args]); return f.read ? f.read() : structuredClone(f.next); },
    checkoutPaymentCommand: async (...args: unknown[]) => { calls.push(['write', ...args]); return f.command ? f.command() : structuredClone(f.next); } };
  const c = new CheckoutPaymentController(api, 'food', id(1), () => `command-key-${++f.keys}`);
  return { f, c };
}

test('checkout starts only after explicit consent, suppresses duplicate taps and pins the absent-record version', async () => {
  const { f, c } = fixture(); c.activate(); await tick();
  assert.equal(f.calls.filter(v => v[0] === 'write').length, 0);
  const wait = deferred<CheckoutPaymentDetail>(); f.command = () => wait.promise;
  const starting = c.act('start'); await c.act('start'); await c.act('refresh');
  assert.deepEqual(f.calls.at(-1), ['write', 'food', id(1), 'start', 0, 'command-key-1']);
  assert.equal(f.keys, 1); assert.equal(c.checkoutUrl(), null);
  wait.resolve(detail(payment)); await starting;
  assert.equal(c.checkoutUrl(), payment.checkoutUrl); assert.equal(c.snapshot().detail?.payment?.status, 'pending');
});
test('an interrupted write drops private links and retries the same action, version and key without another attempt', async () => {
  const { f, c } = fixture(); c.activate(); await tick();
  f.command = async () => { throw new Error('response lost'); };
  await c.act('start'); assert.equal(c.snapshot().uncertain, true); assert.equal(c.snapshot().detail, null);
  const first = f.calls.at(-1); const before = f.calls.length;
  await c.load(); await c.act('start'); assert.equal(f.calls.length, before);
  f.command = async () => detail(payment); await c.retry();
  assert.deepEqual(f.calls.at(-1), first); assert.equal(f.keys, 1); assert.equal(c.snapshot().uncertain, false);
});
test('returning from checkout reloads server state but never runs verification or infers success', async () => {
  const { f, c } = fixture(); f.next = detail(payment); c.activate(); await tick();
  c.markCheckoutOpened(); c.pause(); assert.equal(c.checkoutUrl(), null); assert.equal(c.snapshot().detail, null);
  c.activate(); await tick(); assert.equal(c.snapshot().returned, true); assert.equal(c.snapshot().detail?.payment?.status, 'pending');
  assert.equal(f.calls.filter(v => v[0] === 'write').length, 0);
  f.next = detail({ ...payment, status: 'paid', checkoutUrl: null, paidAt: 3000 });
  await c.act('refresh'); assert.deepEqual(f.calls.at(-1), ['write', 'food', id(1), 'refresh', 1, 'command-key-1']);
  assert.equal(c.snapshot().detail?.payment?.status, 'paid'); assert.equal(c.snapshot().returned, false); assert.equal(c.checkoutUrl(), null);
});
test('backgrounding during a write retains exact retry consent and cannot restore a checkout link from a late response', async () => {
  const { f, c } = fixture(); c.activate(); await tick();
  const wait = deferred<CheckoutPaymentDetail>(); f.command = () => wait.promise;
  const starting = c.act('start'); c.pause(); wait.resolve(detail(payment)); await starting;
  assert.equal(c.snapshot().detail, null); assert.equal(c.checkoutUrl(), null);
  c.activate(); await tick(); assert.equal(c.snapshot().uncertain, true);
  f.command = async () => detail(payment); await c.retry();
  const writes = f.calls.filter(v => v[0] === 'write'); assert.deepEqual(writes[0], writes[1]); assert.equal(c.checkoutUrl(), payment.checkoutUrl);
});
test('disposed accounts cannot receive late reads, writes, receipts or links', async () => {
  for (const action of ['read', 'write']) {
    const { f, c } = fixture(), wait = deferred<CheckoutPaymentDetail>();
    if (action === 'read') { f.read = () => wait.promise; c.activate(); }
    else { c.activate(); await tick(); f.command = () => wait.promise; void c.act('start'); }
    c.dispose(); wait.resolve(detail(payment)); await tick();
    assert.equal(c.snapshot().detail, null); assert.equal(c.snapshot().uncertain, false); assert.equal(c.checkoutUrl(), null);
    const before = f.calls.length; c.activate(); await c.retry(); await c.act('start'); assert.equal(f.calls.length, before);
  }
});
test('version conflicts require a new reviewed snapshot and never replay a different version under an old key', async () => {
  const { f, c } = fixture(); f.next = detail(payment); c.activate(); await tick();
  f.next = detail({ ...payment, version: 5 }); f.command = async () => { throw Object.assign(new Error('Payment changed. Review again.'), { status: 409 }); };
  await c.act('refresh'); await tick(); assert.equal(c.snapshot().uncertain, false); assert.equal(c.snapshot().detail?.payment?.version, 5);
  assert.match(c.snapshot().error, /Review/); f.command = async () => f.next; await c.act('refresh');
  assert.deepEqual(f.calls.filter(v => v[0] === 'write').map(v => v.slice(3)), [['refresh', 1, 'command-key-1'], ['refresh', 5, 'command-key-2']]);
});
test('read failures remove old secrets; nonpayers cannot open checkout, but rollout pause preserves an existing payer session', async () => {
  const { f, c } = fixture(); f.next = detail(payment); c.activate(); await tick();
  f.read = async () => { throw new Error('offline'); }; await c.load(); assert.equal(c.checkoutUrl(), null); assert.equal(c.snapshot().detail, null);
  f.read = null; f.next = { ...detail(payment), isPayer: false }; await c.load(); await c.act('refresh'); assert.equal(c.checkoutUrl(), null); assert.equal(f.keys, 0);
  f.next = { ...detail(payment), settings: { provider: 'paystack', mode: 'test', enabled: false } }; await c.load();
  assert.equal(c.checkoutUrl(), payment.checkoutUrl); assert.equal(c.snapshot().detail?.payment?.reference, payment.reference);
  await c.act('start'); assert.equal(f.keys, 0);
  await c.act('refresh'); assert.equal(f.keys, 1);
});
