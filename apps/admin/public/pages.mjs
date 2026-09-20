import { el, link, badge, avatar, panel, cards, table, empty, pagination, filterForm, detailsList, person, money, count, percent, date } from './ui.mjs';
import { trend, statuses } from './charts.mjs';
import { RIDE_STATUS_LABELS } from '/shared/trip-lifecycle.mjs';
import { vehiclePresentation } from '/shared/vehicle-profile.mjs';

const dates = [{ name: 'from', label: 'From · Abuja date', type: 'date' }, { name: 'to', label: 'To · Abuja date', type: 'date' }];
const search = { name: 'q', label: 'Search', type: 'search', placeholder: 'Name or reference' };
const status = { name: 'status', label: 'Journey status', options: [['all', 'All statuses'], ...Object.entries(RIDE_STATUS_LABELS)] };
const payment = { name: 'payment', label: 'Payment', options: [['all', 'All payments'], ['not_due', 'Not due'], ['unpaid', 'Unpaid'], ['pending', 'Pending'], ['failed', 'Failed'], ['paid', 'Paid · simulated']] };
const mode = { name: 'mode', label: 'Participation', options: [['all', 'All trips'], ['customer', 'As passenger'], ['driver', 'As driver']] };

function tripTable(items, caption = 'Journeys, newest request first') {
  if (!items.length) return empty('No journeys to show', 'Trips will appear here as people use Taxi Ai. If filters are applied, try resetting them.');
  return table(['Trip / requested', 'Route', 'Customer', 'Driver', 'Status', 'Agreed fare', 'Payment'], items.map((trip) => {
    const reference = el('div'); reference.append(link(trip.id.slice(0, 8).toUpperCase() + ' ↗', '/admin/trips/' + trip.id), el('span', date(trip.createdAt), 'subtext'));
    const route = el('div'); route.append(el('strong', trip.pickup), el('span', '→ ' + trip.destination, 'subtext'));
    return [reference, route, person(trip.customer), person(trip.driver), badge(trip.status), money(trip.fareKobo), badge(trip.paymentStatus)];
  }), caption);
}
function reportingNote(range) {
  return el('p', `Requests created ${range.from} to ${range.to}, inclusive, in Abuja time. Trip and payment statuses are current at refresh. Completed fares count only completed trips; they are not platform revenue or driver payouts.`, 'definition-note');
}
function summaryCards(summary) {
  return cards([
    ['Journey requests', count(summary.requests), 'Created in the selected period', true],
    ['Completed trips', count(summary.completed), `${percent(summary.completionRate)} of these requests`],
    ['Completed fares', money(summary.completedFareKobo), 'Gross agreed fares · NGN'],
    ['Paid · simulated', money(summary.simulatedPaidKobo), 'Test payments · no money moved'],
  ]);
}
function moneyPanel(title, summary, driving = false) {
  const box = panel(title, `${count(summary.completed)} completed · ${count(summary.requests)} total requests`);
  box.append(detailsList([[driving ? 'Completed driving fares' : 'Total completed trip cost', money(summary.completedFareKobo)],
    ['Paid · simulated', money(summary.simulatedPaidKobo)], ['Outstanding · simulated', money(summary.outstandingKobo)],
    ['Cancelled / expired requests', `${count(summary.cancelled)} / ${count(summary.expired)}`]], 'money-list'));
  return box;
}
function vehicleCard(vehicle, label) {
  const box = panel(label);
  if (!vehicle) { box.append(el('p', 'Vehicle details are not available for this record.', 'definition-note')); return box; }
  const value = vehiclePresentation(vehicle), row = el('div', null, 'vehicle');
  const image = el('img', null, '', { src: value.assetPath, alt: '', width: '640', height: '640' }), info = el('div');
  info.append(el('h3', value.title), el('p', value.description, 'small muted'), el('span', value.plate, 'plate'));
  row.append(image, info); box.append(row, el('p', value.illustrationNote, 'definition-note')); return box;
}
function overview(data, route) {
  const fragment = el('div'); fragment.append(filterForm(route, dates, data.range), summaryCards(data.summary));
  const columns = el('div', null, 'two-column'), journeys = panel('Journey activity', 'Requests and completions by request date', link('Explore analytics ↗', '/admin/analytics'));
  journeys.append(trend(data.daily));
  const network = panel('Your network', 'Current account totals · all time');
  network.append(detailsList([['Registered accounts', count(data.accounts.total)], ['Customer-only accounts', count(data.accounts.customerOnly)],
    ['Accounts with a driver profile', count(data.accounts.drivers)], ['New accounts in this period', count(data.accounts.newAccounts)],
    ['Applications awaiting review', count(data.accounts.awaitingReview)]], 'money-list'));
  network.append(link('Browse accounts ↗', '/admin/accounts', 'button primary')); columns.append(journeys, network); fragment.append(columns);
  const recent = panel('Recent journeys', 'Latest requests in the selected period', link('View all trips ↗', '/admin/trips'));
  recent.append(tripTable(data.recentTrips), reportingNote(data.range)); fragment.append(recent); return fragment;
}
function accounts(data, route) {
  const fragment = el('div'); fragment.append(cards([
    ['Registered accounts', count(data.counts.total), 'Customers and drivers · all time', true],
    ['Customer-only accounts', count(data.counts.customerOnly), 'No driver profile added'],
    ['Driver accounts', count(data.counts.drivers), 'Also able to book personal rides'],
    ['Awaiting review', count(data.counts.awaitingReview), 'Submitted driver applications'],
  ]));
  fragment.append(filterForm(route, [{ ...search, placeholder: 'Name, email, account ID or plate' },
    { name: 'type', label: 'Account type', options: [['all', 'All accounts'], ['customer', 'Customer only'], ['driver', 'Driver accounts']] },
    { name: 'review', label: 'Driver application', options: [['all', 'All applications'], ['submitted', 'Awaiting review'], ['draft', 'Draft'], ['approved', 'Approved'], ['changes_requested', 'Corrections requested'], ['rejected', 'Rejected']] }]));
  const box = panel('Account directory', 'Open a person to see their profile, lifetime totals and trips.');
  if (data.items.length) box.append(table(['Account', 'Type', 'Driver application', 'Trips', 'Joined', ''], data.items.map((account) => {
    const identity = el('div', null, 'person-cell'), info = el('div'); info.append(link(account.name, '/admin/accounts/' + account.id), el('span', account.email, 'subtext'));
    identity.append(avatar(account.name), info);
    return [identity, badge(account.type), account.reviewStatus ? badge(account.reviewStatus) : '—', count(account.tripCount), date(account.createdAt, false), link('View account ↗', '/admin/accounts/' + account.id)];
  }), 'Registered users · most recently joined first'));
  else box.append(empty('No matching accounts', 'Try a different name, email, plate or filter. New customer and driver accounts will appear here automatically.'));
  box.append(pagination(data.page, route, data.items.length)); fragment.append(box); return fragment;
}
function account(data, route) {
  const fragment = el('div'), user = data.account;
  fragment.append(link('← All accounts', '/admin/accounts', 'text-link'));
  const profile = panel('Account profile'), identity = el('div', null, 'profile'), text = el('div');
  text.append(el('h2', user.name), badge(user.type), el('p', user.email, 'muted')); identity.append(avatar(user.name), text);
  profile.append(identity, detailsList([['Joined', date(user.createdAt)], ['Journey requests · all time', count(data.summary.requests)], ['Account ID', user.id]], 'profile-meta'));
  fragment.append(profile);
  if (user.type === 'driver') {
    const vehicle = vehicleCard(user.vehicle, 'Registered vehicle'); vehicle.append(badge(user.reviewStatus), el('p', 'Vehicle details belong to the current application. A pending or reopened application is not an approval to drive.', 'definition-note'));
    const row = el('div', null, 'two-column even-columns'); row.append(moneyPanel('Personal rides · all time', data.passenger), moneyPanel('Driving activity · all time', data.driving, true));
    fragment.append(row, vehicle);
  } else fragment.append(moneyPanel('Personal rides · all time', data.passenger));
  fragment.append(filterForm(route, [mode, status, payment, ...dates]));
  const history = panel('All account journeys', 'Browse every saved request, including completed, cancelled and expired journeys. Totals above remain all time.');
  history.append(tripTable(data.trips.items), pagination(data.trips.page, route, data.trips.items.length)); fragment.append(history); return fragment;
}
function trips(data, route) {
  const fragment = el('div'); fragment.append(filterForm(route, [search, status, payment, ...dates]));
  const box = panel('Journey directory', 'Every request has a traceable trip reference. Open a journey for its fare, participants and timeline.');
  box.append(tripTable(data.items), pagination(data.page, route, data.items.length)); fragment.append(box); return fragment;
}
function trip(data) {
  const fragment = el('div'), item = data.trip;
  fragment.append(link('← All trips', '/admin/trips', 'text-link'));
  const box = panel('Journey details', 'Trip reference: ' + item.id), route = el('div', null, 'route-summary');
  for (const [index, [label, text]] of [['Pickup', item.pickup], ['Destination', item.destination]].entries()) {
    if (index) route.append(el('span', '→', '', { 'aria-hidden': 'true' }));
    const point = el('div'); point.append(el('small', label), el('strong', text)); route.append(point);
  }
  box.append(route, detailsList([['Status', badge(item.status)], ['Agreed fare', money(item.fareKobo)], ['Passenger', person(item.customer)], ['Driver', person(item.driver)],
    ['Requested', date(item.createdAt)], ['Completed', date(item.completedAt)], ['Payment status', badge(item.paymentStatus)], ['Payment reference', item.paymentReference ?? 'Not available']]));
  box.append(el('p', 'An agreed fare is not proof of payment. Payment status on this preview is simulated.', 'definition-note'));
  fragment.append(box);
  const columns = el('div', null, 'two-column even-columns'), timeline = panel('Journey timeline', 'Recorded operational events · Abuja time'), list = el('ol', null, 'timeline');
  const events = [{ type: 'Requested', createdAt: item.createdAt, actorName: item.customer.name },
    ...(item.matchedAt ? [{ type: 'Driver assigned', createdAt: item.matchedAt, actorName: item.driver?.name }] : []), ...data.activity];
  for (const event of events) {
    const row = el('li'); row.append(el('strong', RIDE_STATUS_LABELS[event.type] ?? event.type), el('p', `${date(event.createdAt)}${event.actorName ? ' · ' + event.actorName : ''}`));
    if (event.reason) row.append(el('p', event.reason.replaceAll('_', ' '))); list.append(row);
  }
  if (item.paidAt) { const row = el('li'); row.append(el('strong', 'Payment marked paid · simulated'), el('p', date(item.paidAt))); list.append(row); }
  timeline.append(list); columns.append(timeline, vehicleCard(item.vehicle, 'Vehicle recorded for this journey')); fragment.append(columns); return fragment;
}
function analytics(data, route) {
  const fragment = el('div'); fragment.append(filterForm(route, dates, data.range), summaryCards(data.summary));
  const journeys = panel('How journeys are moving', 'Request cohort · daily activity in Abuja time'); journeys.append(trend(data.daily)); fragment.append(journeys);
  const fares = panel('Fare and payment trends', 'Naira · completed fares and simulated payments, grouped by request date'); fares.append(trend(data.daily, true)); fragment.append(fares);
  const columns = el('div', null, 'two-column even-columns'), distribution = panel('Journey outcomes', 'Current status of requests from the selected period'); distribution.append(statuses(data.statuses));
  const performance = panel('Service & payment summary'); performance.append(detailsList([
    ['Completion rate', percent(data.summary.completionRate)], ['Cancellation rate', percent(data.summary.cancellationRate)], ['Expired requests', count(data.summary.expired)],
    ['Open journeys', count(data.summary.active)], ['Average completed fare', money(data.summary.averageFareKobo)], ['Outstanding · simulated', money(data.summary.outstandingKobo)],
    ['Failed / pending payments', `${count(data.summary.failed)} / ${count(data.summary.pending)}`],
  ], 'money-list')); columns.append(distribution, performance); fragment.append(columns);
  const routes = panel('Most requested routes', 'Top eight routes in the selected request cohort');
  routes.append(data.routes.length ? table(['Pickup', 'Destination', 'Requests', 'Completed'], data.routes.map((row) => [row.pickup, row.destination, count(row.requests), count(row.completed)]))
    : empty('No route activity yet', 'Requested routes will appear here once journeys are created.'));
  fragment.append(routes, reportingNote(data.range), el('p', 'Completion and cancellation rates divide by all requests in this period. Expired requests are shown separately. The average fare is rounded down to a whole kobo.', 'definition-note'));
  return fragment;
}
export const renderPage = (route, data) => ({ overview, accounts, account, trips, trip, analytics })[route.name](data, route);
