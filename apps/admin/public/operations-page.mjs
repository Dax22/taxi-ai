import { el, link, badge, panel, cards, table, empty, filterForm, count, date } from './ui.mjs';

const queues = [['waiting', 'Waiting rides'], ['active', 'Active journeys'], ['drivers', 'Available drivers'], ['eats', 'Delayed Eats orders']];
const seconds = (value) => Number.isFinite(value) ? value < 60 ? `${Math.round(value)} sec` : `${Math.floor(value / 60)} min ${Math.round(value % 60)} sec` : '—';
function reference(item, allowed) { return allowed ? link(item.id.slice(0, 8).toUpperCase() + ' ↗', '/admin/trips/' + item.id) : item.id.slice(0, 8).toUpperCase(); }
export function operations(data, route, staff) {
  const result = el('div'), queue = data.filters.queue;
  result.append(el('p', `Snapshot ${date(data.asOf)}. This page refreshes every 30 seconds while visible. Counts cover all regions; the queue below uses your filters.`, 'definition-note'));
  result.append(cards([
    ['Waiting ride requests', count(data.counts.waitingRequests), 'Open requests awaiting a match', true],
    ['Active journeys', count(data.counts.activeTrips), 'Assigned journeys still in progress'],
    ['Available drivers', count(data.counts.availableDrivers), 'Approved drivers with current availability'],
    ['Eats orders to review', count(data.counts.delayedEats), 'Orders beyond a stage review threshold'],
  ]));
  const matching = panel('Matching activity', `${date(data.matching.since)} – ${date(data.matching.until)} · driver offers`);
  matching.append(cards([
    ['Pending offers', count(data.matching.pending), 'Awaiting a driver response'],
    ['Expired / declined', `${count(data.matching.expired)} / ${count(data.matching.declined)}`, 'Offer outcomes in this window'],
    ['Accepted offers', count(data.matching.accepted), `${count(data.matching.matchedRequests)} matched requests`],
    ['Mean time to match', seconds(data.matching.meanMatchSeconds), 'Matched requests in the reporting window'],
  ])); result.append(matching);
  result.append(filterForm(route, [{ name: 'queue', label: 'Queue', options: queues }, { name: 'region', label: 'Region key', placeholder: 'Exact saved area or dispatch cell key' },
    { name: 'status', label: 'Status in this queue', options: [['all', 'All statuses'], ...({ waiting: ['requested'], active: ['negotiating', 'agreed', 'booked', 'on_way', 'arrived', 'in_progress'], drivers: ['available'], eats: ['placed', 'accepted', 'preparing', 'ready', 'assigned', 'picked_up', 'arrived'] })[queue].map((value) => [value, value.replaceAll('_', ' ')])] }], { queue, region: data.filters.region ?? '', status: data.filters.status ?? 'all' }));
  const content = panel(queues.find(([key]) => key === queue)?.[1] ?? 'Operations queue', 'Oldest items first. Region labels come from saved areas or dispatch cells.');
  const page = data.queues[queue], items = page.items, region = (item) => item.region ? item.region.label === item.region.key ? item.region.label : `${item.region.label} (${item.region.key})` : 'Not recorded';
  if (!items.length) content.append(empty('No items in this queue', 'There are no matching records at this snapshot. Change the filters or refresh later.'));
  else if (queue === 'waiting') content.append(table(['Request', 'Region', 'Category', 'Waiting', 'Offer', 'Expires'], items.map((item) => [reference(item, staff?.permissions?.includes('trips.read')), region(item), item.vehicleCategory, seconds(item.waitSeconds), typeof item.pendingOffer === 'object' ? item.pendingOffer ? 'Awaiting response' : 'No pending offer' : item.pendingOffer ? 'Awaiting response' : 'No pending offer', date(item.expiresAt)]), 'Waiting requests'));
  else if (queue === 'active') content.append(table(['Journey', 'Driver', 'Region', 'Status', 'Vehicle location'], items.map((item) => {
    const location = el('div'); location.append(badge(item.location.status), el('span', item.location.capturedAt ? `Recorded ${date(item.location.capturedAt)}` : 'No shared location', 'subtext'));
    return [reference(item, staff?.permissions?.includes('trips.read')), item.driverName ?? 'Unassigned', region(item), badge(item.status), location];
  }), 'Active journeys and vehicle location freshness'));
  else if (queue === 'drivers') content.append(table(['Driver', 'Region', 'Category', 'Mode', 'Last seen', 'Availability expires'], items.map((item) => [item.driverName, region(item), item.vehicleCategory, item.mode, date(item.lastSeenAt), date(item.leaseExpiresAt)]), 'Available drivers'));
  else content.append(table(['Order', 'Store', 'Region', 'Status', 'Waiting', 'Past review threshold'], items.map((item) => [item.id.slice(0, 8).toUpperCase(), item.storeName, region(item), badge(item.status), seconds(item.waitSeconds), seconds(item.delaySeconds)]), 'Delayed Eats orders'));
  if (page.nextCursor) { const query = new URLSearchParams(route.query); query.set('queue', queue); query.set('after', page.nextCursor); content.append(link('Next page →', route.path + '?' + query, 'button secondary')); }
  result.append(content, el('p', 'Eats thresholds are operational review reminders, not predicted delivery times. Location status describes driver-shared vehicle data. It does not confirm the passenger’s phone location or their safety.', 'definition-note'));
  return result;
}
