import { check } from '../../shared/errors.mjs';
import { fields, label, emailAddress } from '../../shared/validation.mjs';

export const PERMISSIONS = Object.freeze(['staff.manage','audit.read','operations.read','accounts.read','trips.read','analytics.read','cases.support','cases.safety','legacy.review']);
export const ROLES = Object.freeze([
  { id: 'owner', label: 'Owner', permissions: PERMISSIONS },
  { id: 'operations', label: 'Operations', permissions: ['operations.read','trips.read'] },
  { id: 'support', label: 'Support', permissions: ['cases.support','accounts.read','trips.read'] },
  { id: 'safety', label: 'Safety', permissions: ['cases.safety','accounts.read','trips.read'] },
  { id: 'finance', label: 'Finance', permissions: ['analytics.read'] },
].map((role) => Object.freeze({ ...role, permissions: Object.freeze(role.permissions) })));
export const MFA_STEPUP_MS = 15 * 60_000;
export const MFA_SETUP_MS = 10 * 60_000;
export function permissions(role) { return ROLES.find((entry) => entry.id === role)?.permissions ?? []; }
export function id(value) { check(typeof value === 'string' && /^[a-f0-9-]{36}$/.test(value), 'INVALID_INPUT', 'Choose a valid staff account.'); return value; }
export function commandInput(action, data, key) {
  check(typeof key === 'string' && /^[A-Za-z0-9_-]{16,128}$/.test(key), 'INVALID_IDEMPOTENCY_KEY', 'A unique request key is required.');
  const assign = action === 'assign';
  check(['assign','revoke','revoke-sessions'].includes(action), 'INVALID_INPUT', 'Choose a staff action.');
  fields(data, assign ? ['email','role','expectedVersion','reason'] : ['userId','expectedVersion','reason']);
  check(Number.isSafeInteger(data.expectedVersion) && data.expectedVersion >= 0, 'INVALID_VERSION', 'Refresh the staff list before changing access.');
  const common = { expectedVersion: data.expectedVersion, reason: label(data.reason, 'Reason', 2, 500) };
  if (!assign) return { ...common, userId: id(data.userId) };
  check(ROLES.some((role) => role.id === data.role), 'INVALID_ROLE', 'Choose a staff role.');
  return { ...common, email: emailAddress(data.email), role: data.role };
}
export function codeInput(data) {
  fields(data, ['code']);
  check(typeof data.code === 'string' && /^\d{6}$/.test(data.code), 'INVALID_INPUT', 'Enter the six-digit authenticator code.');
  return data.code;
}
export function auditFilters(query = {}) {
  fields(query, ['before','limit','q'], []);
  const q = query.q === undefined || query.q === '' ? '' : label(query.q, 'Search', 1, 100);
  const limit = query.limit === undefined ? 50 : Number(query.limit);
  const before = query.before === undefined ? Number.MAX_SAFE_INTEGER : Number(query.before);
  check(Number.isSafeInteger(limit) && limit >= 1 && limit <= 100 && Number.isSafeInteger(before) && before > 0,
    'INVALID_INPUT', 'Use a valid audit page cursor and a limit from 1 to 100.');
  return { before, limit, q };
}
