import { check } from '../../shared/errors.mjs';
import { fields, label } from '../../shared/validation.mjs';

export const CATEGORIES = ['support', 'safety'];
export const STATUSES = ['open', 'in_progress', 'waiting', 'resolved'];
export const PRIORITIES = ['urgent', 'high', 'normal', 'low'];
export const RESPONSE_WINDOWS = Object.freeze({ urgent: 15 * 60_000, high: 60 * 60_000, normal: 4 * 60 * 60_000, low: 24 * 60 * 60_000 });
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
export function identifier(value) { check(typeof value === 'string' && uuid.test(value), 'INVALID_INPUT', 'Choose a valid record reference.'); return value; }
export function choice(value, allowed) { check(allowed.includes(value), 'INVALID_INPUT', 'Choose a supported option.'); return value; }
export function text(value, name, min = 1, max = 2000) {
  check(typeof value === 'string' && value.trim().length >= min && value.trim().length <= max
    && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(value), 'INVALID_INPUT', `${name} must contain ${min}–${max} characters.`);
  return value.trim();
}
export function version(row, expected) {
  check(Number.isSafeInteger(expected) && expected >= 0, 'INVALID_VERSION', 'Use the version displayed on screen.');
  check(row.version === expected, 'STALE_VERSION', 'This case changed. Refresh before acting on it.');
}
export function commandKey(key) { check(typeof key === 'string' && /^[A-Za-z0-9_-]{16,128}$/.test(key), 'INVALID_IDEMPOTENCY_KEY', 'A unique command key is required.'); }
export function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
}
function cursor(value) {
  if (value === undefined || value === '') return null;
  check(typeof value === 'string', 'INVALID_CURSOR', 'Return to the first page.');
  const [stamp, id, extra] = value.split('.'), time = Number(stamp);
  check(extra === undefined && /^\d{1,16}$/.test(stamp) && Number.isSafeInteger(time) && time >= 0 && uuid.test(id ?? ''), 'INVALID_CURSOR', 'Return to the first page.');
  return { time, id };
}
export function filters(input = {}, events = false) {
  fields(input, events ? ['before', 'limit'] : ['category', 'status', 'priority', 'assigned', 'before', 'limit'], []);
  const limit = input.limit === undefined ? 25 : Number(input.limit);
  check(Number.isInteger(limit) && limit > 0 && limit <= 50 && (input.limit === undefined || /^\d+$/.test(input.limit)), 'INVALID_INPUT', 'Choose a page size from 1 to 50.');
  return { before: cursor(input.before), limit, ...(events ? {} : {
    category: choice(input.category ?? 'all', ['all', ...CATEGORIES]), status: choice(input.status ?? 'all', ['all', ...STATUSES]),
    priority: choice(input.priority ?? 'all', ['all', ...PRIORITIES]), assigned: choice(input.assigned ?? 'all', ['all', 'me', 'unassigned']),
  }) };
}
export function page(rows, filter) {
  const items = rows.slice(0, filter.limit), last = items.at(-1);
  return { items, page: { next: rows.length > filter.limit ? `${last.createdAt}.${last.id}` : null, limit: filter.limit } };
}
export function creation(data) {
  fields(data, ['category', 'rideId', 'subject', 'description', 'priority']);
  return { category: choice(data.category, CATEGORIES), rideId: identifier(data.rideId), subject: label(data.subject, 'Subject', 5, 120),
    description: text(data.description, 'Description', 5), priority: choice(data.priority, PRIORITIES) };
}
export const permission = (category) => `cases.${category}`;
export function summary(row) {
  return { id: row.id, rideId: row.rideId, incidentId: row.incidentId, category: row.category, subject: row.subject, priority: row.priority,
    status: row.status, assignedTo: row.assigneeId ? { id: row.assigneeId, name: row.assigneeName ?? 'Staff member' } : null,
    version: row.version, createdAt: row.createdAt, updatedAt: row.updatedAt, responseDueAt: row.responseDueAt,
    firstRespondedAt: row.firstRespondedAt, resolvedAt: row.resolvedAt };
}
/** Evidence is deliberately an allowlist: no fare, PIN, contact list, chat or live GPS port. */
export function tripEvidence(value) {
  if (!value) return null;
  const person = (p) => p ? { id: p.id, name: p.name } : null;
  const v = value.driver?.vehicle;
  return { rideId: value.rideId, status: value.status, pickup: value.pickup, destination: value.destination,
    customer: person(value.customer), driver: value.driver ? { ...person(value.driver), vehicle: v ? { model: v.model, plate: v.plate, colour: v.colour ?? v.color ?? null } : null } : null };
}
export function incidentEvidence(value) {
  if (!value) return null;
  const snapshot = value.snapshot ?? {}, point = snapshot.location;
  const location = point && Number.isFinite(point.lat) && Number.isFinite(point.lng) ? {
    lat: point.lat, lng: point.lng, accuracy: point.accuracy ?? null, capturedAt: point.capturedAt ?? null,
    source: point.source ?? 'saved_incident_snapshot', stale: Boolean(point.stale),
  } : null;
  return { id: value.id, kind: value.kind, status: value.status, recordedAt: snapshot.recordedAt ?? value.createdAt, note: value.note,
    reporter: snapshot.reporter ? { name: snapshot.reporter.name, role: snapshot.reporter.role } : null, location,
    notifications: (value.notifications ?? []).slice(0, 20).map((n) => ({ id: n.id, mode: n.mode, status: n.status, attempts: n.attempts, updatedAt: n.updatedAt })) };
}
