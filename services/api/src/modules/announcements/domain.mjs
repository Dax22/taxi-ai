import { check } from '../../shared/errors.mjs';
import { fields, label } from '../../shared/validation.mjs';

export const ANNOUNCEMENT_AUDIENCES = Object.freeze([
  { id: 'all', label: 'All Taxi Ai users' },
  { id: 'customers', label: 'Customer-only accounts' },
  { id: 'drivers', label: 'Drivers and delivery workers' },
  { id: 'eats_sellers', label: 'Eats sellers' },
]);
export const ANNOUNCEMENT_PRIORITIES = Object.freeze([
  { id: 'normal', label: 'Normal' },
  { id: 'important', label: 'Important' },
  { id: 'critical', label: 'Critical service notice' },
]);
const ids = (list) => list.map((item) => item.id);
export function announcementId(value) {
  check(typeof value === 'string' && /^[a-f0-9-]{36}$/.test(value), 'INVALID_INPUT', 'Choose a valid announcement.');
  return value;
}
function message(value) {
  check(typeof value === 'string', 'INVALID_INPUT', 'Announcement message is required.');
  const text = value.trim();
  check(text.length >= 2 && text.length <= 500 && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(text),
    'INVALID_INPUT', 'Announcement message must contain 2–500 characters.');
  return text;
}
export function announcementDraft(data) {
  fields(data, ['title','body','audience','priority','expiresInHours'], ['title','body','audience','priority']);
  check(ids(ANNOUNCEMENT_AUDIENCES).includes(data.audience), 'INVALID_INPUT', 'Choose a valid announcement audience.');
  check(ids(ANNOUNCEMENT_PRIORITIES).includes(data.priority), 'INVALID_INPUT', 'Choose a valid announcement priority.');
  const hours = data.expiresInHours === undefined || data.expiresInHours === '' ? 168 : Number(data.expiresInHours);
  check(Number.isSafeInteger(hours) && hours >= 1 && hours <= 720, 'INVALID_INPUT', 'Choose an expiry from 1 to 720 hours.');
  return { title: label(data.title, 'Title', 2, 80), body: message(data.body), audience: data.audience,
    priority: data.priority, expiresInHours: hours };
}
export function announcementAction(action, data, key) {
  check(['publish','cancel'].includes(action), 'INVALID_INPUT', 'Choose an announcement action.');
  check(typeof key === 'string' && /^[A-Za-z0-9_-]{16,128}$/.test(key), 'INVALID_IDEMPOTENCY_KEY', 'A unique request key is required.');
  fields(data, ['expectedVersion','reason']);
  check(Number.isSafeInteger(data.expectedVersion) && data.expectedVersion > 0, 'INVALID_VERSION', 'Refresh the announcement before changing it.');
  return { expectedVersion: data.expectedVersion, reason: label(data.reason, 'Reason', 5, 500) };
}
