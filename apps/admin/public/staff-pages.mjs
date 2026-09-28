import { el, badge, panel, table, empty, date, link, filterForm } from './ui.mjs';
import { actionForm, reasonField } from './forms.mjs';

export function staff(data) {
  const result = el('div');
  result.append(el('p', 'Staff roles apply to this workspace. Removing staff access does not delete a customer account. Changes take effect on the next request; session revocation also signs the account out.', 'definition-note'));
  const roles = data.roles.filter((role) => role.assignable !== false).map((role) => [role.id, role.label]);
  const grant = panel('Add a staff member', 'The person must already have a Taxi Ai account.');
  grant.append(actionForm({ title: 'Assign initial access', action: '/api/admin/console/staff/assign', data: { expectedVersion: 0 }, submit: 'Assign staff role', fields: [
    { name: 'email', label: 'Registered email', type: 'email', max: 254 }, { name: 'role', label: 'Staff role', options: roles }, reasonField,
  ] })); result.append(grant);
  const directory = panel('Staff directory', 'Only grant the permissions needed for each person’s work.');
  if (!data.items.length) directory.append(empty('No staff entries', 'Existing administrator access is managed through the owner account.'));
  for (const item of data.items) {
    const member = el('section', null, 'staff-entry'); member.append(el('h3', item.name), el('p', item.email, 'muted'), badge(item.status), el('p', `${item.role} · ${item.mfaEnrolled ? 'Authenticator enrolled' : 'Authenticator not enrolled'} · Updated ${date(item.updatedAt)}`, 'small muted'));
    if (item.userId === data.viewerId) { member.append(el('p', 'This is your staff account. Use Security to manage your authenticator or Sign out to end this session. Another owner must change your access or revoke all your sessions.', 'definition-note')); directory.append(member); continue; }
    const controls = el('details', null, 'staff-controls'); controls.append(el('summary', `Manage access for ${item.name}`));
    controls.append(actionForm({ title: 'Change staff role', action: '/api/admin/console/staff/assign', data: { email: item.email, expectedVersion: item.version }, fields: [{ name: 'role', label: 'Staff role', options: item.ownerEligible ? data.roles.map((role) => [role.id, role.label]) : roles, value: item.role }, reasonField] }));
    if (item.status === 'active') controls.append(actionForm({ title: 'Remove staff access', action: '/api/admin/console/staff/revoke', data: { userId: item.userId, expectedVersion: item.version }, submit: 'Remove staff access', danger: true, fields: [reasonField] }));
    controls.append(actionForm({ title: 'Sign out all sessions', action: '/api/admin/console/staff/revoke-sessions', data: { userId: item.userId, expectedVersion: item.version }, submit: 'Revoke account sessions', danger: true, fields: [reasonField] }));
    member.append(controls); directory.append(member);
  }
  result.append(directory);
  const reference = panel('Role permissions'); reference.append(table(['Role', 'Permitted work'], data.roles.map((role) => [role.label, role.permissions.join(', ')]), 'Staff role permissions')); result.append(reference);
  return result;
}
export function audit(data, route) {
  const result = el('div'), content = panel('Staff activity log', 'Newest recorded actions first.');
  result.append(filterForm(route, [{ name: 'q', label: 'Search activity', type: 'search', placeholder: 'Name, action or reference' }]));
  if (data.items.length) content.append(table(['When', 'Staff member', 'Action', 'Subject', 'Recorded detail'], data.items.map((item) => [date(item.createdAt), item.actorName ?? item.actorId ?? 'System', item.action, item.subjectName ?? item.subjectId ?? '—', typeof item.detail === 'string' ? item.detail : JSON.stringify(item.detail)]), 'Staff access and operational activity'));
  else content.append(empty('No recorded actions', 'Staff actions will appear here when they are recorded.'));
  if (data.nextBefore) { const query = new URLSearchParams(route.query); query.set('before', data.nextBefore); content.append(link('Older activity →', route.path + '?' + query, 'button secondary')); }
  result.append(content); return result;
}
