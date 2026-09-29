import { NIGERIA_POLYGONS } from './nigeria-boundary.mjs';

/** Display/search extent only: use insideNigeria for coordinate validation. */
export const NIGERIA_BOUNDS = Object.freeze({ west: 2.671082, south: 4.272162, east: 14.669936, north: 13.880291 });
export const NIGERIA_CENTER = Object.freeze({ lat: 9.0765, lng: 8.6753 });
export const OUTSIDE_NIGERIA_PICKUP_MESSAGE = "You're testing from outside Nigeria. Pickups are supported only in Nigeria, so we can't show a suggested fare from your current location.";

/** Legacy sample geography, retained for saved Abuja demo fixtures only. */
export const ABUJA_BOUNDS = Object.freeze({ west: 7.1, south: 8.8, east: 7.65, north: 9.25 });
export const ABUJA_CENTER = Object.freeze({ lat: 9.0765, lng: 7.3986 });
export const canShareLocation = (status) => ['booked', 'on_way', 'arrived', 'in_progress'].includes(status);
export function insideAbuja(point) {
  return point && Number.isFinite(point.lat) && Number.isFinite(point.lng)
    && point.lat >= ABUJA_BOUNDS.south && point.lat <= ABUJA_BOUNDS.north
    && point.lng >= ABUJA_BOUNDS.west && point.lng <= ABUJA_BOUNDS.east;
}

// Ray casting includes exact boundary vertices/edges. The tiny tolerance only
// covers floating-point rounding (well below a metre), never a border buffer.
function withinRing(point, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [x1, y1] = ring[j], [x2, y2] = ring[i];
    const cross = (point.lng - x1) * (y2 - y1) - (point.lat - y1) * (x2 - x1);
    if (Math.abs(cross) <= 1e-12
      && point.lng >= Math.min(x1, x2) - 1e-12 && point.lng <= Math.max(x1, x2) + 1e-12
      && point.lat >= Math.min(y1, y2) - 1e-12 && point.lat <= Math.max(y1, y2) + 1e-12) return true;
    if ((y1 > point.lat) !== (y2 > point.lat)
      && point.lng < (x2 - x1) * (point.lat - y1) / (y2 - y1) + x1) inside = !inside;
  }
  return inside;
}

/** Country guard from a pinned map-scale polygon, not operational availability. */
export function insideNigeria(point) {
  if (!point || typeof point !== 'object' || Array.isArray(point)
    || !Number.isFinite(point.lat) || !Number.isFinite(point.lng)
    || point.lat < NIGERIA_BOUNDS.south || point.lat > NIGERIA_BOUNDS.north
    || point.lng < NIGERIA_BOUNDS.west || point.lng > NIGERIA_BOUNDS.east) return false;
  return NIGERIA_POLYGONS.some(([outer, ...holes]) => withinRing(point, outer)
    && !holes.some((hole) => withinRing(point, hole)));
}
export function distanceMeters(a, b) {
  const rad = Math.PI / 180, dLat = (b.lat - a.lat) * rad, dLng = (b.lng - a.lng) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2;
  return 6371000 * 2 * Math.asin(Math.sqrt(Math.min(1, h)));
}
export function project(point, zoom) {
  const size = 256 * 2 ** zoom, sin = Math.sin(point.lat * Math.PI / 180);
  return { x: (point.lng + 180) / 360 * size, y: (0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI)) * size };
}
export function unproject(point, zoom) {
  const size = 256 * 2 ** zoom;
  return { lat: Math.atan(Math.sinh(Math.PI * (1 - 2 * point.y / size))) * 180 / Math.PI, lng: point.x / size * 360 - 180 };
}
