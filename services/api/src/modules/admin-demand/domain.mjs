import { check } from '../../shared/errors.mjs';
import { fields } from '../../shared/validation.mjs';
import { NIGERIA_BOUNDS } from '../../../../../packages/shared/src/locations.mjs';
import { NIGERIA_MAP_PLACES, mapPlaceBounds } from '../../../../../packages/shared/src/nigeria-map-places.mjs';
import { DEMO_AREAS } from '../../../../../packages/shared/src/demo-booking.mjs';

export const DAY_MS = 86_400_000;
export const WAT_MS = 3_600_000;
export const MAX_DAYS = 90;
const sampleAreaIds = Object.freeze(DEMO_AREAS.map(({ id }) => id));
const datePattern = /^\d{4}-\d{2}-\d{2}$/;

function dateTime(value) {
  check(typeof value === 'string' && datePattern.test(value), 'INVALID_INPUT', 'Use a calendar date in YYYY-MM-DD format.');
  const time = Date.parse(`${value}T00:00:00Z`);
  check(Number.isFinite(time) && time >= 0 && new Date(time).toISOString().slice(0, 10) === value,
    'INVALID_INPUT', 'Choose a valid calendar date.');
  return time - WAT_MS;
}

export function demandRegion(key) {
  if (!key || key === 'unassigned') return { key: 'unassigned', label: 'Area not recorded', kind: 'unassigned' };
  if (/^ng:\d{1,4}:\d{1,4}$/.test(key)) return { key, label: `Dispatch cell ${key.slice(3)}`, kind: 'dispatch_cell' };
  if (key.startsWith('sample:')) {
    const area = DEMO_AREAS.find((item) => item.id === key.slice(7));
    if (area) return { key, label: `${area.name} (sample)`, kind: 'sample' };
  }
  // Never echo an unrecognized saved key: it may contain legacy address text.
  return { key: 'unassigned', label: 'Area not recorded', kind: 'unassigned' };
}

export function demandFilters(input = {}, now) {
  fields(input, ['from', 'to', 'service', 'region', 'limit'], []);
  const today = new Date(now + WAT_MS).toISOString().slice(0, 10);
  const to = input.to ?? today;
  const end = dateTime(to) + DAY_MS;
  const from = input.from ?? new Date(end - 7 * DAY_MS + WAT_MS).toISOString().slice(0, 10);
  const since = dateTime(from);
  check(since < end && end - since <= MAX_DAYS * DAY_MS, 'INVALID_INPUT', `Choose a date range of up to ${MAX_DAYS} days.`);
  check(to <= today, 'INVALID_INPUT', 'Demand reports cannot include future dates.');
  const service = input.service ?? 'all';
  check(['all', 'ride', 'courier'].includes(service), 'INVALID_INPUT', 'Choose rides, courier deliveries or all services.');
  check(input.region === undefined || typeof input.region === 'string', 'INVALID_INPUT', 'Choose a saved demand area.');
  const region = input.region?.trim() ?? '';
  check(region.length <= 160 && (!region || demandRegion(region).key === region),
    'INVALID_INPUT', 'Choose a saved dispatch cell, sample area or unassigned area.');
  const limit = input.limit === undefined ? 30 : Number(input.limit);
  check(Number.isInteger(limit) && limit >= 1 && limit <= 50 && (input.limit === undefined || /^\d+$/.test(input.limit)),
    'INVALID_INPUT', 'Choose an area limit from 1 to 50.');
  return { from, to, since, until: Math.min(end, now + 1), end, service, region, limit, sampleAreaIds };
}

export function demandMetrics(row = {}) {
  return { requests: Number(row.requests ?? 0), matched: Number(row.matched ?? 0),
    completed: Number(row.completed ?? 0), unserved: Number(row.unserved ?? 0), cancelled: Number(row.cancelled ?? 0),
    open: Number(row.open ?? 0), matchedWithTiming: Number(row.matchedWithTiming ?? 0),
    meanMatchSeconds: row.meanMatchSeconds == null ? null : Number(row.meanMatchSeconds) };
}

export function demandDaily(rows, filter) {
  const indexed = new Map(rows.map((row) => [Number(row.day), row]));
  const result = [];
  for (let time = filter.since; time < filter.end; time += DAY_MS) {
    const day = Math.floor((time + WAT_MS) / DAY_MS);
    result.push({ date: new Date(day * DAY_MS).toISOString().slice(0, 10), ...demandMetrics(indexed.get(day)) });
  }
  return result;
}

export function demandHours(rows) {
  const indexed = new Map(rows.map((row) => [Number(row.hour), row]));
  return Array.from({ length: 24 }, (_, hour) => ({ hour, ...demandMetrics(indexed.get(hour)) }));
}


