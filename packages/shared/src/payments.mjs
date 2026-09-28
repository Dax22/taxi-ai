export const PAYMENT_LABELS = Object.freeze({ unpaid: 'Not started', pending: 'Pending', failed: 'Failed', paid: 'Paid (simulated)' });

/** Exact display for safe individual fares and decimal-string lifetime totals. */
export function formatPaymentNaira(kobo) {
  if (!((typeof kobo === 'number' && Number.isSafeInteger(kobo) && kobo >= 0)
    || (typeof kobo === 'string' && /^(0|[1-9][0-9]*)$/.test(kobo)))) throw new TypeError('Expected nonnegative integer kobo.');
  const value = BigInt(kobo);
  return `₦${new Intl.NumberFormat('en-NG').format(value / 100n)}.${String(value % 100n).padStart(2, '0')}`;
}
