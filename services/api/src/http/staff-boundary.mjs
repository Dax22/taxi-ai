import { check } from '../shared/errors.mjs';

/** Authorize legacy privilege routes too; a second URL is not an MFA bypass. */
export function staffPermission(path, user, staff) {
  if (path === '/api/admin/console/login') return null;
  if (path === '/api/admin/console/session' || /^\/api\/admin\/console\/staff\/mfa\/(enroll|confirm|verify)$/.test(path)) return 'session';
  if (path.startsWith('/api/admin/console/staff/audit')) return 'audit.read';
  if (path.startsWith('/api/admin/console/staff')) return 'staff.manage';
  for (const [section,permission] of [['transactions','transactions.read'],['transactions-export','transactions.export'],['people','people.read'],['businesses','businesses.read'],['live','operations.location'],['diagnosis','operations.read'],['work','work.manage'],['insights','analytics.read'],['brief','operations.read'],['platform','platform.read'],['reports','reports.manage'],['campaigns','growth.manage'],['access-audit','audit.read'],['restrictions','moderation.read'],['restriction-impact','moderation.manage']]) {
    if (path === `/api/admin/console/${section}` || path.startsWith(`/api/admin/console/${section}/`)) return permission;
  }
  if (path === '/api/admin/console/safety-alerts' || path.startsWith('/api/admin/console/safety-alerts/')) return 'cases.safety';
  if (path === '/api/admin/console/operations' || path === '/api/admin/console/matching') return 'operations.read';
  if (path === '/api/admin/console/acceptance') return 'acceptance.read';
  if (/^\/api\/admin\/console\/acceptance\/[a-z0-9_.-]{3,80}\/result$/.test(path)) return 'acceptance.manage';
  if (path === '/api/admin/console/investigations') return 'investigations.read';
  if (path === '/api/admin/console/investigations/export') return 'investigations.export';
  if (path === '/api/admin/console/mobile') return 'mobile.read';
  if (/^\/api\/admin\/console\/mobile\/devices\/[a-f0-9-]{36}\/revoke$/.test(path)) return 'mobile.manage';
  if (path === '/api/admin/console/announcements' || path.startsWith('/api/admin/console/announcements/')) return 'announcements.manage';
  if (path === '/api/admin/console/demand' || path === '/api/admin/console/demand/coverage') return 'demand.read';
  if (path === '/api/admin/console/finance' || path.startsWith('/api/admin/console/finance/')) return 'finance.read';
  if (path === '/api/admin/console/compliance' || path.startsWith('/api/admin/console/compliance/')) {
    return /\/(follow-up|complete|approve-exception)$/.test(path) ? 'compliance.manage' : 'compliance.read';
  }
  if (path === '/api/admin/console/cases' || path.startsWith('/api/admin/console/cases/')) {
    return staff?.permissions.includes('cases.safety') ? 'cases.safety' : 'cases.support';
  }
  for (const [section, permission] of [['accounts','accounts.read'], ['trips','trips.read'], ['analytics','analytics.read']]) {
    if (path === `/api/admin/console/${section}` || path.startsWith(`/api/admin/console/${section}/`)) return permission;
  }
  if (path.startsWith('/api/admin/') || ['/api/eats/admin/stores', '/api/eats/admin/photos'].includes(path) || /^\/api\/eats\/(stores|photos)\/[^/]+\/review$/.test(path)) return 'legacy.review';
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
