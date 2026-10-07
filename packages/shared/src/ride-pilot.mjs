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

/** Passenger requests only. Existing trips, Courier and Eats keep their own policies. */
export function createRidePilotConfig(env = {}, mode = 'local') {
  const flag = env.TAXI_AI_RIDES_PAUSED ?? (mode === 'staging' ? 'true' : 'false');
  if (!['true', 'false'].includes(flag)) throw new Error('TAXI_AI_RIDES_PAUSED must be true or false.');
  const coverageMode = env.TAXI_AI_RIDE_COVERAGE ?? 'pilot';
  if (!['pilot', 'nigeria'].includes(coverageMode)) throw new Error('TAXI_AI_RIDE_COVERAGE must be pilot or nigeria.');
  const paused = flag === 'true', bounds = parseBounds(env.TAXI_AI_RIDE_PILOT_BOUNDS);
  if (coverageMode === 'nigeria' && bounds) throw new Error('Nigeria coverage cannot be combined with TAXI_AI_RIDE_PILOT_BOUNDS.');
  if (mode === 'staging' && !paused && !bounds && coverageMode !== 'nigeria') {
    throw new Error('Unpausing hosted passenger rides requires TAXI_AI_RIDE_PILOT_BOUNDS or explicit TAXI_AI_RIDE_COVERAGE=nigeria.');
  }
  // Bump the Nigeria signature when the shared country-boundary policy changes.
  const signature = coverageMode === 'nigeria' ? 'nigeria-boundary-v1' : bounds ? JSON.stringify(bounds) : null;
  const contains = (point) => coverageMode === 'nigeria' ? insideNigeria(point)
    : Boolean(bounds && point && Number.isFinite(point.lat) && Number.isFinite(point.lng)
      && point.lat >= bounds.minLat && point.lat <= bounds.maxLat && point.lng >= bounds.minLng && point.lng <= bounds.maxLng);
  return Object.freeze({ paused, bounds, coverageMode,
    describe: () => ({ paused, coverage: coverageMode === 'nigeria' ? 'nigeria' : bounds ? 'pilot' : mode === 'local' ? 'local' : 'unconfigured' }),
    // Validate raw provider points and the chosen endpoints before display downsampling.
    coverage(coordinates, endpoints = []) {
      return signature ? { signature, allowed: Array.isArray(coordinates) && coordinates.length >= 2
        && coordinates.every((p) => Array.isArray(p) && p.length === 2 && contains({ lat: p[1], lng: p[0] }))
        && endpoints.length === 2 && endpoints.every(contains) } : null;
    },
    allows(route) { return !signature || route?.ridePilotCoverage?.signature === signature && route.ridePilotCoverage.allowed === true; },
  });
}
