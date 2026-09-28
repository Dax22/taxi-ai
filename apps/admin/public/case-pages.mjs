import { el, link, badge, panel, table, empty, filterForm, detailsList, date } from './ui.mjs';
import { actionForm, reasonField } from './forms.mjs';

const statuses = [['open', 'Open'], ['in_progress', 'In progress'], ['waiting', 'Waiting for a response'], ['resolved', 'Resolved']];
const priorities = [['urgent', 'Urgent'], ['high', 'High'], ['normal', 'Normal'], ['low', 'Low']];
const ref = (id) => id.slice(0, 8).toUpperCase();
function deadline(item, now) {
  if (item.firstRespondedAt) return `First handling ${date(item.firstRespondedAt)}`;
  if (item.status === 'resolved') return 'Resolved';
  const overdue = item.responseDueAt < now;
  return el('span', `${overdue ? 'Overdue · ' : 'Due '}${date(item.responseDueAt)}`, overdue ? 'overdue' : '');
}
export function cases(data, route) {
  const result = el('div'), categories = [];
  if (data.permissions.support) categories.push(['support', 'Support']); if (data.permissions.safety) categories.push(['safety', 'Safety']);
  result.append(filterForm(route, [{ name: 'category', label: 'Category', options: [['all', 'All permitted categories'], ...categories] },
    { name: 'status', label: 'Case status', options: [['all', 'All statuses'], ...statuses] }, { name: 'priority', label: 'Priority', options: [['all', 'All priorities'], ...priorities] },
    { name: 'assigned', label: 'Assignment', options: [['all', 'All assignments'], ['me', 'Assigned to me'], ['unassigned', 'Unassigned']] }]));
  const queue = panel('Case queue', 'Only cases within your staff role are visible.');
  if (data.cases.length) queue.append(table(['Case', 'Category', 'Priority', 'Status', 'Assigned to', 'First handling target', 'Updated'], data.cases.map((item) => {
    const name = el('div'); name.append(link(item.subject, '/admin/cases/' + item.id), el('span', ref(item.id), 'subtext'));
    return [name, badge(item.category), badge(item.priority), badge(item.status), item.assignedTo?.name ?? 'Unassigned', deadline(item, data.serverNow), date(item.updatedAt)];
  }), 'Support and safety cases'));
  else queue.append(empty('No cases match these filters', 'New customer support and safety cases will appear in this queue.'));
  if (data.page.next) { const query = new URLSearchParams(route.query); query.set('before', data.page.next); queue.append(link('Older cases →', route.path + '?' + query, 'button secondary')); }
  result.append(queue);
  const create = panel('Open a case', 'Connect the report to a journey and record the issue.');
  create.append(actionForm({ title: 'New support or safety case', action: '/api/admin/console/cases', submit: 'Create case', fields: [
    { name: 'category', label: 'Category', options: categories }, { name: 'rideId', label: 'Full journey reference', min: 36, max: 36 },
    { name: 'subject', label: 'Short subject', min: 5, max: 120 }, { name: 'description', label: 'What happened?', multiline: true, min: 5, max: 2000, help: 'Include relevant facts. Keep payment credentials and unnecessary personal details out of notes.' },
    { name: 'priority', label: 'Priority', options: priorities, value: 'normal' },
  ] })); result.append(create, el('p', 'A case records the team’s work. It does not contact emergency services. Record actual contact attempts and their outcomes in the case.', 'definition-note'));
  return result;
}
export function caseDetail(data, route, staff) {
  const item = data.case, result = el('div'), endpoint = '/api/admin/console/cases/' + item.id;
  result.append(link('← Back to cases', '/admin/cases', 'text-link'));
  const summary = panel(item.subject, `Case ${ref(item.id)} · Version ${item.version}`);
  summary.append(el('p', item.description, 'case-description'), detailsList([
    ['Category', badge(item.category)], ['Priority', badge(item.priority)], ['Status', badge(item.status)], ['Assigned to', item.assignedTo?.name ?? 'Unassigned'],
    ['Opened', date(item.createdAt)], ['First handling', deadline(item, data.serverNow)], ['Resolved', date(item.resolvedAt)], ['Journey reference', item.rideId],
  ])); result.append(summary);
  const trip = panel('Journey evidence', 'Case access does not provide booking, payment or location-sharing authority.');
  if (item.trip) {
    trip.append(detailsList([['Status', badge(item.trip.status)], ['Pickup', item.trip.pickup], ['Destination', item.trip.destination],
      ['Passenger', item.trip.customer?.name ?? 'Not recorded'], ['Driver', item.trip.driver?.name ?? 'Not assigned']]));
    const vehicle = item.trip.driver?.vehicle;
    if (vehicle) trip.append(el('p', [vehicle.colour, vehicle.make, vehicle.model, vehicle.plate].filter(Boolean).join(' · '), 'definition-note'));
    if (staff?.permissions?.includes('trips.read')) trip.append(link('Open journey record ↗', '/admin/trips/' + item.rideId, 'text-link'));
  } else trip.append(empty('Journey evidence unavailable', 'No journey details are available for this case.'));
  result.append(trip);
  if (item.incident) {
    const incident = item.incident, evidence = panel('Recorded safety report', 'This is the saved incident evidence. It is not a live location feed.');
    evidence.append(detailsList([['Type', incident.kind], ['Report status', badge(incident.status)], ['Recorded', date(incident.recordedAt)], ['Reported by', incident.reporter ? `${incident.reporter.name} · ${incident.reporter.role}` : 'Not recorded']]));
    if (incident.note) evidence.append(el('p', incident.note, 'case-description'));
    if (incident.location) {
      const p = incident.location; evidence.append(el('p', `Saved location: ${p.lat}, ${p.lng}. Recorded ${date(p.capturedAt)}. Source: ${p.source}. ${p.stale ? 'Marked stale when recorded.' : 'Review the recorded time before relying on this point.'}`, 'definition-note'));
    } else evidence.append(el('p', 'No location was recorded with this report.', 'definition-note'));
    if (incident.notifications?.length) evidence.append(table(['Channel', 'Recorded status', 'Mode', 'Attempts', 'Updated'], incident.notifications.map((entry) => [entry.channel ?? 'Alert provider', entry.status, entry.mode, entry.attempts, date(entry.updatedAt)]), 'Recorded incident notification attempts'));
    evidence.append(el('p', 'Simulation statuses are test records. A provider acceptance is not proof that someone received or read an alert.', 'definition-note'));
    result.append(evidence);
  }
  if (item.capabilities?.canManage) {
    const controls = panel('Manage this case', 'Changes are checked against the current case version. Record an outcome before resolving.');
    controls.append(actionForm({ title: 'Assign responsibility', action: endpoint + '/assign', data: { expectedVersion: item.version }, fields: [
      { name: 'assigneeId', label: 'Assigned staff member', options: [['', 'Unassigned'], ...data.eligibleStaff.map((person) => [person.id, person.name])], required: false, value: item.assignedTo?.id ?? '' }, reasonField,
    ] }));
    controls.append(actionForm({ title: 'Update status', action: endpoint + '/status', data: { expectedVersion: item.version }, fields: [{ name: 'status', label: 'New status', options: [['', 'Choose a new status'], ...statuses.filter(([value]) => item.status === 'resolved' ? value === 'open' : value !== 'open' && value !== item.status)], value: '' }, reasonField] }));
    controls.append(actionForm({ title: 'Update priority', action: endpoint + '/priority', data: { expectedVersion: item.version }, fields: [{ name: 'priority', label: 'Priority', options: [['', 'Choose a new priority'], ...priorities.filter(([value]) => value !== item.priority)], value: '' }, reasonField] }));
    controls.append(actionForm({ title: 'Record a note or contact attempt', action: endpoint + '/note', data: { expectedVersion: item.version }, submit: 'Save case note', fields: [
      { name: 'body', label: 'Facts, action taken and outcome', min: 1, max: 2000, multiline: true, help: 'For an escalation, include who was contacted, when, and whether contact was confirmed.' },
    ] })); result.append(controls);
  }
  const timeline = panel('Case history', 'Newest recorded actions first.'), events = el('ol', null, 'timeline');
  for (const entry of data.events) { const row = el('li'); row.append(el('strong', entry.action.replaceAll('_', ' ')), el('p', `${entry.actor?.name ?? 'System'} · ${date(entry.createdAt)}`)); if (entry.note) row.append(el('p', entry.note, 'case-description')); events.append(row); }
  if (!data.events.length) timeline.append(empty('No case history', 'Actions will appear here after they are recorded.')); else timeline.append(events);
  if (data.page.next) { const query = new URLSearchParams(route.query); query.set('before', data.page.next); timeline.append(link('Older history →', route.path + '?' + query, 'button secondary')); }
  result.append(timeline); return result;
}
