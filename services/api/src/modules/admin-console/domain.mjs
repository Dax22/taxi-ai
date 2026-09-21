import { check } from '../../shared/errors.mjs';
import { fields } from '../../shared/validation.mjs';
import { DEMO_AREAS } from '../../../../../packages/shared/src/demo-booking.mjs';
import { RIDE_STATUS_LABELS } from '../../../../../packages/shared/src/trip-lifecycle.mjs';

export const DAY = 86_400_000;
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
export const localDay = (time) => new Date(time + 3_600_000).toISOString().slice(0, 10);
export function recordId(id) { check(typeof id === 'string' && uuid.test(id), 'INVALID_INPUT', 'Choose a valid account or trip.'); return id; }
function dayStart(value) {
  check(typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value), 'INVALID_INPUT', 'Choose dates in YYYY-MM-DD format.');
  const time = Date.parse(value + 'T00:00:00+01:00');
  check(Number.isFinite(time) && localDay(time) === value && time >= 0, 'INVALID_INPUT', 'Choose a valid date.'); return time;
}
export function range(input, now, defaultDays = null) {
  let { from = '', to = '' } = input;
  if (!from && !to && defaultDays) { to = localDay(now); from = localDay(dayStart(to) - (defaultDays - 1) * DAY); }
  if (!from && !to) return { from: null, to: null, start: 0, end: now + 1, timeZone: 'Africa/Lagos', basis: 'request_created_at' };
  check(from && to, 'INVALID_INPUT', 'Choose both the start and end dates.');
  const start = dayStart(from), end = dayStart(to) + DAY;
  check(start < end && end - start <= 366 * DAY && to <= localDay(now), 'INVALID_INPUT', 'Choose up to 366 days, ending today or earlier.');
  return { from, to, start, end: Math.min(end, now + 1), timeZone: 'Africa/Lagos', basis: 'request_created_at' };
}
function choice(value, allowed, fallback) {
  const result = value || fallback; check(allowed.includes(result), 'INVALID_INPUT', 'Choose a supported filter.'); return result;
}
function cursor(value) {
  if (!value) return null;
  const parts = value.split('.'), time = Number(parts[0]);
  check(parts.length === 2 && /^\d{1,16}$/.test(parts[0]) && Number.isSafeInteger(time) && time >= 0 && uuid.test(parts[1]),
    'INVALID_INPUT', 'This page reference is invalid. Return to the first page.');
  return { time, id: parts[1] };
}
export function filters(input, now, kind) {
  fields(input, kind === 'analytics' ? ['from', 'to']
    : kind === 'accounts' ? ['q', 'type', 'review', 'before', 'after', 'limit']
      : ['q', 'status', 'payment', 'mode', 'from', 'to', 'before', 'after', 'limit'], []);
  const limit = input.limit === undefined ? 25 : Number(input.limit);
  check(Number.isInteger(limit) && limit > 0 && limit <= 100 && (input.limit === undefined || /^\d+$/.test(input.limit)), 'INVALID_INPUT', 'Choose a page size from 1 to 100.');
  const q = input.q?.trim() ?? ''; check(q.length <= 100, 'INVALID_INPUT', 'Search using 100 characters or fewer.');
  const before = cursor(input.before), after = cursor(input.after);
  check(!before || !after, 'INVALID_INPUT', 'Use one page direction at a time.');
  return { q, limit, before, after,
    type: choice(input.type, ['all', 'customer', 'driver'], 'all'),
    review: choice(input.review, ['all', 'draft', 'submitted', 'changes_requested', 'approved', 'rejected'], 'all'),
    status: choice(input.status, ['all', ...Object.keys(RIDE_STATUS_LABELS)], 'all'),
    payment: choice(input.payment, ['all', 'not_due', 'unpaid', 'pending', 'failed', 'paid'], 'all'),
    mode: choice(input.mode, ['all', 'customer', 'driver'], 'all'),
    range: kind === 'accounts' ? null : range(input, now, kind === 'analytics' ? 30 : null) };
}
export function page(rows, filter) {
  const more = rows.length > filter.limit, items = rows.slice(0, filter.limit);
  if (filter.after) items.reverse();
  const key = (item) => item ? `${item.createdAt}.${item.id}` : null;
  return { items, page: { limit: filter.limit,
    next: (filter.after ? true : more) ? key(items.at(-1)) : null,
    previous: (filter.after ? more : Boolean(filter.before)) ? key(items[0]) : null } };
}
export function accountSummary(row, detailed = false) {
  const { id, name, email, createdAt, driverStatus, reviewStatus, tripCount } = row;
  const at = email.indexOf('@'), maskedEmail = at > 0 ? `${email.slice(0, 1)}•••${email.slice(at)}` : 'Not available';
  const result = { id, name, email: detailed ? email : maskedEmail, createdAt, type: driverStatus ? 'driver' : 'customer', driverStatus, reviewStatus, tripCount };
  if (detailed && driverStatus) result.vehicle = row.vehicleJson ? JSON.parse(row.vehicleJson) : { model: row.vehicleModel, plate: row.vehiclePlate };
  return result;
}
function area(id, label) { return label || DEMO_AREAS.find((item) => item.id === id)?.name || 'Saved location'; }
export function tripSummary(row) {
  return { id: row.id, vehicleCategory: row.vehicleCategory ?? 'standard', createdAt: row.createdAt, updatedAt: row.updatedAt, status: row.status,
    pickup: area(row.pickupId, row.pickupName), destination: area(row.destinationId, row.destinationName),
    customer: { id: row.customerId, name: row.customerName }, driver: row.driverId ? { id: row.driverId, name: row.driverName } : null,
    fareKobo: row.fareKobo == null ? null : String(row.fareKobo), paymentStatus: row.paymentStatus ?? 'not_due',
    paymentMode: row.paymentMode ?? null, completedAt: row.completedAt };
}
function emptySummary() {
  return { requests: 0, completed: 0, cancelled: 0, expired: 0, active: 0, paid: 0, pending: 0, failed: 0, unpaid: 0,
    completedFareKobo: 0n, simulatedPaidKobo: 0n, outstandingKobo: 0n };
}
function add(summary, row) {
  summary.requests++;
  if (['completed', 'cancelled', 'expired'].includes(row.status)) summary[row.status]++; else summary.active++;
  if (row.status === 'completed') {
    const amount = BigInt(row.fareKobo); summary.completedFareKobo += amount;
    const status = row.paymentStatus ?? 'unpaid'; summary[status]++;
    if (status === 'paid' && row.paymentMode === 'simulation') summary.simulatedPaidKobo += amount;
    else if (status !== 'paid') summary.outstandingKobo += amount;
  }
}
function finish(summary) {
  return { ...summary, completedFareKobo: String(summary.completedFareKobo), simulatedPaidKobo: String(summary.simulatedPaidKobo),
    outstandingKobo: String(summary.outstandingKobo), completionRate: summary.requests ? summary.completed / summary.requests : null,
    cancellationRate: summary.requests ? summary.cancelled / summary.requests : null,
    averageFareKobo: summary.completed ? String(summary.completedFareKobo / BigInt(summary.completed)) : null };
}
/** Iterator input bounds memory; amounts stay exact even beyond Number.MAX_SAFE_INTEGER. */
export function summarize(rows, selectedRange = null, accountId = null) {
  const summary = emptySummary(), passenger = emptySummary(), driving = emptySummary(), days = new Map(), statuses = new Map();
  if (selectedRange?.from) for (let day = dayStart(selectedRange.from); day < selectedRange.end; day += DAY) days.set(localDay(day), emptySummary());
  for (const row of rows) {
    add(summary, row); statuses.set(row.status, (statuses.get(row.status) ?? 0) + 1);
    if (accountId === row.customerId) add(passenger, row);
    if (accountId === row.driverId) add(driving, row);
    const daily = days.get(localDay(row.createdAt)); if (daily) add(daily, row);
  }
  return { summary: finish(summary), ...(accountId ? { passenger: finish(passenger), driving: finish(driving) } : {}),
    daily: [...days].map(([date, value]) => ({ date, ...finish(value) })),
    statuses: Object.keys(RIDE_STATUS_LABELS).map((status) => ({ status, count: statuses.get(status) ?? 0 })) };
}
