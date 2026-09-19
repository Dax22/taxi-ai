/** Preview coverage rectangle, not an administrative boundary or launch promise. */
export const ABUJA_BOUNDS = Object.freeze({ west: 7.1, south: 8.8, east: 7.65, north: 9.25 });
export const ABUJA_CENTER = Object.freeze({ lat: 9.0765, lng: 7.3986 });
export const canShareLocation = (status) => ['booked', 'on_way', 'arrived', 'in_progress'].includes(status);
export function insideAbuja(point) {
  return point && Number.isFinite(point.lat) && Number.isFinite(point.lng)
    && point.lat >= ABUJA_BOUNDS.south && point.lat <= ABUJA_BOUNDS.north
    && point.lng >= ABUJA_BOUNDS.west && point.lng <= ABUJA_BOUNDS.east;
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
