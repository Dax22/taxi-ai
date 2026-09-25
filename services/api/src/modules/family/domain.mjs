import { check } from '../../shared/errors.mjs';
export const ACTIVE_TRIP_STATUSES = Object.freeze(['booked', 'on_way', 'arrived', 'in_progress']);
export const FAMILY_LIMIT = 5;
export const INVITATION_TTL = 7 * 86_400_000;
export const ARRIVAL_TTL = 86_400_000;
export const CHECK_IN_COOLDOWN = 300_000;
export const RESPONSE_COOLDOWN = 60_000;
export const identifier = value => typeof value === 'string' && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(value);
export const canonical = value => JSON.stringify(value, (_, item) => item && typeof item === 'object' && !Array.isArray(item)
  ? Object.fromEntries(Object.keys(item).sort().map(key => [key, item[key]])) : item);
export function version(row, expected) {
  check(Number.isSafeInteger(expected) && expected >= 0, 'INVALID_VERSION', 'Use the current Family Safety version.');
  check(row.version === expected, 'STALE_VERSION', 'Family Safety changed. Refresh and try again.');
}
export function contactStatus(row, now) { return row.status === 'pending' && now >= row.expiresAt ? 'expired' : row.status; }
export function shareVisible(row, now) {
  return row && row.contactStatus === 'active' && (Boolean(row.active)
    || row.reason === 'completed' && now < row.endedAt + ARRIVAL_TTL);
}
export const EVENT_TITLES = Object.freeze({
  invitation: 'Family Safety invitation', accepted: 'Family Safety invitation accepted',
  shared: 'A trip is being shared with you', stopped: 'Trip sharing ended',
  booked: 'Ride booked', on_way: 'Driver is on the way', arrived: 'Driver arrived at pickup',
  in_progress: 'Trip started', completed: 'Driver completed the trip', cancelled: 'Trip cancelled',
  check_in: 'Please check in', okay: 'Passenger says they are okay', help: 'Passenger asked for help',
  safe_arrival: 'Passenger confirmed safe arrival',
});
