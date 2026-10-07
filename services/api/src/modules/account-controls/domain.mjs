import { check } from '../../shared/errors.mjs';
import { fields, label } from '../../shared/validation.mjs';

// Taxi AI staff moderation rules. No changes to server users or operating-system permissions.
export const SCOPES = ['customer','driver','vendor','vehicle','account','store'];
export const REASONS = ['safety','fraud_review','conduct','documents','service_quality','security','other'];
export const uuid = value => typeof value === 'string' && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(value);
export function id(value) { check(uuid(value), 'INVALID_INPUT', 'Choose a valid record.'); return value; }
export function key(value) { check(typeof value === 'string' && /^[A-Za-z0-9_-]{16,128}$/.test(value), 'INVALID_IDEMPOTENCY_KEY', 'Use a unique action key.'); return value; }
export function version(value) { const n = typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : value; check(Number.isSafeInteger(n) && n >= 0, 'INVALID_VERSION', 'Refresh the current record version.'); return n; }
export function effective(row, now) { return row.status === 'active' && (row.expiresAt === null || row.expiresAt > now); }
export function visible(row, now, privateRead = false) {
  const value = { id: row.id, subjectType: row.subjectType, subjectId: row.subjectId, scope: row.scope, kind: row.kind,
    status: row.status === 'active' && !effective(row, now) ? 'expired' : row.status, notice: row.notice,
    expiresAt: row.expiresAt, reviewAt: row.reviewAt, createdAt: row.createdAt, updatedAt: row.updatedAt, version: row.version };
  return privateRead ? { ...value, reasonCode: row.reasonCode, privateReason: row.privateReason,
    caseReference: row.caseReference, createdBy: row.createdBy, updatedBy: row.updatedBy } : value;
}
export function restrictionInput(data, now) {
  fields(data, ['subjectType','subjectId','scope','kind','reasonCode','reason','notice','caseReference','expiresAt','reviewAt','confirmation']);
  check(['account','store'].includes(data.subjectType), 'INVALID_INPUT', 'Choose an account or store.'); id(data.subjectId);
  check(SCOPES.includes(data.scope) && (data.subjectType === 'store' ? data.scope === 'store' : data.scope !== 'store'), 'INVALID_INPUT', 'Choose a matching restriction scope.');
  check(['warning','suspension'].includes(data.kind) && REASONS.includes(data.reasonCode), 'INVALID_INPUT', 'Choose a restriction type and reason.');
  check(data.confirmation === 'CONFIRM', 'INVALID_CONFIRMATION', 'Type CONFIRM after reviewing the active-work impact.');
  const timestamp = value => value === '' || value === null ? null : typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : value;
  const expiresAt = timestamp(data.expiresAt), reviewAt = timestamp(data.reviewAt);
  check(expiresAt === null || Number.isSafeInteger(expiresAt) && expiresAt > 0 && (now === null || expiresAt > now && expiresAt <= now + 366 * 86400000),
    'INVALID_INPUT', 'Expiry must be in the next 366 days or unset for manual review.');
  check(Number.isSafeInteger(reviewAt) && reviewAt > 0 && (now === null || reviewAt > now && reviewAt <= now + 30 * 86400000),
    'INVALID_INPUT', 'A review date within 30 days is required.');
  return { subjectType: data.subjectType, subjectId: data.subjectId, scope: data.scope, kind: data.kind, reasonCode: data.reasonCode,
    privateReason: label(data.reason, 'Internal reason', 10, 1000), notice: label(data.notice, 'Account notice', 10, 500),
    caseReference: label(data.caseReference, 'Case or evidence reference', 3, 160), expiresAt, reviewAt };
}
export function listInput(query = {}) {
  fields(query, ['subjectType','subjectId','before','limit'], []);
  const subjectType = query.subjectType || null, subjectId = query.subjectId || null;
  check(!subjectType || ['account','store'].includes(subjectType), 'INVALID_INPUT', 'Invalid subject filter.');
  if (subjectId) id(subjectId);
  check(Boolean(subjectType) === Boolean(subjectId), 'INVALID_INPUT', 'Select both subject type and identifier.');
  const limit = query.limit === undefined ? 25 : Number(query.limit);
  check(Number.isInteger(limit) && limit >= 1 && limit <= 100, 'INVALID_INPUT', 'Choose 1–100 records.');
  let before = null;
  if (query.before) { const parts = query.before.split('.'), [time, record] = parts; check(/^\d+$/.test(time) && uuid(record) && parts.length === 2, 'INVALID_INPUT', 'Invalid cursor.'); before = { time: Number(time), id: record }; check(Number.isSafeInteger(before.time), 'INVALID_INPUT', 'Invalid cursor.'); }
  return { subjectType, subjectId, limit, before };
}
export function scopesFor(staff) { return staff.role === 'owner' ? SCOPES : staff.role === 'safety' ? SCOPES.filter(scope => scope !== 'account') : staff.role === 'operations' ? ['driver','vehicle','vendor','store'] : []; }
