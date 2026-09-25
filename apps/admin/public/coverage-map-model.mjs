import { NIGERIA_BOUNDS } from '/shared/locations.mjs';

export const COVERAGE_LAYERS = Object.freeze([
  ['coverage', 'Coverage now'], ['demand', 'Request demand'], ['wait', 'Pickup waiting time'], ['unserved', 'Unserved requests'],
]);
export const waitLabel = (seconds) => {
  if (seconds == null || !Number.isFinite(seconds)) return '—';
  const rounded = Math.round(seconds); return rounded < 60 ? `${rounded} sec` : `${Math.floor(rounded / 60)} min ${rounded % 60} sec`;
};
export const boundsLabel = (bounds) => `${bounds.west.toFixed(3)}°–${bounds.east.toFixed(3)}° E · ${bounds.south.toFixed(3)}°–${bounds.north.toFixed(3)}° N`;
export function coverageQuery(filters, changes = {}) {
  const query = new URLSearchParams();
  for (const name of ['from', 'to', 'service', 'place', 'bbox', 'layer']) {
    const value = Object.hasOwn(changes, name) ? changes[name] : filters[name];
    if (value !== '' && value != null) query.set(name, String(value));
  }
  return '/admin/coverage' + (query.size ? '?' + query : '');
}
export function encodeBounds(bounds) { return ['west', 'south', 'east', 'north'].map((key) => Number(bounds[key].toFixed(6))).join(','); }
export function shiftBounds(bounds, action) {
  const country = NIGERIA_BOUNDS, fullWidth = country.east - country.west, fullHeight = country.north - country.south;
  let width = bounds.east - bounds.west, height = bounds.north - bounds.south, x = (bounds.east + bounds.west) / 2, y = (bounds.north + bounds.south) / 2;
  if (action === 'in' || action === 'out') { const factor = action === 'in' ? 0.5 : 2; width = Math.max(0.02, Math.min(fullWidth, width * factor)); height = Math.max(0.02, Math.min(fullHeight, height * factor)); }
  if (action === 'west') x -= width * 0.6; if (action === 'east') x += width * 0.6;
  if (action === 'north') y += height * 0.6; if (action === 'south') y -= height * 0.6;
  x = Math.max(country.west + width / 2, Math.min(country.east - width / 2, x)); y = Math.max(country.south + height / 2, Math.min(country.north - height / 2, y));
  return { west: x - width / 2, south: y - height / 2, east: x + width / 2, north: y + height / 2 };
}
export function mapProjection(bounds, width = 900, height = 560) {
  const cosine = Math.cos((bounds.north + bounds.south) / 2 * Math.PI / 180), spanX = (bounds.east - bounds.west) * cosine, spanY = bounds.north - bounds.south;
  const scale = Math.min(width / spanX, height / spanY), left = (width - spanX * scale) / 2, top = (height - spanY * scale) / 2;
  return { width, height, point: ([longitude, latitude]) => [left + (longitude - bounds.west) * cosine * scale, top + (bounds.north - latitude) * scale] };
}
export function metricValue(cell, layer) {
  if (layer === 'demand') return cell.requests;
  if (layer === 'unserved') return cell.unserved;
  if (layer === 'wait') return cell.meanPickupWaitSeconds;
  return cell.waitingRequests;
}
export function cellTone(cell, layer, maximum) {
  if (layer === 'coverage') {
    if (cell.waitingRequests === 0) return cell.availableDrivers > 0 ? 'supply' : 'none';
    if (cell.availableDrivers === 0) return 'no-supply';
    return cell.waitingRequests > cell.availableDrivers ? 'more-requests' : 'covered';
  }
  const value = metricValue(cell, layer);
  if (value == null || (layer !== 'wait' && value === 0)) return 'none';
  return `level-${maximum > 0 ? Math.max(1, Math.ceil(value / maximum * 4)) : 1}`;
}
export function layerDescription(layer) {
  return {
    coverage: 'Unmatched, unexpired requests and eligible available drivers at the same snapshot. Local counts do not predict a successful match or a shortage.',
    demand: 'Requests created during the selected Nigeria date range, grouped by their recorded pickup GPS cell.',
    wait: 'Observed mean time from booking to the driver’s first recorded arrival, for requests created in the selected dates. Missing arrival timing is not zero wait.',
    unserved: 'Requests from the selected dates that expired without a driver match, using their outcome at this snapshot.',
  }[layer];
}
