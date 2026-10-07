import { el, link, panel, table, empty, filterForm, detailsList, date } from './ui.mjs';
import { actionForm } from './forms.mjs';
import { safetyAlertMap } from './safety-alert-map.mjs';

const word = value => value ? String(value).replaceAll('_', ' ') : 'Not recorded';
const name = value => value?.name || 'Not recorded';
const provenance = value => value === true ? 'TEST / SIMULATED INPUT' : 'Signal report — incident not independently verified';
const stateLabel = value => ({ open: 'Needs acknowledgment', acknowledged: 'Acknowledged', resolved: 'Staff review resolved', false_alarm: 'Assessed as false alarm' })[value] || 'Not recorded';
const transportLabel = value => ({ countdown: 'Cancellation countdown', queued: 'Notification processing', finished: 'Notification processing finished', cancelled: 'Cancelled by source workflow', expired: 'Notification window expired' })[value] || word(value);
const deliveryLabel = value => ({ accepted: 'Accepted by gateway — recipient delivery unconfirmed', sending: 'Request in progress — delivery unconfirmed', unavailable: 'No delivery provider available', failed: 'Notification attempt failed', queued: 'Waiting to attempt', cancelled: 'Notification cancelled' })[value] || word(value);
const base = '/admin/safety-alerts';

export function safetyAlerts(data, route) {
  const body = el('div');
  body.append(el('p', data.notice, 'scope-notice'),
    el('p', 'Restricted safety queue. Precise locations and contact details are available only inside an audited alert record.', 'definition-note'),
    filterForm(route, [
      { name: 'kind', label: 'Signal type', options: [['all', 'All signals'], ['impact', 'Possible crash'], ['distress', 'Possible loud distress'], ['manual', 'Manual panic alert']] },
      { name: 'state', label: 'Staff review', options: [['active', 'Needs attention'], ['all', 'All, including cancelled'], ...['open', 'acknowledged', 'resolved', 'false_alarm'].map(s => [s, stateLabel(s)])] },
    ], data.filters));
  const box = panel('Possible crash, distress and panic alerts', 'These are reports to assess, not automatic findings against a driver.');
  box.append(data.items.length ? table(['Alert / reported', 'Signal / provenance', 'Passenger', 'Booking customer', 'Driver', 'Staff review', 'Notification state'], data.items.map(a => {
    const ref = el('div'); ref.append(link(a.id.slice(0, 8).toUpperCase(), `${base}/${a.id}`), el('small', date(a.createdAt), 'subtext'));
    const kind = el('div'); kind.append(el('strong', a.label), el('small', provenance(a.isTest), 'subtext'));
    return [ref, kind, name(a.passenger), name(a.customer), name(a.driver), stateLabel(a.review.state), transportLabel(a.transportStatus)];
  }), 'Restricted safety reports — latest first') : empty('No matching safety alerts', 'No example incidents have been inserted. Change the filters to inspect cancelled or previously reviewed reports.'));
  const controls = el('div', null, 'pagination'), first = new URLSearchParams(route.query); first.delete('before');
  controls.append(el('span', `${data.items.length} records on this page`), link('First page', `${base}?${first}`, 'button quiet'));
  if (data.nextBefore) { const q = new URLSearchParams(first); q.set('before', data.nextBefore); controls.append(link('Next page', `${base}?${q}`, 'button secondary')); }
  box.append(controls); body.append(box); return body;
}

