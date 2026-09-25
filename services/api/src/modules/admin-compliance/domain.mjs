import { check } from '../../shared/errors.mjs';
import { fields, label } from '../../shared/validation.mjs';
import { DRIVER_DOCUMENTS, driverDocumentDeadline } from '../../../../../packages/shared/src/driver-onboarding.mjs';

export const EXPIRING_WINDOW = 30 * 86_400_000;
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
export function identifier(value) { check(typeof value === 'string' && uuid.test(value), 'INVALID_INPUT', 'Choose a valid driver reference.'); return value; }
export function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
}
export function filters(input = {}, detail = false) {
  fields(input, detail ? ['before', 'limit'] : ['queue', 'followUp', 'q', 'after', 'limit'], []);
  const limit = input.limit === undefined ? 25 : Number(input.limit);
  check(Number.isInteger(limit) && limit > 0 && limit <= 50 && (input.limit === undefined || /^\d+$/.test(input.limit)), 'INVALID_INPUT', 'Choose a page size from 1 to 50.');
  if (detail) {
    let before = null;
    if (input.before) {
      check(typeof input.before === 'string', 'INVALID_CURSOR', 'Return to the first page.');
      const [stamp, id, extra] = input.before.split('.'), time = Number(stamp);
      check(extra === undefined && /^\d{1,16}$/.test(stamp) && Number.isSafeInteger(time) && time >= 0 && uuid.test(id ?? ''), 'INVALID_CURSOR', 'Return to the first page.');
      before = { time, id };
    }
    return { before, limit };
  }
  const queue = input.queue ?? 'all', followUp = input.followUp ?? 'all';
  check(['all', 'submitted', 'expiring', 'expired', 'missing', 'eligible'].includes(queue), 'INVALID_INPUT', 'Choose a compliance queue.');
  check(['all', 'open', 'overdue', 'done'].includes(followUp), 'INVALID_INPUT', 'Choose a follow-up status.');
  const q = input.q === undefined || input.q === '' ? '' : label(input.q, 'Search', 1, 80);
  return { queue, followUp, q, after: input.after ? identifier(input.after) : null, limit };
}
export function followUp(row, now) {
  return { version: row.followupVersion ?? 0, status: row.followupStatus ?? 'none', dueAt: row.dueAt ?? null,
    note: row.followupNote ?? null, updatedAt: row.followupUpdatedAt ?? null, completedAt: row.completedAt ?? null,
    actor: row.actorId ? { id: row.actorId, name: row.actorName } : null,
    applicationVersion: row.followupApplicationVersion ?? null,
    applicationChanged: row.followupApplicationVersion != null && row.followupApplicationVersion !== row.applicationVersion,
    overdue: row.followupStatus === 'open' && row.dueAt <= now };
}
export function documents(rows, now) {
  return Object.entries(DRIVER_DOCUMENTS).map(([kind, definition]) => {
    const row = rows.find((doc) => doc.kind === kind), deadline = definition.expires && row ? driverDocumentDeadline(row.expiresOn) : null;
    const state = !row ? 'missing' : definition.expires && (deadline ?? 0) <= now ? 'expired'
      : deadline !== null && deadline <= now + EXPIRING_WINDOW ? 'expiring' : 'current';
    return { kind, label: definition.label, expiresOn: row?.expiresOn ?? null, state, deadline };
  });
}
export function summary(row, eligibility, docs, now, canManage) {
  return { id: row.id, name: row.name, vehicle: { model: row.vehicleModel, plate: row.vehiclePlate },
    applicationStatus: row.applicationStatus, updatedAt: row.updatedAt,
    eligibility: { eligible: eligibility.eligible, reviewStatus: eligibility.reviewStatus,
      missing: eligibility.missing, expired: eligibility.expired, validUntil: eligibility.validUntil },
    expiring: docs.filter((doc) => doc.state === 'expiring').map((doc) => doc.kind), followUp: followUp(row, now), capabilities: { canManage } };
}
export function actionData(action, data, now) {
  check(['follow-up', 'complete'].includes(action), 'NOT_FOUND', 'Compliance action not found.');
  fields(data, action === 'follow-up' ? ['expectedVersion', 'dueAt', 'note'] : ['expectedVersion', 'note']);
  check(Number.isSafeInteger(data.expectedVersion) && data.expectedVersion >= 0, 'INVALID_VERSION', 'Use the follow-up version displayed on screen.');
  check(typeof data.note === 'string' && data.note.trim().length >= 5 && data.note.trim().length <= 1000
    && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(data.note), 'INVALID_INPUT', 'Note must contain 5–1000 characters.');
  if (action === 'follow-up') check(Number.isSafeInteger(data.dueAt) && data.dueAt > now && data.dueAt <= now + 365 * 86_400_000,
    'INVALID_INPUT', 'Choose a future follow-up deadline within one year.');
  return { ...data, note: data.note.trim() };
}
