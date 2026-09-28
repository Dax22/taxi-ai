import { NIGERIA_POLYGONS } from '/shared/nigeria-boundary.mjs';
import { NIGERIA_MAP_PLACES } from '/shared/nigeria-map-places.mjs';
import { el, link, count, detailsList } from './ui.mjs';
import { COVERAGE_LAYERS, waitLabel, boundsLabel, coverageQuery, encodeBounds, shiftBounds, mapProjection, metricValue, cellTone, layerDescription } from './coverage-map-model.mjs';

let serial = 0;
function svgNode(tag, attributes = {}, text = null) {
  const node = document.createElementNS('http://www.w3.org/2000/svg', tag);
  for (const [key, value] of Object.entries(attributes)) node.setAttribute(key, String(value));
  if (text !== null) node.textContent = String(text); return node;
}
function selectionDetails(cell) {
  const box = el('div'); box.append(el('h3', cell ? `GPS grid ${cell.key}` : 'Explore an area'));
  if (!cell) { box.append(el('p', 'Select a coloured grid cell or use “Inspect cell” in the table below. Zoom in for a smaller area.', 'definition-note')); return box; }
  box.append(el('p', boundsLabel(cell.bounds), 'small muted'), el('h4', 'Current snapshot'), detailsList([
    ['Requests waiting', count(cell.waitingRequests)], ['Available drivers', count(cell.availableDrivers)],
    ['Mean queue age', waitLabel(cell.meanWaitingSeconds)], ['Oldest waiting request', waitLabel(cell.maxWaitingSeconds)],
  ]), el('h4', 'Selected historical dates'), detailsList([
    ['Requests', count(cell.requests)], ['Expired without a match', count(cell.unserved)],
    ['Mean observed pickup wait', waitLabel(cell.meanPickupWaitSeconds)], ['Valid arrival observations', count(cell.pickupWaitObservations)],
  ])); return box;
}
function legend(layer, maximum, hasObservations) {
  const wrap = el('div', null, 'coverage-legend', { 'aria-label': 'Map colour legend' });
  const values = layer === 'coverage'
    ? [['none', 'No waiting request or available driver'], ['supply', 'Drivers available · no waiting request'], ['covered', 'Drivers ≥ waiting requests'], ['more-requests', 'Waiting requests > drivers'], ['no-supply', 'Waiting requests · no available driver']]
    : [['none', layer === 'wait' ? 'No valid pickup wait' : layer === 'unserved' ? 'No unserved requests' : 'No recorded requests'], ...(maximum === 0 && hasObservations ? [['level-1', '0 sec · observed']] : Array.from({ length: 4 }, (_, index) => {
      const start = Math.floor(maximum * index / 4) + 1, end = Math.floor(maximum * (index + 1) / 4);
      if (layer === 'wait') return maximum ? [`level-${index + 1}`, `Up to ${waitLabel(maximum * (index + 1) / 4)}`] : null;
      return end >= start ? [`level-${index + 1}`, start === end ? count(end) : `${count(start)}–${count(end)}`] : null;
    }).filter(Boolean))];
  for (const [tone, label] of values) { const item = el('span'); item.append(el('i', null, `coverage-swatch tone-${tone}`, { 'aria-hidden': 'true' }), document.createTextNode(label)); wrap.append(item); }
  if (layer !== 'coverage') wrap.append(el('p', hasObservations ? 'Colour scale is relative to the cells in this view. Use the values to compare different views.' : 'No measured values for this layer in the selected view.', 'definition-note'));
  return wrap;
}
export function coverageMap(data, { onLayerChange = () => {} } = {}) {
  const id = `coverage-${++serial}`, bounds = data.viewport.bounds, projection = mapProjection(bounds), root = el('div', null, 'coverage-explorer');
  const state = { layer: data.filters.layer, selected: null }, navigation = [], buttons = [], drawn = [];
  const layerBar = el('div', null, 'coverage-layers', { role: 'group', 'aria-label': 'Map layer' }), description = el('p', null, 'definition-note');
  const controls = el('nav', null, 'coverage-controls', { 'aria-label': 'Move or zoom the map' });
  for (const [action, label] of [['in', '+ Zoom in'], ['out', '− Zoom out'], ['north', '↑ North'], ['south', '↓ South'], ['west', '← West'], ['east', 'East →'], ['reset', 'All Nigeria']]) {
    const changes = action === 'reset' ? { place: '', bbox: '' } : { place: '', bbox: encodeBounds(shiftBounds(bounds, action)) };
    const anchor = link(label, coverageQuery(data.filters, changes), 'button secondary'); navigation.push({ anchor, changes }); controls.append(anchor);
  }
  const frame = el('div', null, 'coverage-map-frame'), svg = svgNode('svg', { viewBox: '0 0 900 560', class: 'coverage-map', role: 'group', 'aria-labelledby': `${id}-title`, 'aria-describedby': `${id}-help` });
  svg.append(svgNode('title', { id: `${id}-title` }, 'Nigeria demand and driver coverage map'));
  const path = NIGERIA_POLYGONS.map((polygon) => polygon.map((ring) => ring.map((point, index) => {
    const [x, y] = projection.point(point); return `${index ? 'L' : 'M'}${x.toFixed(2)},${y.toFixed(2)}`;
  }).join(' ') + 'Z').join(' ')).join(' ');
  const defs = svgNode('defs'), clip = svgNode('clipPath', { id: `${id}-country` }); clip.append(svgNode('path', { d: path, 'clip-rule': 'evenodd' }));
  const viewClip = svgNode('clipPath', { id: `${id}-viewport` }), [viewX, viewY] = projection.point([bounds.west, bounds.north]), [viewRight, viewBottom] = projection.point([bounds.east, bounds.south]);
  viewClip.append(svgNode('rect', { x: viewX, y: viewY, width: viewRight - viewX, height: viewBottom - viewY })); defs.append(clip, viewClip); svg.append(defs);
  const plot = svgNode('g', { 'clip-path': `url(#${id}-viewport)` }); svg.append(plot);
  plot.append(svgNode('path', { d: path, class: 'coverage-country', 'fill-rule': 'evenodd', 'aria-hidden': 'true' }));
  const cellGroup = svgNode('g', { 'clip-path': `url(#${id}-country)` }), detail = el('aside', null, 'coverage-selection', { 'aria-label': 'Selected grid cell', 'aria-live': 'polite' });
  detail.append(selectionDetails(null));
  function select(cell, focus = false) {
    state.selected = cell.key;
    for (const item of drawn) { const selected = item.cell.key === cell.key; item.node.setAttribute('aria-pressed', selected); item.node.setAttribute('tabindex', selected ? '0' : '-1'); if (selected && focus) item.node.focus(); }
    detail.replaceChildren(selectionDetails(cell));
  }
  for (const [index, cell] of data.cells.entries()) {
    const [left, top] = projection.point([cell.bounds.west, cell.bounds.north]), [right, bottom] = projection.point([cell.bounds.east, cell.bounds.south]);
    const node = svgNode('rect', { x: left, y: top, width: Math.max(0, right - left), height: Math.max(0, bottom - top), tabindex: index === 0 ? 0 : -1, role: 'button', 'aria-pressed': 'false' });
    node.addEventListener('click', () => select(cell));
    node.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); select(cell); }
      if (['ArrowRight', 'ArrowLeft', 'ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
        event.preventDefault(); const step = ['ArrowLeft', 'ArrowUp'].includes(event.key) ? -1 : 1;
        const next = event.key === 'Home' ? 0 : event.key === 'End' ? drawn.length - 1 : (index + step + drawn.length) % drawn.length; select(drawn[next].cell, true);
      }
    });
    node.append(svgNode('title', {}, `Grid ${cell.key} · ${count(cell.requests)} historical requests · ${count(cell.waitingRequests)} waiting now · ${count(cell.availableDrivers)} drivers available now`));
    drawn.push({ node, cell }); cellGroup.append(node);
  }
  plot.append(cellGroup);
  const placed = [], widthDegrees = bounds.east - bounds.west;
  for (const place of NIGERIA_MAP_PLACES) {
    if (place.longitude < bounds.west || place.longitude > bounds.east || place.latitude < bounds.south || place.latitude > bounds.north || (place.kind === 'district' && widthDegrees > 1)) continue;
    const [x, y] = projection.point([place.longitude, place.latitude]), length = Math.min(145, place.name.length * 6 + 12);
    if (placed.some((other) => Math.abs(other.y - y) < 20 && x < other.x + other.length && x + length > other.x)) continue;
    const marker = svgNode('g', { class: 'coverage-place', 'aria-hidden': 'true' });
    marker.append(svgNode('circle', { cx: x, cy: y, r: 3 }), svgNode('text', { x: x + 6, y: y - 5 }, place.name)); plot.append(marker); placed.push({ x, y, length });
  }
  const key = el('div'), help = el('p', 'Use the zoom and direction links to explore any part of Nigeria. Tab to the grid, use arrow keys to move between recorded cells, and Enter or Space to inspect. The table provides the same measurements.', 'definition-note', { id: `${id}-help` });
  function renderLayer(layer) {
    state.layer = layer; const maximum = Math.max(0, ...data.cells.map((cell) => metricValue(cell, layer) ?? 0));
    for (const { node, cell } of drawn) {
      node.setAttribute('class', `coverage-cell tone-${cellTone(cell, layer, maximum)}`);
      const value = layer === 'coverage' ? `${count(cell.waitingRequests)} waiting requests and ${count(cell.availableDrivers)} available drivers` : layer === 'wait' ? `${waitLabel(cell.meanPickupWaitSeconds)} mean observed pickup wait from ${count(cell.pickupWaitObservations)} observations` : `${count(metricValue(cell, layer))} ${layer === 'unserved' ? 'unserved requests' : 'requests'}`;
      node.setAttribute('aria-label', `Grid ${cell.key}: ${value}. Inspect cell.`);
    }
    for (const button of buttons) button.setAttribute('aria-pressed', button.dataset.layer === layer);
    for (const { anchor, changes } of navigation) anchor.setAttribute('href', coverageQuery(data.filters, { ...changes, layer }));
    description.textContent = layerDescription(layer); key.replaceChildren(legend(layer, maximum, layer === 'wait' ? data.cells.some((cell) => cell.pickupWaitObservations > 0 && cell.meanPickupWaitSeconds != null) : maximum > 0)); onLayerChange(layer);
  }
  for (const [layer, label] of COVERAGE_LAYERS) {
    const button = el('button', label, 'button secondary', { type: 'button', 'data-layer': layer }); button.addEventListener('click', () => renderLayer(layer)); buttons.push(button); layerBar.append(button);
  }
  frame.append(svg); const layout = el('div', null, 'coverage-map-layout'); layout.append(frame, detail);
  root.append(layerBar, description, controls, layout, key, help); renderLayer(state.layer);
  return { node: root, select, currentLayer: () => state.layer };
}
