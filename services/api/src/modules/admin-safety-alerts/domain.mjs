import { check } from '../../shared/errors.mjs';
import { fields, label } from '../../shared/validation.mjs';

export const ALERT_LABELS = Object.freeze({ impact: 'Possible crash', distress: 'Possible loud distress', manual: 'Manual panic alert' });
export const REVIEW_STATES = ['open', 'acknowledged', 'resolved', 'false_alarm'];
export const ACTIVE_TRIPS = ['booked', 'on_way', 'arrived', 'in_progress'];
export function alertId(value) {
  check(typeof value === 'string' && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(value), 'NOT_FOUND', 'Safety alert not found.');
  return value;
}
export function filters(query = {}) {
  fields(query, ['kind', 'state', 'before'], []);
  const kind = query.kind || 'all', state = query.state || 'active';
  check(['all', ...Object.keys(ALERT_LABELS)].includes(kind) && ['all', 'active', ...REVIEW_STATES].includes(state), 'INVALID_INPUT', 'Choose valid safety alert filters.');
  let before = null;
  if (query.before) {
    const match = typeof query.before === 'string' ? query.before.match(/^(\d{1,16}):([a-f0-9-]{36})$/) : null;
    check(match && Number.isSafeInteger(Number(match[1])), 'INVALID_CURSOR', 'Use the next-page link.');
    before = { createdAt: Number(match[1]), id: alertId(match[2]) };
  }
  return { kind, state, before };
}
export function position(value, now) {
  if (!value || !Number.isFinite(value.lat) || Math.abs(value.lat) > 90 || !Number.isFinite(value.lng) || Math.abs(value.lng) > 180
    || !Number.isFinite(value.accuracy) || value.accuracy < 0 || !Number.isSafeInteger(value.capturedAt) || value.capturedAt < 0 || value.capturedAt > now + 5000) return null;
  return { lat: value.lat, lng: value.lng, accuracy: value.accuracy, capturedAt: value.capturedAt,
    source: ['reporter_device', 'driver_shared'].includes(value.source) ? value.source : 'unknown',
    ageMs: Math.max(0, now - value.capturedAt), stale: value.stale === true || now - value.capturedAt >= 30_000 };
}
export function signal(value, kind) {
  const keys = kind === 'impact' ? ['capturedAt', 'peakG', 'speedBefore', 'speedAfter', 'windowMs']
    : kind === 'distress' ? ['capturedAt', 'levelDb', 'durationMs'] : ['capturedAt'];
  return Object.fromEntries(keys.filter(key => Number.isFinite(value?.[key])).map(key => [key, value[key]]));
}
export function reviewInput(data, key) {
  fields(data, ['action', 'expectedVersion', 'note']);
  check(typeof key === 'string' && /^[A-Za-z0-9_-]{16,128}$/.test(key), 'INVALID_IDEMPOTENCY_KEY', 'Use a unique action key.');
  check(['acknowledge', 'note', 'resolve', 'false_alarm', 'reopen'].includes(data.action), 'INVALID_INPUT', 'Choose a safety review action.');
  check(Number.isSafeInteger(data.expectedVersion) && data.expectedVersion >= 0, 'INVALID_VERSION', 'Refresh the safety record.');
  return { action: data.action, expectedVersion: data.expectedVersion, note: label(data.note, 'Safety review note', 5, 1000) };
}
export function nextReview(state, action) {
  if (action === 'note') return state;
  if (action === 'acknowledge' && state === 'open') return 'acknowledged';
  if (['resolve', 'false_alarm'].includes(action) && state === 'acknowledged') return action === 'resolve' ? 'resolved' : 'false_alarm';
  if (action === 'reopen' && ['resolved', 'false_alarm'].includes(state)) return 'open';
  check(false, 'INVALID_INPUT', 'Acknowledge an open alert before resolving it. Refresh after another staff action.');
}
