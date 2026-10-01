const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const uuid = value => typeof value === 'string' && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(value);
const integer = value => Number.isSafeInteger(value) && value >= 0;
const reference = value => typeof value === 'string' && value.length > 0 && value.length <= 160 && !/[\u0000-\u001f\u007f]/.test(value);
const statuses = new Set(['initializing', 'pending', 'unknown', 'failed', 'paid', 'refund_required']);
const receiptNotice = 'PAYSTACK TEST RECEIPT — NO LIVE MONEY MOVED';
function check(condition) { if (!condition) throw new Error('Taxi Ai returned an incompatible test payment response. Refresh and try again.'); }

/** An external checkout must stay on Paystack's exact HTTPS checkout origin. */
export function safeCheckoutUrl(value) {
  if (typeof value !== 'string' || value.length > 2048 || value.trim() !== value || /[\u0000-\u0020\u007f]/.test(value)) return null;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && url.hostname === 'checkout.paystack.com' && !url.port && !url.username && !url.password
      && !url.hash && url.pathname !== '/' ? url.href : null;
  } catch { return null; }
}

export function readCheckoutPaymentResponse(value, expected) {
  check(object(value) && object(value.settings));
  const { settings, payment: p, canStart, isPayer } = value;
  check(settings.provider === 'paystack' && settings.mode === 'test' && typeof settings.enabled === 'boolean');
  check(typeof canStart === 'boolean' && typeof isPayer === 'boolean' && (!canStart || settings.enabled && isPayer));
  check(value.replayed === undefined || typeof value.replayed === 'boolean');
  check(expected && ['ride', 'food'].includes(expected.kind) && uuid(expected.targetId));
  let payment = null;
  if (p !== null) {
    check(object(p) && uuid(p.id) && p.kind === expected.kind && p.targetId === expected.targetId && statuses.has(p.status));
    check(integer(p.version) && p.version >= 1 && integer(p.amountKobo) && p.amountKobo > 0 && p.currency === 'NGN');
    check(integer(p.createdAt) && integer(p.updatedAt) && (p.paidAt === null || integer(p.paidAt)) && typeof p.refundRequired === 'boolean');
    check(p.checkoutUrl === null || safeCheckoutUrl(p.checkoutUrl) !== null);
    check(p.reference === null || reference(p.reference));
    check(isPayer || p.checkoutUrl === null && p.reference === null && p.receipt === null);
    check(!['paid', 'refund_required', 'failed'].includes(p.status) || p.checkoutUrl === null);
    check(p.status !== 'refund_required' || p.refundRequired === true);
    let receipt = null;
    if (p.receipt !== null) {
      const r = p.receipt;
      check(object(r) && isPayer && ['paid', 'refund_required'].includes(p.status));
      check(reference(r.reference) && r.reference === p.reference && r.amountKobo === p.amountKobo && r.currency === 'NGN'
        && integer(r.paidAt) && r.paidAt === p.paidAt && r.provider === 'paystack' && r.mode === 'test' && r.notice === receiptNotice);
      receipt = { reference: r.reference, amountKobo: r.amountKobo, currency: r.currency, paidAt: r.paidAt,
        provider: r.provider, mode: r.mode, notice: r.notice };
    }
    check(!['paid', 'refund_required'].includes(p.status) || p.paidAt !== null && (!isPayer || receipt !== null));
    check(p.refundAmountKobo === undefined || p.refundAmountKobo === null || integer(p.refundAmountKobo) && p.refundAmountKobo <= p.amountKobo);
    payment = { id: p.id, kind: p.kind, targetId: p.targetId, status: p.status, amountKobo: p.amountKobo, currency: p.currency,
      version: p.version, checkoutUrl: p.checkoutUrl === null ? null : safeCheckoutUrl(p.checkoutUrl), reference: p.reference,
      refundRequired: p.refundRequired, createdAt: p.createdAt, updatedAt: p.updatedAt, paidAt: p.paidAt, receipt,
      ...(p.refundAmountKobo === undefined ? {} : { refundAmountKobo: p.refundAmountKobo }) };
  }
  return { settings: { provider: 'paystack', mode: 'test', enabled: settings.enabled }, payment, canStart, isPayer,
    ...(value.replayed === undefined ? {} : { replayed: value.replayed }) };
}
