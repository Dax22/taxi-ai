import { NIGERIA_MAP_PLACES, NIGERIA_MAP_SOURCES } from '/shared/nigeria-map-places.mjs';
import { el, link, panel, cards, table, empty, filterForm, detailsList, count, date } from './ui.mjs';
import { coverageMap } from './coverage-map.mjs';
import { waitLabel, boundsLabel, coverageQuery } from './coverage-map-model.mjs';

function hidden(name, value) { const field = el('input', null, '', { type: 'hidden', name }); field.value = value ?? ''; return field; }
function filters(data, route) {
  const form = filterForm(route, [
    { name: 'from', label: 'Requested from · WAT', type: 'date' }, { name: 'to', label: 'Requested to · WAT', type: 'date' },
    { name: 'service', label: 'Service', options: [['all', 'Rides and courier'], ['ride', 'Rides'], ['courier', 'Courier']] },
  ], data.filters), layer = hidden('layer', data.filters.layer);
  form.append(hidden('place', data.filters.place), hidden('bbox', data.filters.bbox), layer); return { form, layer };
}
function placePicker(data) {
  const form = el('form', null, 'coverage-place-picker', { method: 'get', action: '/admin/coverage', 'aria-label': 'Jump to a place in Nigeria' });
  const label = el('label', 'Explore a city or area', '', { for: 'coverage-place' }), select = el('select', null, '', { id: 'coverage-place', name: 'place' });
  select.append(el('option', 'All Nigeria', '', { value: '' }));
  for (const place of [...NIGERIA_MAP_PLACES].sort((a, b) => a.name.localeCompare(b.name))) select.append(el('option', `${place.name} · ${place.stateId.toUpperCase()}${place.kind === 'district' ? ' · area' : ''}`, '', { value: place.id }));
  select.value = data.filters.bbox ? '' : data.filters.place || '';
  const field = el('div', null, 'field'); field.append(label, select); const layer = hidden('layer', data.filters.layer);
  form.append(field, hidden('from', data.filters.from), hidden('to', data.filters.to), hidden('service', data.filters.service), layer, el('button', 'Go to place ↗', 'button secondary', { type: 'submit' }));
  return { form, layer };
}
function cellTable(cells, explorer) {
  const root = el('div'); let page = 0; const limit = 100;
  function render() {
    const start = page * limit, items = cells.slice(start, start + limit), rows = items.map((cell) => {
      const area = el('div'); area.append(el('strong', cell.key), el('span', boundsLabel(cell.bounds), 'subtext'));
      const button = el('button', 'Inspect cell', 'button quiet', { type: 'button', 'aria-label': `Inspect grid ${cell.key}` }); button.addEventListener('click', () => explorer.select(cell));
      return [area, count(cell.waitingRequests), count(cell.availableDrivers), count(cell.requests), count(cell.unserved), `${waitLabel(cell.meanPickupWaitSeconds)} · ${count(cell.pickupWaitObservations)} observations`, button];
    });
    const controls = el('div', null, 'pagination'), buttons = el('div');
    controls.append(el('span', cells.length ? `Cells ${start + 1}–${start + items.length} of ${count(cells.length)} · all mapped cells are included in the totals.` : 'No mapped cells'));
    for (const [label, delta] of [['← Previous', -1], ['Next →', 1]]) {
      const button = el('button', label, 'button secondary', { type: 'button' }); button.disabled = delta < 0 ? page === 0 : start + limit >= cells.length;
      button.addEventListener('click', () => { page += delta; render(); }); buttons.append(button);
    }
    controls.append(buttons); root.replaceChildren(table(['GPS grid', 'Waiting now', 'Drivers now', 'Requests · dates', 'Unserved · dates', 'Observed pickup wait · dates', ''], rows, 'The same map measurements, available without using the map'), controls);
  }
  render(); return root;
}
function locationAccounting(data) {
  const box = panel('Records beyond this map view', 'Nationwide accounting for the selected service. Sample locations are never placed on the GPS map.');
  const rows = [['GPS outside this viewport', data.outsideViewport], ['Saved sample locations · nationwide', { historical: data.offMap.historical.sample, current: data.offMap.current.sample }],
    ['Missing or unusable GPS · nationwide', { historical: data.offMap.historical.unlocated, current: data.offMap.current.unlocated }]];
  box.append(table(['Location classification', 'Requests · selected dates', 'Unserved · selected dates', 'Waiting requests now', 'Available drivers now'], rows.map(([label, value]) => [label, count(value.historical.requests), count(value.historical.unserved), count(value.current.waitingRequests), count(value.current.availableDrivers)])),
    el('p', 'These counts are not demand for the selected city. A sample label such as Wuse does not establish a real pickup position. Records without usable GPS stay in this accounting, not on a fabricated map point.', 'definition-note'));
  box.append(detailsList([
    ['Nationwide requests · selected dates', count(data.nationwideTotals.historical.requests)], ['Nationwide unserved · selected dates', count(data.nationwideTotals.historical.unserved)],
    ['Nationwide waiting requests now', count(data.nationwideTotals.current.waitingRequests)], ['Nationwide available drivers now', count(data.nationwideTotals.current.availableDrivers)],
  ])); return box;
}
export function coverage(data, route) {
  const result = el('div'), period = filters(data, route), places = placePicker(data), query = new URLSearchParams({ from: data.filters.from, to: data.filters.to, service: data.filters.service });
  result.append(link('← Demand analytics', '/admin/demand?' + query, 'text-link'), period.form);
  result.append(el('p', `Historical layers use requests created ${data.filters.from} to ${data.filters.to}, inclusive in Nigeria time (WAT). Current coverage is a separate snapshot at ${date(data.asOf)} and includes waiting requests regardless of those dates.`, 'definition-note'));
  result.append(cards([
    ['Requests waiting now', count(data.currentTotals.waitingRequests), 'Unmatched and unexpired · mapped viewport', true],
    ['Available drivers now', count(data.currentTotals.availableDrivers), 'Eligible drivers · same snapshot and viewport'],
    ['Requests · selected dates', count(data.historicalTotals.requests), 'Recorded pickup GPS inside this viewport'],
    ['Mean observed pickup wait', waitLabel(data.historicalTotals.meanPickupWaitSeconds), `${count(data.historicalTotals.pickupWaitObservations)} valid arrival observations · selected dates`],
  ]));
  const place = data.viewport.place, map = panel(place && !data.filters.bbox ? `${place.name} · approximate view` : data.filters.bbox ? 'Nigeria · selected viewport' : 'Across Nigeria', 'Explore any location nationwide. Presets help navigation; they do not limit the areas the app can serve.');
  map.append(places.form);
  const quick = el('nav', null, 'coverage-quick-links', { 'aria-label': 'Compare Abuja area views' }), quickLinks = [];
  for (const id of ['map-wuse', 'map-maitama']) {
    const item = NIGERIA_MAP_PLACES.find((entry) => entry.id === id); if (!item) continue;
    const anchor = link(`Explore ${item.name} ↗`, coverageQuery(data.filters, { place: id, bbox: '' }), 'text-link'); quickLinks.push({ anchor, id }); quick.append(anchor);
  }
  map.append(quick);
  const explorer = coverageMap(data, { onLayerChange(layer) {
    period.layer.value = layer; places.layer.value = layer;
    for (const { anchor, id } of quickLinks) anchor.setAttribute('href', coverageQuery(data.filters, { place: id, bbox: '', layer }));
  } });
  map.append(explorer.node);
  if (!data.cells.length) map.append(empty('No mapped observations in this view', 'Try a wider view, a different service or other historical dates. No coloured cell means no mapped observation, not proof of no demand or guaranteed coverage.'));
  map.append(el('p', `Grid size ${data.viewport.cellDegrees}° · ${boundsLabel(data.viewport.bounds)}. Grid cells and preset viewports are approximate, not city, district or ward boundaries. Driver locations are grouped into cells; no individual identities, pins or routes are shown.`, 'definition-note'));
  const attribution = el('p', null, 'coverage-attribution'); attribution.append(document.createTextNode('Country outline: Natural Earth. Place anchors: '));
  for (const [index, source] of NIGERIA_MAP_SOURCES.entries()) { if (index) attribution.append(document.createTextNode(' · ')); attribution.append(link(source.name, source.url, 'text-link'), document.createTextNode(' ('), link(source.license, source.licenseUrl, 'text-link'), document.createTextNode(')')); }
  map.append(attribution); result.append(map);
  const measurements = panel('Grid measurements', 'Historical request outcomes and observed pickup waits are separate from current driver supply.');
  measurements.append(cellTable(data.cells, explorer), el('p', 'Unserved means expired without a driver match. Observed pickup wait is booking to first recorded driver arrival; it excludes journeys without valid arrival timing. Current queue age measures time since request creation for requests still waiting. Missing timing is shown as —. Counts in a cell do not guarantee that a particular driver can accept a request.', 'definition-note'));
  result.append(measurements, locationAccounting(data)); return result;
}
