import { check } from '../../shared/errors.mjs';
import { fields } from '../../shared/validation.mjs';

const DAY = 86_400_000;
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const REFERENCE = /^SIM-[A-F0-9]{8}-[A-F0-9]{4}-[A-F0-9]{4}-[A-F0-9]{4}-[A-F0-9]{12}$/;
export const STALE_PENDING_MS = 15 * 60_000;
export const localDay = (time) => new Date(time + 3_600_000).toISOString().slice(0, 10);

export function identifier(value) {
  check(typeof value === 'string' && UUID.test(value), 'INVALID_INPUT', 'Choose a valid payment record.');
  return value;
}
function dayStart(value) {
  check(typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value), 'INVALID_INPUT', 'Choose dates in YYYY-MM-DD format.');
  const time = Date.parse(value + 'T00:00:00+01:00');
  check(Number.isFinite(time) && time >= 0 && localDay(time) === value, 'INVALID_INPUT', 'Choose a valid date.');
  return time;
}
function cursor(value) {
  if (!value) return null;
  check(typeof value === 'string', 'INVALID_INPUT', 'This page reference is invalid.');
  const parts = value.split('.'), time = Number(parts[0]);
  check(parts.length === 2 && /^\d{1,16}$/.test(parts[0]) && Number.isSafeInteger(time) && time >= 0 && UUID.test(parts[1]),
    'INVALID_INPUT', 'This page reference is invalid. Return to the first page.');
  return { time, id: parts[1] };
}
export function financeFilters(input = {}, now, detail = false) {
  fields(input, detail ? ['before', 'limit'] : ['from', 'to', 'status', 'q', 'before', 'limit'], []);
  const limit = input.limit === undefined ? 25 : Number(input.limit);
  check(Number.isInteger(limit) && limit >= 1 && limit <= 50 && (input.limit === undefined || /^\d+$/.test(input.limit)),
    'INVALID_INPUT', 'Choose a page size from 1 to 50.');
  const page = { before: cursor(input.before), limit };
  if (detail) return page;
  const status = input.status || 'all';
  check(['all', 'unpaid', 'pending', 'failed', 'paid'].includes(status), 'INVALID_INPUT', 'Choose a supported payment status.');
  const q = typeof input.q === 'string' ? input.q.trim().toLowerCase() : '';
  check((input.q === undefined || typeof input.q === 'string') && (!q || /^[a-z0-9-]{3,40}$/.test(q)),
    'INVALID_INPUT', 'Search with at least 3 characters from a trip ID or payment reference.');
  let { from = '', to = '' } = input;
  if (!from && !to) { to = localDay(now); from = localDay(dayStart(to) - 29 * DAY); }
  check(from && to, 'INVALID_INPUT', 'Choose both the start and end dates.');
  const start = dayStart(from), end = dayStart(to) + DAY;
  check(start < end && end - start <= 366 * DAY && to <= localDay(now), 'INVALID_INPUT', 'Choose up to 366 days, ending today or earlier.');
  return { ...page, status, q, range: { from, to, start, end: Math.min(end, now + 1),
    timeZone: 'Africa/Lagos', basis: 'payment_completed_at', statusBasis: 'current' } };
}

const labels = Object.freeze({
  trip_mismatch: 'The saved payment does not match its completed trip.',
  attempt_mismatch: 'The current attempt does not match the saved payment.',
  attempt_status_mismatch: 'The current attempt status does not match the payment status.',
  succeeded_attempt_mismatch: 'A succeeded simulation attempt is not the current paid attempt.',
  receipt_missing: 'The paid simulation has no saved receipt.',
  receipt_mismatch: 'The saved receipt does not match the paid simulation.',
  unexpected_receipt: 'A receipt exists for a payment that is not paid.',
  stale_pending: 'This simulation attempt has been pending for at least 15 minutes.',
});
const validReference = (reference) => typeof reference === 'string' && REFERENCE.test(reference);
const sameAmount = (left, right) => (typeof left === 'string' && /^\d+$/.test(left) || Number.isSafeInteger(left))
  && BigInt(left) === BigInt(right);

/** Raw receipt JSON is bounded and parsed only inside the repository. Metadata
 * is untrusted until it matches the saved payment and current simulation attempt. */
