import { transportCategory, deliveryDetails } from './transport-categories.mjs';
import { envelope, parseVehicle } from './mobile-contracts.mjs';
import { insideNigeria } from './locations.mjs';
import { RIDE_STATUS_LABELS, canCancelRide } from './trip-lifecycle.mjs';
import { readPassenger } from './guest-rides.mjs';

const record = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const text = (v, max = 160) => typeof v === 'string' && v.length > 0 && v.length <= max;
const number = (v) => Number.isSafeInteger(v) && v >= 0;
const positive = (v) => number(v) && v > 0;
const uuid = (v) => typeof v === 'string' && /^[a-f0-9-]{36}$/.test(v);
const point = (v) => record(v) && text(v.name) && insideNigeria(v);
const only = (v, keys) => Object.keys(v).every((key) => keys.includes(key));
function expect(ok) { if (!ok) throw new Error('Taxi Ai returned an incompatible booking response. Please try again later.'); }
export function isRequestOpen(status) { return Object.hasOwn(RIDE_STATUS_LABELS, status) && !['completed','cancelled','expired'].includes(status); }
export const bookingStatusLabel = (status) => RIDE_STATUS_LABELS[status] ?? 'Refresh request';
function ride(r) {
  expect(record(r) && uuid(r.id) && number(r.version) && Object.hasOwn(RIDE_STATUS_LABELS, r.status)
    && text(r.pickup) && text(r.destination) && positive(r.suggestedFareKobo) && (r.fareKobo === null || positive(r.fareKobo))
    && (r.expiresAt === null || number(r.expiresAt)) && r.canCancel === canCancelRide(r.status));
  expect(r.driver === null || (record(r.driver) && text(r.driver.name)));
  expect(r.paymentMode === undefined || ['simulation', 'paystack_test'].includes(r.paymentMode));
  expect(transportCategory(r.vehicleCategory));
  readPassenger(r.passenger, r.vehicleCategory);
  if (r.delivery != null || transportCategory(r.vehicleCategory).service === 'delivery') {
    expect(record(r.delivery));
    expect(r.passenger?.kind !== 'guest');
    const { verifiedAt, pinBlockedUntil, dropoffPin, ...details } = r.delivery;
    deliveryDetails(r.vehicleCategory, details);
    expect((verifiedAt === null || number(verifiedAt)) && (pinBlockedUntil === null || number(pinBlockedUntil))
      && (dropoffPin === undefined || (r.status === 'in_progress' && /^\d{6}$/.test(dropoffPin))));
  } else expect(r.delivery == null);
  expect(r.service === undefined || r.service === (r.delivery ? 'delivery' : 'ride'));
  if (r.driver) parseVehicle(r.driver.vehicle);
  return r;
}
export function parseBooking(value) {
  envelope(value);
  expect(record(value.online) && typeof value.online.enabled === 'boolean'
    && ['searchHost','routeHost'].every((key) => value.online[key] === null || text(value.online[key], 253))
    && typeof value.allowSample === 'boolean' && Array.isArray(value.areas) && value.areas.length <= 20
    && value.areas.every((a) => record(a) && text(a.id, 50) && text(a.name))
    && [null,'work','online'].includes(value.blockedBy) && Array.isArray(value.current) && value.current.length <= 50);
  value.current.forEach(ride); return value;
}
export function parsePlaces(value) {
  envelope(value); expect(Array.isArray(value.places) && value.places.length <= 20 && value.places.every(point)
    && text(value.attribution, 300)); return value;
}
export function parsePreview(value) {
  envelope(value); const p = value.preview;
  expect(record(p) && ['route','sample'].includes(p.kind) && text(p.pickup) && text(p.destination)
    && positive(p.suggestedFareKobo) && record(p.request));
  const category = p.vehicleCategory ?? 'standard';
  expect(transportCategory(category) && (p.request.vehicleCategory ?? 'standard') === category);
  if (p.kind === 'sample') expect(p.expiresAt === null && p.route === null
    && text(p.request.pickupId, 50) && text(p.request.destinationId, 50) && p.request.pickupId !== p.request.destinationId
    && only(p.request, ['pickupId','destinationId','vehicleCategory']));
  else {
    const pricing = p.route?.pricing;
    expect(number(p.expiresAt) && uuid(p.request.quoteId) && only(p.request, ['quoteId','vehicleCategory']) && record(p.route)
      && positive(p.route.distanceMeters) && p.route.distanceMeters <= 2_500_000 && (transportCategory(category).service === 'delivery'
        ? p.route.distanceKind === 'straight_line' && p.route.durationSeconds === null
        : (p.route.distanceKind === undefined || p.route.distanceKind === 'road') && positive(p.route.durationSeconds) && p.route.durationSeconds <= 172_800)
      && Array.isArray(p.route.coordinates) && p.route.coordinates.length >= 2 && p.route.coordinates.length <= 1201
      && p.route.coordinates.every((c) => Array.isArray(c) && c.length === 2 && insideNigeria({ lng: c[0], lat: c[1] }))
      && (pricing === undefined || (record(pricing)
        && positive(pricing.baseKobo) && positive(pricing.distanceKobo) && number(pricing.timeKobo)
        && positive(pricing.minimumKobo) && positive(pricing.incrementKobo))));
  }
  return value;
}
export function parseBookingRide(value) { envelope(value); ride(value.ride); return value; }
