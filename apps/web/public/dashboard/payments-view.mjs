import { $, element } from './dom.mjs';
import { PAYMENT_LABELS, formatPaymentNaira } from '/shared/payments.mjs';

const date = (value) => new Intl.DateTimeFormat('en-NG', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Africa/Lagos' }).format(new Date(value));

export function createPaymentsView({ onStart, onSimulate, onPage, onOpenRide, onPrint }) {
  let state = {}, renderedReceipt = '', renderedLedger = '';
  function render(next) {
    state = next;
    const { user, ride, payment, receipt, settings, busy, ledger } = state;
    $('payment-panel').hidden = !user || !ride;
    $('payment-error').textContent = state.detailError;
    $('payment-notice').textContent = state.message;
    $('payment-status').textContent = payment ? PAYMENT_LABELS[payment.status] : 'Loading';
    $('payment-amount').textContent = payment ? formatPaymentNaira(payment.amountKobo) : '—';
    $('payment-reference').textContent = payment?.attempt ? `Reference ${payment.attempt.reference}` : '';
    $('payment-guidance').textContent = !payment ? 'Loading the saved payment record…'
      : payment.status === 'paid' ? 'Your simulated payment is saved. View the receipt below.'
        : !settings?.canSimulate ? 'Payment simulation is available when running Taxi Ai locally.'
          : user.role === 'driver' ? 'The customer can test payment for this completed trip.'
            : payment.status === 'pending' ? 'Choose a test outcome for this pending attempt. Closing the page leaves it pending.'
              : payment.status === 'failed' ? 'The last attempt failed. Start a new test payment when ready.' : 'The trip is complete. You can now test payment of the agreed fare.';
    const customer = user?.role === 'customer' && settings?.canSimulate && payment;
    $('payment-start').hidden = !customer || !['unpaid', 'failed'].includes(payment.status);
    $('payment-start').textContent = payment?.status === 'failed' ? 'Retry test payment' : 'Start test payment';
    $('payment-outcomes').hidden = !customer || payment.status !== 'pending';
    for (const id of ['payment-start', 'payment-success', 'payment-failure']) $(id).disabled = Boolean(busy || !customer);
    // Closures retain the exact payment/attempt version shown by this render.
    $('payment-start').onclick = () => { if (!busy && customer) onStart(payment); };
    $('payment-success').onclick = () => { if (!busy && customer) onSimulate(payment, 'success'); };
    $('payment-failure').onclick = () => { if (!busy && customer) onSimulate(payment, 'failure'); };
    $('payment-receipt').hidden = !receipt;
    const receiptKey = JSON.stringify(receipt);
    if (receiptKey !== renderedReceipt) {
      renderedReceipt = receiptKey; $('receipt-details').replaceChildren();
      if (receipt) {
        for (const [label, value] of [['Receipt / payment reference', receipt.reference], ['Trip', receipt.rideId],
          ['Pickup', receipt.pickup], ['Destination', receipt.destination], ['Completed (Abuja time)', date(receipt.completedAt)],
          ['Simulated payment (Abuja time)', date(receipt.paidAt)], ['Agreed fare / total (NGN)', formatPaymentNaira(receipt.amountKobo)]]) {
          $('receipt-details').append(element('dt', label), element('dd', value));
        }
      }
    }
    $('receipt-print').disabled = !receipt || busy;
    $('earnings-panel').hidden = user?.role !== 'driver';
    $('payments-admin-panel').hidden = user?.role !== 'admin';
    const prefix = user?.role === 'admin' ? 'admin-payments' : 'earnings';
    for (const name of ['earnings', 'admin-payments']) $(name + '-error').textContent = name === prefix ? state.ledgerError : '';
    {
      const summary = user?.role === 'driver' ? ledger?.summary : null;
      for (const [id, key] of [['earnings-gross', 'grossFareKobo'], ['earnings-paid', 'simulatedPaidKobo'], ['earnings-outstanding', 'outstandingKobo']]) {
        $(id).textContent = summary ? formatPaymentNaira(summary[key]) : '—';
      }
      $('earnings-count').textContent = summary ? `${summary.completedTrips} completed · ${summary.paidTrips} simulated paid · ${summary.pendingTrips} pending · ${summary.failedTrips} failed · ${summary.unpaidTrips} not started` : user?.role === 'driver' ? 'Loading completed trips…' : '';
    }
    const ledgerKey = JSON.stringify([user?.id, user?.role, ledger?.payments, ledger?.nextBefore]);
    if (ledgerKey !== renderedLedger) {
      renderedLedger = ledgerKey;
      $('earnings-list').replaceChildren(); $('admin-payments-list').replaceChildren();
      if (['driver', 'admin'].includes(user?.role)) {
        const container = $(prefix + '-list');
        if (!ledger) container.append(element('p', 'Loading payment records…', 'empty-state'));
        else if (!ledger.payments.length) container.append(element('p', 'No completed trips on this page yet.', 'empty-state'));
        else for (const item of ledger.payments) {
          const row = element('article', undefined, 'payment-row');
          const description = element('div');
          description.append(element('strong', `Trip ${item.rideId.slice(0, 8).toUpperCase()}`),
            element('small', `${date(item.completedAt)} · Abuja time`),
            element('small', item.attempt?.reference ?? 'No payment attempt yet'));
          const amount = element('div', undefined, 'payment-row-amount');
          amount.append(element('strong', formatPaymentNaira(item.amountKobo)), element('span', PAYMENT_LABELS[item.status], 'status-badge'));
          row.append(description, amount);
          if (user.role === 'driver') {
            const button = element('button', 'Open trip / receipt', 'button button-outline button-small');
            button.type = 'button'; button.addEventListener('click', () => onOpenRide(item.rideId)); row.append(button);
          }
          container.append(row);
        }
      }
    }
    for (const name of ['earnings', 'admin-payments']) {
      $(name + '-older').disabled = !ledger?.nextBefore;
      $(name + '-latest').disabled = state.before === null;
    }
  }
  for (const prefix of ['earnings', 'admin-payments']) {
    $(prefix + '-older').addEventListener('click', () => { if (state.ledger?.nextBefore) onPage(state.ledger.nextBefore); });
    $(prefix + '-latest').addEventListener('click', () => onPage(null));
  }
  $('receipt-print').addEventListener('click', () => { if (state.receipt) onPrint(); });
  return Object.freeze({ render });
}