export const COVERAGE_MAX_CELLS = 1600;
const gridSteps = Object.freeze([0.01, 0.02, 0.05, 0.1, 0.2, 0.5, 1]);
export function coverageFilters(input = {}, now) {
  fields(input, ['from', 'to', 'service', 'place', 'bbox', 'layer'], []);
  const dateInput = Object.fromEntries(['from', 'to', 'service'].filter(key => input[key] !== undefined).map(key => [key, input[key]]));
  const base = demandFilters(dateInput, now);
  check(input.place === undefined || typeof input.place === 'string', 'INVALID_INPUT', 'Choose a saved map place.');
  const placeId = input.place ?? '';
  let place = placeId ? NIGERIA_MAP_PLACES.find(item => item.id === placeId) : null;
  check(!placeId || place, 'INVALID_INPUT', 'Choose a saved map place.');
  const layer = input.layer ?? 'coverage';
  check(['demand', 'coverage', 'wait', 'unserved'].includes(layer), 'INVALID_INPUT', 'Choose a supported map layer.');
  let bounds = place ? mapPlaceBounds(place) : { ...NIGERIA_BOUNDS };
  if (input.bbox !== undefined && input.bbox !== '') {
    check(typeof input.bbox === 'string' && input.bbox.length <= 160, 'INVALID_INPUT', 'Choose valid map bounds.');
    const parts = input.bbox.split(',');
    check(parts.length === 4 && parts.every(value => /^-?(?:\d+(?:\.\d*)?|\.\d+)$/.test(value)), 'INVALID_INPUT', 'Use west,south,east,north coordinates.');
    const [west, south, east, north] = parts.map(Number);
    bounds = { west, south, east, north };
    place = null;
  }
  const { west, south, east, north } = bounds;
  check(Object.values(bounds).every(Number.isFinite) && west < east && south < north
    && west >= NIGERIA_BOUNDS.west && east <= NIGERIA_BOUNDS.east
    && south >= NIGERIA_BOUNDS.south && north <= NIGERIA_BOUNDS.north,
  'INVALID_INPUT', 'Map bounds must be an ordered viewport within Nigeria’s national extent.');
  // Snap the effective query as well as its returned bounds to whole grid
  // cells. Arbitrary sub-cell rectangles must not become precise-pin probes.
  let cellDegrees;
  const round = value => Math.round(value * 1e8) / 1e8;
  const index = (value, step) => Number((value / step).toFixed(8));
  for (const step of gridSteps) {
    const snapped = { west: Math.max(NIGERIA_BOUNDS.west, round(Math.floor(index(west, step)) * step)),
      south: Math.max(NIGERIA_BOUNDS.south, round(Math.floor(index(south, step)) * step)),
      east: Math.min(NIGERIA_BOUNDS.east, round(Math.ceil(index(east, step)) * step)),
      north: Math.min(NIGERIA_BOUNDS.north, round(Math.ceil(index(north, step)) * step)) };
    const columns = Math.ceil(index(snapped.east, step)) - Math.floor(index(snapped.west, step));
    const rows = Math.ceil(index(snapped.north, step)) - Math.floor(index(snapped.south, step));
    if (columns * rows <= COVERAGE_MAX_CELLS) { cellDegrees = step; bounds = snapped; break; }
  }
  check(cellDegrees, 'INVALID_INPUT', 'Choose a smaller map viewport.');
  return { ...base, place, bounds, cellDegrees, layer, nationalBounds: NIGERIA_BOUNDS,
    bbox: input.bbox ? [bounds.west, bounds.south, bounds.east, bounds.north].join(',') : '' };
}

export function coverageHistorical(row = {}) {
  return { requests: Number(row.requests ?? 0), unserved: Number(row.unserved ?? 0),
    pickupWaitObservations: Number(row.pickupWaitObservations ?? 0),
    meanPickupWaitSeconds: row.meanPickupWaitSeconds == null ? null : Number(row.meanPickupWaitSeconds) };
}
export function coverageCurrent(row = {}) {
  return { waitingRequests: Number(row.waitingRequests ?? 0), availableDrivers: Number(row.availableDrivers ?? 0),
    waitingObservations: Number(row.waitingObservations ?? 0),
    meanWaitingSeconds: row.meanWaitingSeconds == null ? null : Number(row.meanWaitingSeconds),
    maxWaitingSeconds: row.maxWaitingSeconds == null ? null : Number(row.maxWaitingSeconds) };
}
export function coverageSummary(rows = []) {
  const totals = { requests: 0, unserved: 0, pickupWaitObservations: 0, waitingRequests: 0, availableDrivers: 0,
    waitingObservations: 0, meanPickupWaitSeconds: null, meanWaitingSeconds: null, maxWaitingSeconds: null };
  let pickupSum = 0, waitingSum = 0;
  for (const row of rows) {
    for (const key of ['requests', 'unserved', 'pickupWaitObservations', 'waitingRequests', 'availableDrivers', 'waitingObservations']) totals[key] += Number(row[key] ?? 0);
    pickupSum += Number(row.meanPickupWaitSeconds ?? 0) * Number(row.pickupWaitObservations ?? 0);
    waitingSum += Number(row.meanWaitingSeconds ?? 0) * Number(row.waitingObservations ?? 0);
    if (row.maxWaitingSeconds != null) totals.maxWaitingSeconds = Math.max(totals.maxWaitingSeconds ?? 0, Number(row.maxWaitingSeconds));
  }
  totals.meanPickupWaitSeconds = totals.pickupWaitObservations ? pickupSum / totals.pickupWaitObservations : null;
  totals.meanWaitingSeconds = totals.waitingObservations ? waitingSum / totals.waitingObservations : null;
  return { historical: coverageHistorical(totals), current: coverageCurrent(totals) };
}
export function coverageCell(row, filter) {
  const x = Number(row.cellX), y = Number(row.cellY), step = filter.cellDegrees;
  const round = value => Math.round(value * 1e8) / 1e8;
  // Clip the coarse cell to the requested viewport, never expose a saved pin.
  return { key: `${step}:${x}:${y}`, bounds: { west: round(Math.max(filter.bounds.west, x * step)),
    south: round(Math.max(filter.bounds.south, y * step)), east: round(Math.min(filter.bounds.east, (x + 1) * step)),
    north: round(Math.min(filter.bounds.north, (y + 1) * step)) }, ...coverageHistorical(row), ...coverageCurrent(row) };
}