export function receiptConsistent(row) {
  const receipt = row.receiptMetadata;
  return Boolean(row.receiptAttemptId && row.status === 'paid' && row.receiptAttemptId === row.currentAttemptId
    && row.attemptStatus === 'succeeded' && row.attemptRideId === row.rideId && validReference(row.currentReference)
    && receipt && receipt.rideId === row.rideId && receipt.number === row.currentReference
    && receipt.reference === row.currentReference && receipt.mode === 'simulation' && receipt.currency === row.currency
    && sameAmount(receipt.amountKobo, row.amountKobo) && receipt.completedAt === Number(row.completedAt)
    && receipt.paidAt === Number(row.paidAt) && sameAmount(row.attemptAmountKobo, row.amountKobo)
    && row.attemptCurrency === row.currency && row.attemptProvider === 'simulator');
}
export function integrityFindings(row, now) {
  const codes = [];
  if (!Number(row.tripMatches)) codes.push('trip_mismatch');
  if (row.currentAttemptId && (row.attemptRideId !== row.rideId || !sameAmount(row.attemptAmountKobo, row.amountKobo)
    || row.attemptCurrency !== row.currency || row.attemptProvider !== 'simulator' || !validReference(row.currentReference))) codes.push('attempt_mismatch');
  const expected = { paid: 'succeeded', pending: 'pending', failed: 'failed' }[row.status];
  if (expected && row.attemptStatus !== expected) codes.push('attempt_status_mismatch');
  if (Number(row.succeededMismatch)) codes.push('succeeded_attempt_mismatch');
  if (row.status === 'paid' && !row.receiptAttemptId) codes.push('receipt_missing');
  else if (row.receiptAttemptId && row.status !== 'paid') codes.push('unexpected_receipt');
  else if (row.receiptAttemptId && !receiptConsistent(row)) codes.push('receipt_mismatch');
  if (row.status === 'pending' && now - Number(row.attemptCreatedAt ?? row.updatedAt) >= STALE_PENDING_MS) codes.push('stale_pending');
  return codes.map((code) => ({ code, label: labels[code] }));
}
export function paymentSummary(row, now) {
  return { rideId: row.rideId, amountKobo: String(row.amountKobo), currency: row.currency, mode: row.mode, status: row.status,
    completedAt: Number(row.completedAt), updatedAt: Number(row.updatedAt), paidAt: row.paidAt == null ? null : Number(row.paidAt),
    currentReference: validReference(row.currentReference) ? row.currentReference : null, findings: integrityFindings(row, now) };
}
export function attemptSummary(row) {
  return { id: row.id, reference: validReference(row.reference) ? row.reference : null, amountKobo: String(row.amountKobo),
    currency: row.currency, provider: row.provider, status: row.status, createdAt: Number(row.createdAt),
    resolvedAt: row.resolvedAt == null ? null : Number(row.resolvedAt) };
}
export function receiptSummary(row) {
  if (!row.receiptAttemptId) return null;
  const consistent = receiptConsistent(row);
  return { available: true, consistent, attemptId: UUID.test(row.receiptAttemptId) ? row.receiptAttemptId : null,
    number: consistent ? row.currentReference : null, reference: consistent ? row.currentReference : null,
    amountKobo: consistent ? String(row.amountKobo) : null, currency: consistent ? row.currency : null,
    mode: consistent ? row.mode : null, completedAt: consistent ? Number(row.completedAt) : null,
    paidAt: consistent ? Number(row.paidAt) : null };
}
export function page(rows, filter, timeField, idField) {
  const items = rows.slice(0, filter.limit), last = items.at(-1);
  return { items, page: { limit: filter.limit, next: rows.length > filter.limit ? `${last[timeField]}.${last[idField]}` : null } };
}
/** Integer kobo and bounded streaming preserve exact totals beyond JavaScript's
 * safe integer range. Attempts are evidence, never additional revenue. */
export async function summarizeFinance(rows, now) {
  let gross = 0n, paid = 0n, attentionTrips = 0;
  const counts = { completedTrips: 0, unpaidTrips: 0, pendingTrips: 0, failedTrips: 0, paidTrips: 0 };
  for await (const row of rows) {
    const amount = BigInt(row.amountKobo); gross += amount; counts.completedTrips++; counts[`${row.status}Trips`]++;
    if (row.status === 'paid') paid += amount;
    if (integrityFindings(row, now).length) attentionTrips++;
  }
  return { ...counts, grossFareKobo: String(gross), simulatedPaidKobo: String(paid), outstandingKobo: String(gross - paid),
    attentionTrips, feesKobo: null, commissionKobo: null, refundsKobo: null, payoutsKobo: null };
}
