import { el, link, badge, panel, cards, table, empty, filterForm, detailsList, money, count, date } from './ui.mjs';

const dates = [{ name: 'from', label: 'Completed from · WAT', type: 'date' }, { name: 'to', label: 'Completed to · WAT', type: 'date' }];
const reference = (value) => value ?? 'Not recorded';
const simulationNote = () => el('p', 'SIMULATED PAYMENTS · Paystack is not configured. No money has moved. This workspace checks saved ride and courier payment records; it does not reconcile a bank or payment provider. Eats payments are not included.', 'scope-notice');
function findings(rows) {
  if (!rows?.length) return el('span', 'No record issues detected', 'muted');
  const list = el('ul', null, 'finding-list');
  for (const row of rows) list.append(el('li', row.label));
  return list;
}
function nextPage(page, route, length) {
  const row = el('div', null, 'pagination'); row.append(el('span', `${count(length)} records on this page`));
  const controls = el('div'), first = new URLSearchParams(route.query); first.delete('before');
  controls.append(link('First page', route.path + (first.size ? '?' + first : ''), 'button quiet'));
  if (page.next) { const query = new URLSearchParams(route.query); query.set('before', page.next); controls.append(link('Next →', route.path + '?' + query, 'button secondary')); }
  row.append(controls); return row;
}
export function finance(data, route) {
  const result = el('div'), summary = data.summary;
  result.append(simulationNote(), filterForm(route, [...dates,
    { name: 'status', label: 'Payment status', options: [['all', 'All statuses'], ['unpaid', 'Unpaid'], ['pending', 'Pending'], ['failed', 'Failed'], ['paid', 'Paid · simulated']] },
    { name: 'q', label: 'Payment or journey reference', type: 'search', placeholder: 'At least 3 letters or digits', minLength: 3, maxLength: 40, pattern: '[A-Za-z0-9-]{3,40}' },
  ], data.filters));
  result.append(cards([
    ['Completed fares', money(summary.grossFareKobo), `${count(summary.completedTrips)} completed journeys · gross fares`, true],
    ['Paid · simulated', money(summary.simulatedPaidKobo), `${count(summary.paidTrips)} records marked paid`],
    ['Outstanding · simulated', money(summary.outstandingKobo), 'Unpaid, pending or failed records'],
    ['Records to review', count(summary.attentionTrips), 'Saved record consistency checks'],
  ]));
  const coverage = panel('Payment readiness', 'Available totals cover the entire filtered cohort, including records beyond this page.');
  coverage.append(detailsList([
    ['Gateway connection', 'Not configured'], ['Provider reconciliation', 'Unavailable'],
    ['Gateway fees', 'Unavailable'], ['Taxi Ai commission', 'Unavailable'], ['Refunds', 'Unavailable'], ['Driver / vendor payouts', 'Unavailable'],
  ])); result.append(coverage);
  const ledger = panel('Completed journey payments', `Completed ${data.scope.from} to ${data.scope.to}, inclusive, in Nigeria time (WAT). Payment status is current at refresh.`);
  ledger.append(data.payments.length ? table(['Journey / completed', 'Gross fare', 'Payment status', 'Current reference', 'Record checks'], data.payments.map((item) => {
    const identity = el('div'); identity.append(link(item.rideId.slice(0, 8).toUpperCase() + ' ↗', '/admin/finance/' + item.rideId), el('span', date(item.completedAt), 'subtext'));
    return [identity, money(item.amountKobo), badge(item.status), reference(item.currentReference), findings(item.findings)];
  }), 'Completed ride and courier payment records · newest completion first') : empty('No payment records in this period', 'Completed rides and courier journeys will appear here. Try changing the completion dates or clearing a filter.'));
  ledger.append(nextPage(data.page, route, data.payments.length)); result.append(ledger,
    el('p', `${count(summary.unpaidTrips)} unpaid · ${count(summary.pendingTrips)} pending · ${count(summary.failedTrips)} failed. Gross fares are not platform revenue. Unavailable fees, commissions, refunds and payouts have not been treated as zero.`, 'definition-note'));
  return result;
}
export function financeDetail(data, route) {
  const result = el('div'), item = data.payment;
  result.append(link('← Finance centre', '/admin/finance', 'text-link'), simulationNote());
  const payment = panel('Payment record', 'Journey reference: ' + item.rideId);
  payment.append(detailsList([
    ['Gross fare · NGN', money(item.amountKobo)], ['Payment status', badge(item.status)],
    ['Completed', date(item.completedAt)], ['Last updated', date(item.updatedAt)], ['Paid · simulated', date(item.paidAt)], ['Current reference', reference(item.currentReference)],
  ])); result.append(payment);
  const checks = panel('Record consistency', 'These checks compare saved records. They do not verify settlement with a payment provider.'); checks.append(findings(data.findings)); result.append(checks);
  const attempts = panel('Payment attempts', 'Each saved attempt remains visible. Newest attempts first.');
  attempts.append(data.attempts.length ? table(['Reference', 'Amount', 'Provider', 'Status', 'Created', 'Resolved'], data.attempts.map((attempt) => [attempt.reference, money(attempt.amountKobo), attempt.provider, badge(attempt.status), date(attempt.createdAt), date(attempt.resolvedAt)]), 'Simulated payment attempt history') : empty('No payment attempts', 'No attempt has been recorded for this journey.'));
  attempts.append(nextPage(data.page, route, data.attempts.length)); result.append(attempts);
  const receipt = panel('Receipt metadata', 'Simulation receipt only · no proof of real payment.');
  if (data.receipt?.available && data.receipt.consistent) receipt.append(detailsList([
    ['Receipt number', data.receipt.number], ['Reference', data.receipt.reference], ['Amount', money(data.receipt.amountKobo)], ['Paid · simulated', date(data.receipt.paidAt)],
  ])); else receipt.append(el('p', data.receipt?.available ? 'The saved receipt does not match this payment. Review the record checks above; unverified receipt details are not displayed.' : 'No consistent paid receipt is available for this record.', 'definition-note'));
  result.append(receipt); return result;
}
