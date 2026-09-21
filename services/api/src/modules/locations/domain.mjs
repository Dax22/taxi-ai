import { check } from '../../shared/errors.mjs';
import { fields, label } from '../../shared/validation.mjs';
import { transportCategory, categoryFare } from '../../../../../packages/shared/src/transport-categories.mjs';
import { insideAbuja, distanceMeters } from '../../../../../packages/shared/src/locations.mjs';

export const QUOTE_MS = 15 * 60_000, FRESH_MS = 30_000, SHARE_MS = 60_000;
export function key(value) {
  check(typeof value === 'string' && /^[A-Za-z0-9_-]{16,128}$/.test(value), 'INVALID_IDEMPOTENCY_KEY', 'A unique location command key is required.');
  return value;
}
export function clientIdentity(value) {
  check(typeof value === 'string' && /^[a-f0-9-]{36}$/.test(value), 'INVALID_LOCATION_CLIENT', 'Use location controls in this window.');
  return value;
}
export function point(value) {
  fields(value, ['lat', 'lng', 'name']);
  check(insideAbuja(value), 'INVALID_LOCATION', 'Choose a point inside the Abuja preview area.');
  const lat = Number(value.lat.toFixed(6)), lng = Number(value.lng.toFixed(6));
  return { id: `point:${lat},${lng}`, lat, lng, name: label(value.name, 'Place name', 2, 160) };
}
export function endpoints(data) {
  fields(data, ['pickup', 'destination', 'vehicleCategory'], ['pickup', 'destination']);
  const vehicleCategory = data.vehicleCategory === undefined ? 'standard' : data.vehicleCategory;
  check(transportCategory(vehicleCategory), 'INVALID_CATEGORY', 'Choose a vehicle category.');
  const pickup = point(data.pickup), destination = point(data.destination);
  check(distanceMeters(pickup, destination) >= 100, 'INVALID_ROUTE', 'Choose points at least 100 metres apart.');
  return { pickup, destination, vehicleCategory };
}
export function checkedRoute(raw, points) {
  const { distanceMeters: metres, durationSeconds: seconds, coordinates } = raw ?? {};
  check(Number.isFinite(metres) && metres >= 100 && metres <= 300_000
    && Number.isFinite(seconds) && seconds >= 10 && seconds <= 28_800
    && Array.isArray(coordinates) && coordinates.length >= 2 && coordinates.length <= 20_000,
  'MAPS_UNAVAILABLE', 'The route provider returned unusable route details. Try different points.');
  check(coordinates.every((p) => Array.isArray(p) && p.length === 2 && insideAbuja({ lat: p[1], lng: p[0] })),
    'INVALID_ROUTE', 'This route leaves the Abuja preview area. Choose another route.');
  const near = (p) => ({ lat: p[1], lng: p[0] });
  check(distanceMeters(points.pickup, near(coordinates[0])) <= 350
    && distanceMeters(points.destination, near(coordinates.at(-1))) <= 350,
  'INVALID_ROUTE', 'A drivable road could not be found near both selected points.');
  check(metres >= distanceMeters(points.pickup, points.destination) - 700, 'MAPS_UNAVAILABLE', 'The provider returned an inconsistent route.');
  const step = Math.max(1, Math.ceil(coordinates.length / 1200));
  const geometry = coordinates.filter((_, index) => index % step === 0 || index === coordinates.length - 1)
    .map(([lng, lat]) => [Number(lng.toFixed(6)), Number(lat.toFixed(6))]);
  const distance = Math.ceil(metres), duration = Math.ceil(seconds);
  // Deliberately illustrative policy, not an Abuja market rate or AI prediction.
  const pricing = { policy: 'abuja-preview-v1', baseKobo: 50_000, perKmKobo: 20_000, perMinuteKobo: 3000,
    minimumKobo: 100_000, incrementKobo: 5000 };
  const distanceKobo = Math.ceil(distance * pricing.perKmKobo / 1000), timeKobo = Math.ceil(duration * pricing.perMinuteKobo / 60);
  const amount = Math.max(pricing.minimumKobo, Math.ceil((pricing.baseKobo + distanceKobo + timeKobo) / pricing.incrementKobo) * pricing.incrementKobo);
  return { ...points, distanceMeters: distance, durationSeconds: duration, coordinates: geometry,
    source: 'osrm', distanceKind: 'road', trafficAware: false, suggestedFareKobo: categoryFare(amount, points.vehicleCategory), currency: 'NGN',
    pricing: { ...pricing, categoryMultiplier: transportCategory(points.vehicleCategory).multiplier / 100, distanceKobo, timeKobo, illustrative: true } };
}
export function directQuote(points) {
  const distance = Math.ceil(distanceMeters(points.pickup, points.destination));
  const distanceKobo = Math.ceil(distance * 20_000 / 1000);
  const amount = Math.max(100_000, Math.ceil((50_000 + distanceKobo) / 5000) * 5000);
  return { ...points, distanceMeters: distance, durationSeconds: null,
    coordinates: [[points.pickup.lng, points.pickup.lat], [points.destination.lng, points.destination.lat]],
    source: 'direct', distanceKind: 'straight_line', trafficAware: false, currency: 'NGN',
    suggestedFareKobo: categoryFare(amount, points.vehicleCategory),
    pricing: { policy: 'delivery-direct-preview-v1', baseKobo: 50_000, perKmKobo: 20_000, perMinuteKobo: 0,
      minimumKobo: 100_000, incrementKobo: 5000, distanceKobo, timeKobo: 0, illustrative: true,
      categoryMultiplier: transportCategory(points.vehicleCategory).multiplier / 100 } };
}
export function position(data, now) {
  fields(data, ['sequence', 'lat', 'lng', 'accuracy', 'capturedAt']);
  check(Number.isSafeInteger(data.sequence) && data.sequence > 0, 'INVALID_LOCATION', 'A location sequence is required.');
  check(insideAbuja(data), 'INVALID_LOCATION', 'Your location is outside the Abuja preview area.');
  check(Number.isFinite(data.accuracy) && data.accuracy > 0 && data.accuracy <= 200, 'INVALID_LOCATION', 'Wait for a more accurate location (within 200 metres).');
  check(Number.isSafeInteger(data.capturedAt) && data.capturedAt <= now + 5000 && data.capturedAt > now - FRESH_MS,
    'INVALID_LOCATION', 'This location is too old or its clock is incorrect. Request a fresh fix.');
  return { lat: Number(data.lat.toFixed(6)), lng: Number(data.lng.toFixed(6)), accuracy: Math.ceil(data.accuracy), capturedAt: data.capturedAt };
}
