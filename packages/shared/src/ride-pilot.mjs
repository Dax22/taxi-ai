import { insideNigeria } from './locations.mjs';

function parseBounds(value) {
  if (value === undefined || value === '') return null;
  const parts = value.split(',');
  if (parts.length !== 4 || parts.some((part) => !/^-?\d{1,3}(?:\.\d{1,6})?$/.test(part))) {
    throw new Error('TAXI_AI_RIDE_PILOT_BOUNDS needs minLat,minLng,maxLat,maxLng in decimal degrees.');
  }
  const [minLat, minLng, maxLat, maxLng] = parts.map(Number);
  if (minLat >= maxLat || minLng >= maxLng
    || !insideNigeria({ lat: minLat, lng: minLng }) || !insideNigeria({ lat: maxLat, lng: maxLng })) {
    throw new Error('TAXI_AI_RIDE_PILOT_BOUNDS must describe a valid rectangle within Nigeria.');
  }
  return Object.freeze({ minLat, minLng, maxLat, maxLng });
}

/** Passenger rides only. Courier, Eats and already created trips do not use this policy. */
export function createRidePilotConfig(env = {}, mode = 'local') {
  const flag = env.TAXI_AI_RIDES_PAUSED ?? (mode === 'staging' ? 'true' : 'false');
  if (!['true', 'false'].includes(flag)) throw new Error('TAXI_AI_RIDES_PAUSED must be true or false.');
  const paused = flag === 'true', bounds = parseBounds(env.TAXI_AI_RIDE_PILOT_BOUNDS);
  if (mode === 'staging' && !paused && !bounds) {
    throw new Error('Unpausing hosted passenger rides requires TAXI_AI_RIDE_PILOT_BOUNDS.');
  }
  // A non-secret, canonical area identifier. Quotes from a prior area cannot be
  // used after a configuration change, including after a server restart.
  const signature = bounds ? JSON.stringify(bounds) : null;
  const contains = (point) => Boolean(bounds && point && Number.isFinite(point.lat) && Number.isFinite(point.lng)
    && point.lat >= bounds.minLat && point.lat <= bounds.maxLat && point.lng >= bounds.minLng && point.lng <= bounds.maxLng);
  return Object.freeze({ paused, bounds,
    // Record the full provider geometry before the quote is shortened for display.
    coverage(coordinates, endpoints = []) {
      return bounds ? { signature, allowed: Array.isArray(coordinates) && coordinates.length >= 2
        && coordinates.every((p) => Array.isArray(p) && p.length === 2 && contains({ lat: p[1], lng: p[0] }))
        && endpoints.length === 2 && endpoints.every(contains) } : null;
    },
    allows(route) { return !bounds || route?.ridePilotCoverage?.signature === signature && route.ridePilotCoverage.allowed === true; },
  });
}
