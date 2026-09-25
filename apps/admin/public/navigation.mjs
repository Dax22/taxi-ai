const metadata = {
  overview: ['Overview', 'Nigeria operations, at a glance.', 'analytics.read'], accounts: ['Accounts', 'Know the people behind every journey.', 'accounts.read'],
  account: ['Account details', 'One profile. A complete view of their Taxi Ai activity.', 'accounts.read'], trips: ['Trips', 'Follow each request from its first offer to its final status.', 'trips.read'],
  trip: ['Trip details', 'The people, vehicle and fare behind this journey.', 'trips.read'], analytics: ['Analytics', 'Understand demand, journey outcomes and completed fares.', 'analytics.read'],
  operations: ['Live operations', 'Waiting requests, active journeys and service delays.', 'operations.read'],
  staff: ['Staff access', 'Assign a role and manage access to the operations workspace.', 'staff.manage'],
  audit: ['Staff activity', 'Recorded staff actions and the reasons behind access changes.', 'audit.read'],
  cases: ['Support & safety', 'A shared queue with clear ownership and response deadlines.', 'cases'],
  case: ['Case details', 'Review the evidence, record contact attempts and follow the outcome.', 'cases'],
};
export function canAccess(staff, permission) {
  const granted = staff?.permissions ?? [];
  return permission === 'cases' ? granted.includes('cases.support') || granted.includes('cases.safety') : granted.includes(permission);
}
export const defaultPage = (staff) => [['analytics.read', '/admin'], ['operations.read', '/admin/operations'], ['cases', '/admin/cases'], ['trips.read', '/admin/trips'], ['staff.manage', '/admin/staff']].find(([permission]) => canAccess(staff, permission))?.[1] ?? null;
export function routeFor(location) {
  const path = location.pathname.replace(/\/$/, ''), match = path.match(/^\/admin(?:\/(accounts|trips|analytics|operations|staff|audit|cases)(?:\/([a-f0-9-]{36}))?)?$/);
  if (!match || (match[2] && !['accounts', 'trips', 'cases'].includes(match[1]))) throw new Error('This dashboard page does not exist.');
  const section = match[1] ?? 'overview', name = match[2] ? { accounts: 'account', trips: 'trip', cases: 'case' }[section] : section;
  const query = new URLSearchParams(location.search), endpoint = section === 'overview' ? 'analytics' : section === 'audit' ? 'staff/audit' : section;
  return { path, query, section, name, permission: metadata[name][2], title: metadata[name][0], description: metadata[name][1],
    apiPath: '/api/admin/console/' + endpoint + (match[2] ? '/' + match[2] : '') + (query.size ? '?' + query : '') };
}
