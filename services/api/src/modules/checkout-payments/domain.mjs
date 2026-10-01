import { check } from '../../shared/errors.mjs';

export const SETTLED = ['paid', 'refund_required'];
export const LEASE_MS = 60_000;
export const TEST_NOTICE = 'PAYSTACK TEST RECEIPT — NO LIVE MONEY MOVED';
export function target(kind, id) {
  check(['ride', 'food'].includes(kind) && typeof id === 'string' && /^[a-f0-9-]{36}$/.test(id), 'INVALID_INPUT', 'Choose a valid payment target.');
}
export function contextAmount(value) {
  check(value && typeof value.customerId === 'string' && Number.isSafeInteger(value.amountKobo) && value.amountKobo > 0
    && value.currency === 'NGN' && typeof value.eligible === 'boolean', 'PAYMENT_NOT_READY', 'A saved payable amount is required.');
  return value;
}
export function checkoutUrl(value) {
  try {
    const url = new URL(value);
    check(url.protocol === 'https:' && url.hostname === 'checkout.paystack.com' && !url.username && !url.password && !url.port,
      'PAYMENT_VERIFICATION_FAILED', 'The checkout address could not be verified.');
    return url.href;
  } catch { check(false, 'PAYMENT_VERIFICATION_FAILED', 'The checkout address could not be verified.'); }
}
export function verifyResult(value, payment) {
  check(value && value.reference === payment.reference && value.domain === 'test' && value.amountKobo === payment.amountKobo
    && value.currency === payment.currency && ['success', 'failed', 'abandoned', 'pending', 'ongoing', 'processing', 'queued', 'reversed', 'unknown'].includes(value.status),
  'PAYMENT_VERIFICATION_FAILED', 'The provider result does not match this test payment.');
  check(value.transactionId == null || typeof value.transactionId === 'string' && /^[A-Za-z0-9_-]{1,120}$/.test(value.transactionId),
    'PAYMENT_VERIFICATION_FAILED', 'The provider transaction could not be verified.');
  return value;
}
export function retryDelay(count) { return Math.min(60 * 60_000, 30_000 * 2 ** Math.min(count, 7)); }
