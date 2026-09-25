import { check } from '../../shared/errors.mjs';
import { fields } from '../../shared/validation.mjs';
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
