import test from 'node:test';
import assert from 'node:assert/strict';
import { readCheckoutPaymentResponse, safeCheckoutUrl } from '../src/checkout-payments.mjs';
const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const expected = { kind: 'food', targetId: id(1) };
const settings = { provider: 'paystack', mode: 'test', enabled: true, walletStrategy: 'paystack_hosted', walletCandidates: ['apple_pay','google_pay'], walletAvailability: 'provider_device_eligibility' };
const payment = { id: id(2), ...expected, status: 'pending', amountKobo: 125000, currency: 'NGN', providerMode: 'test', version: 1,
  checkoutUrl: 'https://checkout.paystack.com/test-example', reference: 'taxiai_test_example', refundRequired: false,
  createdAt: 1000, updatedAt: 1000, paidAt: null, receipt: null };
const response = p => ({ settings, payment: p, canStart: false, isPayer: true });
const paid = { ...payment, status: 'paid', checkoutUrl: null, version: 2, paidAt: 2000,
  receipt: { reference: payment.reference, amountKobo: payment.amountKobo, currency: 'NGN', paidAt: 2000,
    provider: 'paystack', mode: 'test', notice: 'PAYSTACK TEST RECEIPT — NO LIVE MONEY MOVED' } };

test('checkout URL accepts only exact Paystack HTTPS checkout links without credentials or fragments', () => {
  assert.equal(safeCheckoutUrl(payment.checkoutUrl), payment.checkoutUrl);
  for (const value of [null, '', 'https://checkout.paystack.com/', 'http://checkout.paystack.com/test',
    'https://checkout.paystack.com.evil.test/test', 'https://evil.test/checkout.paystack.com', 'https://checkout.paystack.com:444/test',
    'https://user@checkout.paystack.com/test', 'https://checkout.paystack.com/test#private', ' javascript:alert(1)',
    'https://checkout.paystack.com/te\nst', 'https://checkout.paystack.com/test ', '//checkout.paystack.com/test'])
    assert.equal(safeCheckoutUrl(value), null);
});
test('checkout records retain target identity and test-only provider settings, including disabled historical receipts', () => {
  assert.deepEqual(readCheckoutPaymentResponse(response(payment), expected).payment, payment);
  assert.equal(readCheckoutPaymentResponse({ ...response(null), canStart: true }, expected).canStart, true);
  const history = readCheckoutPaymentResponse({ ...response(paid), settings: { ...settings, enabled: false } }, expected);
  assert.equal(history.payment.receipt.notice, paid.receipt.notice);
  for (const changed of [{ ...expected, kind: 'ride' }, { ...expected, targetId: id(9) }]) assert.throws(() => readCheckoutPaymentResponse(response(payment), changed));
  assert.equal(readCheckoutPaymentResponse({ ...response(payment), settings: { ...settings, mode: 'live' } }, expected).settings.mode, 'live');
  assert.throws(() => readCheckoutPaymentResponse({ ...response(payment), settings: { ...settings, provider: 'other' } }, expected));
  assert.throws(() => readCheckoutPaymentResponse({ ...response(null), canStart: true, isPayer: false }, expected));
  assert.throws(() => readCheckoutPaymentResponse({ ...response(null), canStart: true, settings: { ...settings, enabled: false } }, expected));
});
test('nonpayers cannot receive checkout secrets or receipts, and confirmed receipts must match immutable payment totals', () => {
  const viewer = { ...paid, checkoutUrl: null, reference: null, receipt: null };
  assert.equal(readCheckoutPaymentResponse({ ...response(viewer), isPayer: false }, expected).payment.status, 'paid');
  for (const data of [payment, paid, { ...viewer, reference: payment.reference }])
    assert.throws(() => readCheckoutPaymentResponse({ ...response(data), isPayer: false }, expected));
  for (const data of [{ ...paid, paidAt: null }, { ...paid, receipt: null }, { ...paid, checkoutUrl: payment.checkoutUrl },
    { ...paid, receipt: { ...paid.receipt, amountKobo: 1 } }, { ...paid, receipt: { ...paid.receipt, reference: 'different' } },
    { ...paid, receipt: { ...paid.receipt, paidAt: 3 } }, { ...paid, receipt: { ...paid.receipt, notice: 'Live money paid' } }])
    assert.throws(() => readCheckoutPaymentResponse(response(data), expected));
});
test('refund review remains distinct from a confirmed refund and malformed money or unsafe links fail validation', () => {
  const refund = { ...paid, status: 'refund_required', refundRequired: true, refundAmountKobo: 40000 };
  assert.equal(readCheckoutPaymentResponse(response(refund), expected).payment.refundAmountKobo, 40000);
  for (const data of [{ ...refund, refundRequired: false }, { ...refund, refundAmountKobo: 200000 },
    { ...payment, amountKobo: -1 }, { ...payment, amountKobo: 1.1 }, { ...payment, version: 0 },
    { ...payment, currency: 'USD' }, { ...payment, checkoutUrl: 'https://evil.test/pay' }, { ...payment, status: 'success' }])
    assert.throws(() => readCheckoutPaymentResponse(response(data), expected));
});
