import { el, link, badge, panel, cards, table, empty, filterForm, detailsList, count, date } from './ui.mjs';
import { actionForm } from './forms.mjs';

const documentName = (kind) => ({ profile_photo: 'Driver photo', driving_licence: 'Driving licence', vehicle_registration: 'Vehicle document', insurance: 'Insurance document', vehicle_photo: 'Vehicle photo' })[kind] ?? kind.replaceAll('_', ' ');
const names = (values) => values.length ? values.map(documentName).join(', ') : 'None';
const taskNote = () => el('p', 'Follow-ups are internal staff tasks. Saving a task does not send an email, text message or push notification to the driver. Completing a task does not approve an application or change driver eligibility.', 'scope-notice');
function followUpLabel(task) {
  const box = el('div'); box.append(el('strong', task.status === 'none' ? 'No follow-up' : task.status === 'done' ? 'Completed' : task.overdue ? 'Overdue' : 'Open', task.overdue ? 'overdue' : ''));
  if (task.dueAt) box.append(el('span', `Due ${date(task.dueAt)}`, 'subtext')); return box;
}
function nextPage(page, route, cursorName, length) {
  const row = el('div', null, 'pagination'), controls = el('div'), first = new URLSearchParams(route.query); first.delete(cursorName);
  row.append(el('span', `${count(length)} records on this page`)); controls.append(link('First page', route.path + (first.size ? '?' + first : ''), 'button quiet'));
  if (page.next) { const query = new URLSearchParams(route.query); query.set(cursorName, page.next); controls.append(link('Next →', route.path + '?' + query, 'button secondary')); }
  row.append(controls); return row;
}
export function compliance(data, route) {
  const result = el('div'), summary = data.summary;
  result.append(filterForm(route, [
    { name: 'queue', label: 'Driver queue', options: [['all', 'All drivers'], ['submitted', 'Awaiting application review'], ['expiring', 'Documents expiring soon'], ['expired', 'Expired documents'], ['missing', 'Missing documents'], ['eligible', 'Eligible drivers']] },
    { name: 'followUp', label: 'Internal follow-up', options: [['all', 'All tasks'], ['open', 'Open tasks'], ['overdue', 'Overdue tasks'], ['done', 'Completed tasks']] },
    { name: 'q', label: 'Driver or vehicle', type: 'search', placeholder: 'Driver name or plate', maxLength: 80 },
  ], data.filters));
  result.append(cards([
    ['Awaiting application review', count(summary.submitted), 'Submitted driver applications', true],
    ['Expiring documents', count(summary.expiring), 'Drivers with a deadline in the next 30 days'],
    ['Expired / missing documents', `${count(summary.expired)} / ${count(summary.missing)}`, 'Driver counts · categories can overlap'],
    ['Overdue follow-ups', count(summary.overdueFollowUps), `${count(summary.openFollowUps)} open internal tasks`],
  ]), el('p', `${count(summary.all)} drivers · ${count(summary.eligible)} eligible. Summary counts use the driver search across all queues. A driver may appear in more than one document queue. Eligibility does not mean a driver is online or available.`, 'definition-note'));
  const queue = panel('Driver compliance queue', 'Document status and application approval are separate checks. Open a driver to record a follow-up.');
  queue.append(data.drivers.length ? table(['Driver / vehicle', 'Application', 'Eligibility', 'Documents to review', 'Internal follow-up'], data.drivers.map((driver) => {
    const identity = el('div'); identity.append(link(driver.name + ' ↗', '/admin/compliance/' + driver.id), el('span', `${driver.vehicle?.model ?? 'Vehicle not recorded'} · ${driver.vehicle?.plate ?? 'No plate'}`, 'subtext'));
    const issues = el('div'); issues.append(el('span', 'Missing: ' + names(driver.eligibility.missing)), el('span', 'Expired: ' + names(driver.eligibility.expired), 'subtext'), el('span', 'Expiring: ' + names(driver.expiring), 'subtext'));
    return [identity, badge(driver.applicationStatus), driver.eligibility.eligible ? 'Eligible' : 'Not eligible', issues, followUpLabel(driver.followUp)];
  }), 'Driver document and internal follow-up queue') : empty('No drivers match these filters', 'Change the queue, follow-up status or search to review another group.'));
  queue.append(nextPage(data.page, route, 'after', data.drivers.length)); result.append(queue, taskNote()); return result;
}
export function complianceDetail(data, route, staff) {
  const result = el('div'), driver = data.driver, followUp = driver.followUp;
  result.append(link('← Driver compliance', '/admin/compliance', 'text-link'), taskNote());
  const profile = panel(driver.name, 'Driver reference: ' + driver.id);
  profile.append(detailsList([
    ['Application status', badge(driver.applicationStatus)], ['Eligibility', driver.eligibility.eligible ? 'Eligible' : 'Not eligible'],
    ['Vehicle', driver.vehicle?.model ?? 'Not recorded'], ['Plate', driver.vehicle?.plate ?? 'Not recorded'],
    ['Document validity ends', date(driver.eligibility.validUntil)], ['Application updated', date(driver.updatedAt)],
  ]));
  if (staff?.permissions?.includes('legacy.review')) profile.append(link('Open application review workspace ↗', '/app', 'text-link'));
  result.append(profile);
  const docs = panel('Document status', 'Expiry dates follow Nigeria time (WAT). Private document images and identification numbers are not displayed here.');
  docs.append(table(['Document', 'Status', 'Expiry date', 'Validity deadline · WAT'], data.documents.map((document) => [document.label, badge(document.state), document.expiresOn ?? 'Not recorded', date(document.deadline)]), 'Required driver documents'));
  result.append(docs);
  const task = panel('Internal follow-up', followUp.status === 'none' ? 'No follow-up has been recorded.' : `Version ${followUp.version} · ${followUp.overdue ? 'Overdue' : followUp.status}`);
  if (followUp.applicationChanged) task.append(el('p', 'Application changed since this follow-up was recorded; review the current documents.', 'scope-notice'));
  if (followUp.status !== 'none') task.append(detailsList([
    ['Due', date(followUp.dueAt)], ['Last recorded by', followUp.actor?.name ?? 'Staff member'], ['Last updated', date(followUp.updatedAt)], ['Completed', date(followUp.completedAt)],
  ]), el('p', followUp.note, 'case-description'));
  if (driver.capabilities.canManage && staff?.permissions?.includes('compliance.manage')) {
    const data = { expectedVersion: followUp.version }, note = { name: 'note', label: 'Follow-up note', min: 5, max: 1000, multiline: true };
    task.append(actionForm({ title: followUp.status === 'open' ? 'Update internal follow-up' : 'Schedule internal follow-up', action: `/api/admin/console/compliance/${driver.id}/follow-up`, data,
      submit: 'Save internal task', fields: [{ name: 'dueAt', label: 'Due date and time · Nigeria (WAT)', type: 'datetime-local', convert: 'wat', help: 'Enter Nigeria time (UTC+1), even if your computer uses another time zone. Choose a future time within one year.' }, note] }));
    if (followUp.status === 'open') task.append(actionForm({ title: 'Complete this follow-up', action: `/api/admin/console/compliance/${driver.id}/complete`, data,
      submit: 'Mark task complete', fields: [{ ...note, label: 'Outcome / completion note' }] }));
  }
  result.append(task);
  const review = panel('Latest application review', 'Application approval is handled in the existing review workspace.');
  if (data.review) review.append(detailsList([
    ['Decision', data.review.decision], ['Reviewed', date(data.review.reviewedAt)], ['Reference', data.review.reference ?? 'Not recorded'], ['Method', data.review.method ?? 'Not recorded'],
  ]), el('p', data.review.reason ?? '', 'case-description'));
  else review.append(el('p', 'No application review has been recorded.', 'definition-note')); result.append(review);
  const history = panel('Follow-up history', 'Recorded internal actions · newest first.');
  history.append(data.events.length ? table(['Recorded', 'Action', 'Staff member', 'Due', 'Note'], data.events.map((event) => [date(event.createdAt), event.action.replaceAll('_', ' '), event.actor?.name ?? 'Staff member', date(event.dueAt), event.note]), 'Internal follow-up history') : empty('No follow-up history', 'Scheduled tasks and completion notes will appear here.'));
  history.append(nextPage(data.page, route, 'before', data.events.length)); result.append(history);
  const application = panel('Application history', 'Up to 50 recent saved application events.');
  application.append(data.applicationHistory.length ? table(['Recorded', 'Action', 'Version', 'Reason', 'Reference'], data.applicationHistory.map((event) => [date(event.createdAt), event.action.replaceAll('_', ' '), event.version, event.reason ?? '—', event.reference ?? '—']), 'Application review history') : el('p', 'No application events are available.', 'definition-note'));
  result.append(application); return result;
}
