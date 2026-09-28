import { check } from '../../shared/errors.mjs';

export function requirePaymentVersion(payment, expected) {
  check(Number.isSafeInteger(expected) && expected >= 0, 'INVALID_VERSION', 'A payment version is required.');
  check(payment.version === expected, 'STALE_VERSION', 'This payment changed. Refresh before trying again.');
}

export function verifySimulation(result, attempt) {
  check(result?.provider === 'simulator' && result.mode === 'simulation'
    && result.reference === attempt.reference && result.amountKobo === attempt.amountKobo
    && result.currency === attempt.currency && ['succeeded', 'failed'].includes(result.status),
  'PAYMENT_VERIFICATION_FAILED', 'The simulated result could not be verified. Retry the same action.');
  return result.status;
}

// Individual fares are safe integers; lifetime totals can exceed that range.
// Decimal kobo strings preserve exact amounts across JSON and the browser.
export function summarizePayments(rows) {
  let total = 0n, paid = 0n, completedTrips = 0, paidTrips = 0, pendingTrips = 0, failedTrips = 0;
  for (const row of rows) {
    total += BigInt(row.amountKobo); completedTrips++;
    if (row.status === 'paid') { paid += BigInt(row.amountKobo); paidTrips++; }
    if (row.status === 'pending') pendingTrips++;
    if (row.status === 'failed') failedTrips++;
  }
  return { completedTrips, paidTrips, pendingTrips, failedTrips, unpaidTrips: completedTrips - paidTrips - pendingTrips - failedTrips,
    grossFareKobo: total.toString(), simulatedPaidKobo: paid.toString(), outstandingKobo: (total - paid).toString() };
}
