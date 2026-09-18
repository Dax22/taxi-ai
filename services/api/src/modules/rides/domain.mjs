import { FareNegotiation } from '../../../../../packages/shared/src/fare-negotiation.mjs';
import { check } from '../../shared/errors.mjs';

export function requireParticipant(ride, user) {
  check(ride.customerId === user.id || ride.driverId === user.id,
    'NOT_FOUND', 'Ride request not found.');
}

export function requireVersion(ride, version) {
  check(Number.isSafeInteger(version) && version >= 0, 'INVALID_VERSION', 'A valid request version is required.');
  check(ride.version === version, 'STALE_VERSION', 'This request changed. Review the latest details and try again.');
}

/** Replay trusted, server-written commands without importing storage or HTTP. */
export function restoreNegotiation(ride, events) {
  if (!ride.driverId) return null;
  const negotiation = new FareNegotiation({ id: ride.id, customerId: ride.customerId,
    driverId: ride.driverId, suggestedFareKobo: ride.suggestedFareKobo, now: ride.matchedAt });
  for (const event of events) {
    if (!['propose', 'accept', 'cancel'].includes(event.type)
      || event.version !== negotiation.snapshot().version + 1) throw new Error('Invalid fare event sequence');
    negotiation[event.type](event.payload);
  }
  return negotiation;
}

export function canonical(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
}
