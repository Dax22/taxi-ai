import { insideNigeria } from './locations.mjs';

const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const id = value => typeof value === 'string' && /^[a-f0-9-]{36}$/.test(value);
const time = value => Number.isSafeInteger(value) && value >= 0;
function check(value) { if (!value) throw new Error('Taxi Ai returned an incompatible food tracking response. Refresh and try again.'); }
function share(value) {
  check(object(value) && id(value.id) && id(value.orderId) && typeof value.active === 'boolean' && typeof value.owned === 'boolean'
    && time(value.sequence) && time(value.startedAt) && (value.updatedAt === null || time(value.updatedAt)) && typeof value.stale === 'boolean');
  const p = value.position;
  check(p === null || object(p) && insideNigeria(p) && Number.isFinite(p.accuracy) && p.accuracy > 0 && p.accuracy <= 200 && time(p.capturedAt));
  check((p === null) === (value.updatedAt === null));
  check(value.active || p === null);
  // Session bindings and background credentials never belong in participant projections.
  check(!['sessionHash','clientHash','token','background','driverId'].some(key => Object.hasOwn(value, key)));
}
export function readFoodTracking(value, orderId) {
  check(object(value) && time(value.serverNow) && value.orderId === orderId && typeof value.isCourier === 'boolean'
    && typeof value.canShare === 'boolean' && typeof value.required === 'boolean');
  check(!value.canShare || value.isCourier);
  if (value.share !== null) { share(value.share); check(value.share.orderId === orderId); }
  return value;
}
export function readFoodTrackingResult(value, expected = {}) {
  check(object(value) && time(value.serverNow) && typeof value.replayed === 'boolean'); share(value.share);
  if (expected.orderId) check(value.share.orderId === expected.orderId);
  if (expected.shareId) check(value.share.id === expected.shareId);
  if (expected.stopped) check(!value.share.active);
  return value;
}
