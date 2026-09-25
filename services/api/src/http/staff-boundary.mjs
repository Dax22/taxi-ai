import { check } from '../shared/errors.mjs';

/** Authorize legacy privilege routes too; a second URL is not an MFA bypass. */
export function staffPermission(path, user, staff) {
  if (path === '/api/admin/console/login') return null;
  if (path === '/api/admin/console/session' || /^\/api\/admin\/console\/staff\/mfa\/(enroll|confirm|verify)$/.test(path)) return 'session';
  if (path.startsWith('/api/admin/console/staff/audit')) return 'audit.read';
  if (path.startsWith('/api/admin/console/staff')) return 'staff.manage';
  if (path === '/api/admin/console/operations') return 'operations.read';
  if (path === '/api/admin/console/demand' || path === '/api/admin/console/demand/coverage') return 'demand.read';
  if (path === '/api/admin/console/finance' || path.startsWith('/api/admin/console/finance/')) return 'finance.read';
  if (path === '/api/admin/console/compliance' || path.startsWith('/api/admin/console/compliance/')) {
    return /\/(follow-up|complete)$/.test(path) ? 'compliance.manage' : 'compliance.read';
  }
  if (path === '/api/admin/console/cases' || path.startsWith('/api/admin/console/cases/')) {
    return staff?.permissions.includes('cases.safety') ? 'cases.safety' : 'cases.support';
  }
  for (const [section, permission] of [['accounts','accounts.read'], ['trips','trips.read'], ['analytics','analytics.read']]) {
    if (path === `/api/admin/console/${section}` || path.startsWith(`/api/admin/console/${section}/`)) return permission;
  }
  if (path.startsWith('/api/admin/') || path === '/api/eats/admin/stores' || /^\/api\/eats\/stores\/[^/]+\/review$/.test(path)) return 'legacy.review';
  if (user?.role === 'admin' && (path.startsWith('/api/eats/') || path.startsWith('/api/driver-documents/') || path.startsWith('/api/safety/incidents/'))) return 'legacy.review';
  return null;
}

export async function authorizeStaffRequest(access, user, token, path) {
  const initial = staffPermission(path, user);
  if (!initial) return null;
  check(user, 'UNAUTHENTICATED', 'Sign in to continue.');
  const staff = await access.describe(user.id, { sessionToken: token });
  const permission = staffPermission(path, user, staff);
  if (permission !== 'session') await access.authorize(user.id, permission, { sessionToken: token });
  return staff;
}
