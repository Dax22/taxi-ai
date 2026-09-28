import { check } from '../../shared/errors.mjs';
import { fields, label } from '../../shared/validation.mjs';
import { SAFETY_KINDS } from '../../../../../packages/shared/src/safety.mjs';

export function commandKey(value) {
  check(typeof value === 'string' && /^[A-Za-z0-9_-]{16,128}$/.test(value), 'INVALID_IDEMPOTENCY_KEY', 'A unique command key is required.');
}
export function version(row, expected) {
  check(Number.isSafeInteger(expected) && expected >= 0, 'INVALID_VERSION', 'Use the version displayed on screen.');
  check(row.version === expected, 'STALE_VERSION', 'This record changed. Refresh before acting on it.');
}
export function identifier(value) { return typeof value === 'string' && /^[a-f0-9-]{36}$/.test(value); }
export function contactData(data) {
  fields(data, ['name', 'phone']); const name = label(data.name, 'Contact name', 2, 80), phone = label(data.phone, 'Phone number', 9, 16);
  check(/^\+[1-9]\d{7,14}$/.test(phone), 'INVALID_INPUT', 'Use an international phone number, including + and country code.');
  return { name, phone };
}
export function noteText(value, required = false) {
  check(typeof value === 'string' && value.trim().length >= (required ? 5 : 0) && value.trim().length <= 500
    && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(value), 'INVALID_INPUT', `Use a text note of ${required ? '5–500' : 'up to 500'} characters.`);
  return value.trim();
}
export function incidentData(data) {
  fields(data, ['kind', 'note', 'contactIds', 'vehicleCheckId'], ['kind', 'note', 'contactIds']);
  check(data.vehicleCheckId === undefined || identifier(data.vehicleCheckId),'INVALID_INPUT','Use a valid vehicle check reference.');
  check(typeof data.kind === 'string' && Object.hasOwn(SAFETY_KINDS, data.kind), 'INVALID_INPUT', 'Choose a concern type.');
  const note = noteText(data.note);
  check(Array.isArray(data.contactIds) && data.contactIds.length <= 3 && data.contactIds.every(identifier)
    && new Set(data.contactIds).size === data.contactIds.length, 'INVALID_CONTACTS', 'Choose up to three different saved contacts.');
  return { kind: data.kind, note, contactIds: [...data.contactIds].sort(),...(data.vehicleCheckId ? {vehicleCheckId:data.vehicleCheckId} : {}) };
}
export function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
}

export function notificationTransition(row, outcome, open, contactActive) {
  check(['sent', 'delivered', 'failed', 'retry'].includes(outcome), 'INVALID_OUTCOME', 'Choose a test notification outcome.');
  let attempts = row.attempts, status = outcome;
  if (outcome === 'retry') {
    check(row.status === 'failed' && open && contactActive && attempts < 3, 'NOTIFICATION_CLOSED', 'Only a failed alert with an active contact and open incident can be retried, up to three attempts.');
    status = 'queued';
  } else if (row.status === 'queued') {
    check(open && contactActive && attempts < 3 && ['sent', 'failed'].includes(outcome), 'NOTIFICATION_CLOSED', 'A queued test alert must be sent or fail before delivery can be simulated.');
    attempts++;
  } else check(row.status === 'sent' && ['delivered', 'failed'].includes(outcome), 'NOTIFICATION_CLOSED', 'This outcome is not available for the current test alert.');
  return { status, attempts };
}