function personPanel(title, p, extra = []) {
  const box = panel(title);
  box.append(detailsList([['Name', name(p)], ['Account reference', p?.id || 'Not recorded / guest'],
    ['Email', p?.contact?.email || 'Not recorded'], ['Phone', p?.phone || p?.contact?.phone || 'Not recorded'],
    ['Contact source', word(p?.contactSource || p?.contact?.source)], ...extra]));
  return box;
}
function locationPanel(title, position, data, historical) {
  const box = panel(title, historical ? 'Recorded incident evidence, not current whereabouts.' : 'Separate active-trip observation. Sharing may stop at any time.');
  box.append(detailsList([['Captured at (WAT)', date(position?.capturedAt)], ['Accuracy (metres)', position?.accuracy ?? 'Unavailable'],
    ['Source', word(position?.source)], ['Age at this refresh (seconds)', position ? Math.ceil(position.ageMs / 1000) : 'Unavailable'],
    ['Freshness at this refresh', position ? position.stale ? 'Last known / stale' : 'Recent at the displayed time' : 'Unavailable']]));
  box.append(safetyAlertMap(position, data.map, { historical }));
  return box;
}
export function safetyAlertDetail(data) {
  const body = el('div'), a = data.alert;
  body.append(link('← Safety alerts', base), el('p', `${a.label}. ${provenance(a.isTest)}.`, 'scope-notice'));
  const summary = panel('Alert and response', a.id);
  summary.append(detailsList([['Signal', a.label], ['Reported at (WAT)', date(a.createdAt)], ['Trip reference', a.rideId],
    ['Trip status at refresh', word(data.currentTripStatus)], ['Staff review', stateLabel(a.review.state)],
    ['Assigned responder reference', a.review.assigneeId || 'Unassigned'], ['Notification workflow', transportLabel(a.transportStatus)],
    ['Cancellation deadline', date(a.dueAt)], ['Pickup', data.pickup || 'Not recorded'], ['Destination', data.destination || 'Not recorded']]));
  body.append(summary);
  const people = el('div', null, 'two-column even-columns');
  people.append(personPanel('Actual passenger', data.passenger, [['Passenger type', word(data.passenger?.kind)]]), personPanel('Booking customer', data.customer));
  body.append(people);
  const vehicle = data.driver?.vehicle || {};
  body.append(personPanel('Assigned driver and vehicle', data.driver, [['Number plate', vehicle.plate || 'Not recorded'],
    ['Vehicle', [vehicle.make, vehicle.modelName || vehicle.model].filter(Boolean).join(' ') || 'Not recorded'],
    ['Colour', vehicle.colour || 'Not recorded'], ['Category', word(vehicle.category)]]));
  const reporter = panel('Reporting account'); reporter.append(detailsList([['Name', name(data.reporter)], ['Account reference', data.reporter?.id || 'Not recorded']])); body.append(reporter);
  body.append(locationPanel('Incident location', data.incidentPosition, data, true));
  if (data.currentPositionRequested) {
    const current = locationPanel('Last requested driver location', data.currentPosition, data, false);
    current.setAttribute('data-safety-current', 'true'); current.setAttribute('data-received-at', String(Date.now())); body.append(current);
  }
  if (data.canRequestCurrentPosition) body.append(link('Request current shared driver location (audited)', `${base}/${a.id}?live=1`, 'button secondary'));
  else body.append(el('p', 'Current location is unavailable because this trip is no longer active. Incident evidence remains historical.', 'definition-note'));
  const signals = panel('Experimental signal measurements', 'Thresholds are not a crash diagnosis or a scream classifier. No microphone recording is available here.');
  signals.append(detailsList(Object.entries(data.signal).map(([key, value]) => [word(key), key === 'capturedAt' ? date(value) : value]))); body.append(signals);
  const delivery = panel('Notification attempts', 'Accepted by a gateway is not proof of delivery to a person or emergency dispatch.');
  delivery.append(data.deliveries.length ? table(['Attempt reference', 'Recorded status', 'Attempts'], data.deliveries.map(j => [j.id, deliveryLabel(j.status), j.attempts])) : el('p', 'No notification attempt was recorded.')); body.append(delivery);
  const history = panel('Staff response history', 'A review action does not call, message, dispatch help or change the sensor report.');
  history.append(data.events.length ? table(['Action', 'Time (WAT)', 'Staff reference', 'Note'], data.events.map(e => [word(e.action), date(e.createdAt), e.actorId, e.note])) : el('p', 'No staff response has been recorded.')); body.append(history);
  const actions = ['note', ...(a.review.state === 'open' ? ['acknowledge'] : a.review.state === 'acknowledged' ? ['resolve', 'false_alarm'] : ['reopen'])];
  const labels = { note: 'Record contact attempt / note', acknowledge: 'Acknowledge and assign to me', resolve: 'Record reviewed resolution', false_alarm: 'Record assessed false alarm', reopen: 'Reopen for review' };
  for (const action of actions) body.append(actionForm({ title: labels[action], action: `/api/admin/console/safety-alerts/${a.id}`, submit: labels[action],
    data: { action, expectedVersion: a.review.version }, fields: [{ name: 'note', label: 'What was checked or done? Do not include passwords or PINs.', min: 5, max: 1000, multiline: true }] }));
  const readiness = panel('AI and notification configuration', data.readiness.notice);
  readiness.append(detailsList([['Vehicle photo provider', data.readiness.vehicleVisionConfigured ? 'Configured; acceptance unverified' : 'Not configured'],
    ['Face comparison provider', data.readiness.faceComparisonConfigured ? 'Configured; acceptance unverified' : 'Not configured'],
    ['Notification gateway', data.readiness.notificationGatewayConfigured ? 'Configured; delivery unverified' : 'Not configured'],
    ['Emergency-service partner', data.readiness.emergencyPartnerConfigured ? 'Configured; dispatch unverified' : 'Not configured']]));
  body.append(readiness, el('p', data.notice, 'definition-note')); return body;
}
