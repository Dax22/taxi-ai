import { check } from '../../shared/errors.mjs';
import { fields } from '../../shared/validation.mjs';
import { resolveFoodArea } from '../../../../../packages/shared/src/nigeria-areas.mjs';

export const MATCHING_WINDOW_MS = 24 * 60 * 60_000;
export const QUEUE_STATUSES = Object.freeze({
  waiting: ['requested'], active: ['negotiating', 'agreed', 'booked', 'on_way', 'arrived', 'in_progress'],
  drivers: ['available'], eats: ['placed', 'accepted', 'preparing', 'ready', 'assigned', 'picked_up', 'arrived'],
});
// Operational review thresholds, not customer delivery promises or inferred ETAs.
export const DELAY_POLICY = Object.freeze({ id: 'stage-review-v1', placedSeconds: 300, preparationGraceSeconds: 600,
  readySeconds: 600, pickupReadySeconds: 900, assignedSeconds: 1200, pickedUpSeconds: 2700, arrivedSeconds: 600 });
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;

export function operationsFilters(input = {}) {
  fields(input, ['queue', 'limit', 'after', 'region', 'status'], []);
  const queue = input.queue ?? 'waiting';
  check(Object.hasOwn(QUEUE_STATUSES, queue), 'INVALID_INPUT', 'Choose an operations queue.');
  const limit = input.limit === undefined ? 25 : Number(input.limit);
  check(Number.isInteger(limit) && limit >= 1 && limit <= 50 && (input.limit === undefined || /^\d+$/.test(input.limit)),
    'INVALID_INPUT', 'Choose a page size from 1 to 50.');
  const status = input.status || 'all';
  check(status === 'all' || QUEUE_STATUSES[queue].includes(status), 'INVALID_INPUT', 'Choose a status from this queue.');
  const region = input.region?.trim() ?? '';
  check(region.length <= 320 && !/[\u0000-\u001f\u007f]/u.test(region), 'INVALID_INPUT', 'Choose a valid saved region.');
  let after = null;
  if (input.after) {
    const [time, id, extra] = input.after.split('.');
    check(extra === undefined && /^\d{1,16}$/.test(time) && Number.isSafeInteger(Number(time)) && uuid.test(id ?? ''),
      'INVALID_INPUT', 'This page reference is invalid. Return to the first page.');
    after = { time: Number(time), id };
  }
  return { queue, limit, status, region, after };
}

export function regionSummary(key) {
  if (!key) return null;
  if (key.startsWith('sample:')) {
    const area = resolveFoodArea(key.slice(7));
    return { key, label: area ? `${area.name} (sample)` : key };
  }
  const area = resolveFoodArea(key);
  return { key, label: area?.name ?? key };
}

export function operationRow(row, queue, now) {
  const common = { id: row.id, createdAt: Number(row.createdAt), updatedAt: Number(row.updatedAt),
    status: row.status, region: regionSummary(row.regionKey) };
  if (queue === 'waiting') return { ...common, vehicleCategory: row.vehicleCategory,
    waitSeconds: Math.max(0, Math.floor((now - row.createdAt) / 1000)), expiresAt: Number(row.expiresAt),
    pendingOffer: Boolean(row.pendingOffer) };
  if (queue === 'active') return { ...common, vehicleCategory: row.vehicleCategory, driverName: row.driverName };
  if (queue === 'drivers') return { ...common, driverName: row.driverName, vehicleCategory: row.vehicleCategory,
    mode: row.mode, lastSeenAt: Number(row.updatedAt), leaseExpiresAt: Number(row.expiresAt) };
  const waitSeconds = Math.max(0, Math.floor((now - row.updatedAt) / 1000));
  return { ...common, storeName: row.storeName, fulfillment: row.fulfillment, waitSeconds,
    delaySeconds: Math.max(0, waitSeconds - Number(row.expectedStageSeconds)), expectedStageSeconds: Number(row.expectedStageSeconds) };
}

export function operationPage(rows, filter, now) {
  const items = rows.slice(0, filter.limit).map((row) => operationRow(row, filter.queue, now));
  const last = items.at(-1);
  return { items, limit: filter.limit, nextCursor: rows.length > filter.limit ? `${last.createdAt}.${last.id}` : null };
}
