import { element } from './dom.mjs';
import { formatPaymentNaira } from '/shared/payments.mjs';
import { safeCheckoutUrl } from '/shared/checkout-payments.mjs';

const labels = (mode) => ({ initializing: 'Preparing checkout', pending: mode === 'live' ? 'Awaiting payment' : 'Awaiting test payment', unknown: 'Payment status unknown', paid: mode === 'live' ? 'Paid · verified' : 'Paid · test mode', refund_required: 'Refund review required', failed: 'Payment unsuccessful' });
const guidance = (mode) => ({
  initializing: 'Checkout is being prepared. Use Check payment to recover its status. Do not create another payment.',
  pending: `Open the existing Paystack ${mode === 'live' ? '' : 'test '}checkout. After returning, choose Check payment; returning here does not confirm payment.`,
  unknown: 'The payment result is not confirmed. Use Check payment before trying anything else. Do not pay again while the result is unknown.',
  paid: mode === 'live' ? 'The server verified this Paystack payment.' : 'The server verified this Paystack test payment. No real money was collected.',
  refund_required: `${mode === 'live' ? 'This payment' : 'This test payment'} needs a manual refund review because the booking or part of the food checkout changed. A refund has not been completed automatically. Contact support with the payment reference.`,
  failed: 'Paystack reported an unsuccessful payment. Choose Check payment to verify the latest status. If it stays unsuccessful, contact support or cancel the unpaid booking. A new charge is not started here.',
});

export function createCheckoutPaymentView(root, { onStart, onRefresh, onRetry, onReload }) {
  const title = element('h2'), status = element('p', '', 'checkout-payment-status'), testNote = element('p', 'PAYSTACK TEST MODE · No real money. Use test payment details only.', 'checkout-payment-test-note'), walletNote = element('p', 'Apple Pay or Google Pay may appear inside Paystack Checkout when enabled for the business and supported on this device.', 'small-note');
  const total = element('p', '', 'checkout-payment-total'), note = element('p'), group = element('p', '', 'small-note'), reference = element('p', '', 'small-note'), receipt = element('p', '', 'small-note');
  const error = element('p', '', 'error-text food-error'), actions = element('div', undefined, 'checkout-payment-actions');
  const start = element('button', 'Prepare Paystack test checkout', 'button button-primary'), check = element('button', 'Check payment', 'button button-outline');
  const retry = element('button', 'Retry the same payment action', 'button button-primary'), reload = element('button', 'Reload payment status', 'button button-outline');
  const open = element('a', 'Open Paystack test checkout ↗', 'button button-primary');
  open.target = '_blank'; open.rel = 'noopener noreferrer'; open.referrerPolicy = 'no-referrer';
  status.setAttribute('role', 'status'); error.setAttribute('role', 'alert');
  for (const button of [start, check, retry, reload]) button.type = 'button';
  actions.append(start, open, check, retry, reload); root.append(title, status, testNote, walletNote, total, note, group, reference, receipt, error, actions);
  let current = null;
  start.addEventListener('click', () => { if (current && !start.disabled) onStart(current.payment?.version ?? 0); });
  check.addEventListener('click', () => { if (current && !check.disabled) onRefresh(current.payment?.version ?? 0); });
  retry.addEventListener('click', () => { if (!retry.disabled) onRetry(); });
  reload.addEventListener('click', () => { if (!reload.disabled) onReload(); });
  open.addEventListener('click', (event) => {
    // Recheck at the click boundary; a previous account's link is never kept live.
    const allowed = current?.isPayer && !current.busy && !current.uncertain && safeCheckoutUrl(current.payment?.checkoutUrl);
    if (!allowed || open.href !== allowed) event.preventDefault();
  });
  return Object.freeze({ render(state) {
    current = state;
    const mode = state.payment?.providerMode ?? state.settings?.mode ?? 'test', live = mode === 'live';
    const copy = labels(mode), help = guidance(mode);
    testNote.textContent = live ? 'PAYSTACK LIVE MODE · A completed checkout can move real money.' : 'PAYSTACK TEST MODE · No real money. Use test payment details only.';
    start.textContent = live ? 'Prepare secure Paystack checkout' : 'Prepare Paystack test checkout';
    open.textContent = live ? 'Open Paystack checkout ↗' : 'Open Paystack test checkout ↗';
    root.hidden = !state.user || !state.target || state.loaded && !state.settings?.enabled && !state.payment && !state.error;
    title.textContent = state.target?.title ?? 'Test checkout';
    status.textContent = state.payment ? copy[state.payment.status] : state.loading ? 'Checking payment options…' : state.error ? 'Payment options unavailable' : 'Paystack test checkout';
    total.textContent = state.payment ? `Server total · ${formatPaymentNaira(state.payment.amountKobo)}` : 'The exact server total appears when checkout is prepared. No charge is made by preparing checkout.';
    note.textContent = state.uncertain ? 'The reply was interrupted. Retry the same action with the same payment details before continuing.'
      : state.payment ? help[state.payment.status] : state.canStart ? state.target?.kind === 'food' ? 'Complete Paystack test checkout before the kitchens can prepare these orders.' : 'Complete Paystack test checkout before the driver starts this job.'
        : state.loaded ? live ? 'A new checkout is not available for this booking.' : 'A new test checkout is not available for this booking.' : 'Checking the saved checkout settings…';
    group.textContent = state.target?.grouped ? 'This checkout covers all kitchens in this combined order. Pay once; do not pay each kitchen separately.' : '';
    reference.textContent = state.isPayer && state.payment?.reference ? `Reference: ${state.payment.reference}` : '';
    receipt.textContent = state.isPayer && state.payment?.receipt
      ? `${state.payment.receipt.notice} · Verified ${new Date(state.payment.receipt.paidAt).toLocaleString('en-NG', { timeZone: 'Africa/Lagos' })} (Nigeria time).` : '';
    error.textContent = state.error;
    const locked = state.busy || state.loading || state.uncertain;
    start.hidden = !state.isPayer || !state.canStart || Boolean(state.payment) || state.uncertain; start.disabled = locked;
    check.hidden = !state.isPayer || !state.payment || state.uncertain; check.disabled = locked;
    retry.hidden = !state.uncertain; retry.disabled = state.busy || state.loading;
    reload.hidden = !state.error || state.uncertain; reload.disabled = state.busy || state.loading;
    const url = state.isPayer && !locked && ['pending'].includes(state.payment?.status) ? safeCheckoutUrl(state.payment?.checkoutUrl) : null;
    open.hidden = !url;
    if (url) open.href = url; else open.removeAttribute('href');
  } });
}
