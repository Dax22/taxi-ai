import { el, link, panel, cards, table, empty, filterForm, detailsList, count, percent, date } from './ui.mjs';
import { trend } from './charts.mjs';

const duration = (seconds) => seconds == null ? '—' : seconds < 60 ? `${Math.round(seconds)} sec` : `${Math.floor(seconds / 60)} min ${Math.round(seconds % 60)} sec`;
function areaLabel(region) {
  const box = el('div'); box.append(el('strong', region.label), el('span', `${region.kind === 'sample' ? 'Sample area' : region.kind === 'dispatch_cell' ? 'Coarse GPS area' : 'Area not recorded'} · ${region.key}`, 'subtext')); return box;
}
function hourly(rows) {
  const max = Math.max(0, ...rows.map((row) => row.requests)), grid = el('ol', null, 'demand-hours', { 'aria-label': 'Requests by hour of day in Nigeria time' });
  for (const row of rows) {
    const hour = String(row.hour).padStart(2, '0') + ':00', level = max ? Math.ceil(row.requests / max * 4) : 0;
    const cell = el('li', null, `demand-hour density-${level}`);
    cell.append(el('span', hour), el('strong', count(row.requests)), el('span', `${count(row.matched)} matched`, 'small')); grid.append(cell);
  }
  return grid;
}
export function demand(data, route) {
  const result = el('div'), total = data.totals;
  const mapQuery = new URLSearchParams({ from: data.filters.from, to: data.filters.to, service: data.filters.service });
  result.append(link('Open Nigeria coverage map ↗', '/admin/coverage?' + mapQuery, 'button secondary'));
  result.append(filterForm(route, [
    { name: 'from', label: 'Requested from · WAT', type: 'date' }, { name: 'to', label: 'Requested to · WAT', type: 'date' },
    { name: 'service', label: 'Service', options: [['all', 'Rides and courier'], ['ride', 'Rides'], ['courier', 'Courier']] },
    { name: 'region', label: 'Saved area key', placeholder: 'All areas, or an exact saved key' },
  ], { ...data.filters, region: data.filters.region ?? '' }));
  result.append(el('p', `Requests created ${data.filters.from} to ${data.filters.to}, inclusive, in Nigeria time (WAT). Outcomes are current as of ${date(data.asOf)}. Click a saved area below to focus the report.`, 'definition-note'));
  result.append(cards([
    ['Journey requests', count(total.requests), 'Requests created in the selected period', true],
    ['Matched requests', count(total.matched), `${percent(total.requests ? total.matched / total.requests : null)} of all selected requests`],
    ['Expired without a match', count(total.unserved), 'Unmatched requests past their expiry'],
    ['Mean time to match', duration(total.meanMatchSeconds), `${count(total.matchedWithTiming)} matched requests with valid timing`],
  ]));
  const daily = panel('Daily demand', 'Requests and completed journeys, grouped by request date.');
  daily.append(trend(data.daily)); result.append(daily);
  const hours = panel('Demand by hour', 'Request time in Nigeria (WAT), combined across all selected dates. Darker cells indicate more requests in this report.');
  hours.append(hourly(data.hours)); result.append(hours);
  const columns = el('div', null, 'two-column even-columns'), outcomes = panel('Request outcomes', 'These categories together account for every selected request.');
  outcomes.append(detailsList([
    ['Completed', count(total.completed)], ['Expired without a match', count(total.unserved)], ['Cancelled', count(total.cancelled)], ['Open / in progress', count(total.open)],
  ]), el('p', 'Matched requests can be completed, cancelled or still in progress. Match rate divides matched requests by all selected requests. Mean time to match excludes records without a valid match timestamp.', 'definition-note'));
  const offers = panel('Driver offer responses', 'Offer outcomes for this request cohort. A request may have multiple offers.');
  offers.append(detailsList([
    ['Accepted', count(data.offers.accepted)], ['Declined', count(data.offers.declined)], ['Expired', count(data.offers.expired)], ['Pending / revoked', `${count(data.offers.pending)} / ${count(data.offers.revoked)}`],
    ['Offer acceptance rate', percent(data.offers.acceptanceRate)], ['Responses in denominator', count(data.offers.resolvedForAcceptance)],
  ]), el('p', 'Offer acceptance = accepted ÷ (accepted + declined + expired). Pending and revoked offers are excluded.', 'definition-note'));
  columns.append(outcomes, offers); result.append(columns);
  const supply = panel('Driver supply now', `Snapshot ${date(data.supply.capturedAt)} · current eligible availability, separate from the historical request period.`);
  supply.append(detailsList([['Available drivers now', count(data.supply.availableDrivers)], ['Scope', 'Selected area and service']]),
    el('p', 'This is not historical driver supply. It cannot establish past coverage or a request-to-driver shortage ratio. Eligibility and a current availability lease are required; supply can change after this snapshot.', 'definition-note'));
  result.append(supply);
  const areas = panel('Demand by saved area', `Up to ${data.areas.limit} areas, ordered by request volume. Sample locations and coarse GPS areas remain separate.`);
  if (data.areas.items.length) areas.append(table(['Area', 'Requests', 'Matched', 'Unserved', 'Mean match time', 'Drivers now'], data.areas.items.map((row) => {
    const query = new URLSearchParams(route.query); query.set('from', data.filters.from); query.set('to', data.filters.to); query.set('service', data.filters.service); query.set('region', row.region.key);
    const area = areaLabel(row.region); area.append(link('View area ↗', route.path + '?' + query));
    return [area, count(row.requests), `${count(row.matched)} · ${percent(row.requests ? row.matched / row.requests : null)}`, count(row.unserved), duration(row.meanMatchSeconds), count(row.availableDrivers)];
  }), 'Historical area demand and current driver availability'));
  else areas.append(empty('No request activity in this period', 'Try another date range or clear the area filter. Current supply is reported separately above.'));
  if (data.areas.truncated) areas.append(el('p', 'This area table is limited. Report totals include all matching areas, including rows not shown here. Filter by a saved area key to inspect it.', 'definition-note'));
  result.append(areas, el('p', 'Area labels come from saved request locations. Coarse GPS cells are not exact pickup addresses, city boundaries or a forecast. No passenger location or identity is displayed.', 'definition-note'));
  return result;
}
