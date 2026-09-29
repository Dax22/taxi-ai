import { parseVehicle } from './mobile-contracts.mjs';
import { insideNigeria } from './locations.mjs';
import { TRANSPORT_CATEGORIES } from './transport-categories.mjs';

const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const only = (value, keys) => Object.keys(value).every(key => keys.includes(key));
const integer = value => Number.isSafeInteger(value) && value >= 0;
const uuid = value => typeof value === 'string' && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(value);
const text = (value, max = 240) => typeof value === 'string' && value.trim() === value && value.length > 0 && value.length <= max && !/[\u0000-\u001f\u007f]/u.test(value);
const statuses = new Set(['requested', 'negotiating', 'agreed', 'booked', 'on_way', 'arrived', 'in_progress', 'completed', 'cancelled', 'expired']);
function expect(ok) { if (!ok) throw new Error('Taxi Ai returned an incompatible parcel response. Refresh and try again.'); }
function envelope(value, keys) {
  expect(object(value) && only(value, [...keys, 'serverNow', 'apiVersion'])
    && (value.serverNow === undefined || integer(value.serverNow)) && (value.apiVersion === undefined || value.apiVersion === 1));
}
export function readParcelInvitationResponse(value, rideId) {
  envelope(value, ['invitation', 'token', 'replayed']);
  const invitation = value.invitation;
  expect(object(invitation) && only(invitation, ['rideId', 'canCreate', 'link']) && uuid(invitation.rideId)
    && (rideId === undefined || invitation.rideId === rideId) && typeof invitation.canCreate === 'boolean');
  const link = invitation.link;
  expect(link === null || object(link) && only(link, ['id', 'version', 'active', 'expiresAt', 'claimed'])
    && uuid(link.id) && integer(link.version) && typeof link.active === 'boolean' && integer(link.expiresAt) && typeof link.claimed === 'boolean');
  expect(value.replayed === undefined || typeof value.replayed === 'boolean');
  expect(value.token === undefined || typeof value.token === 'string' && /^[a-f0-9]{64}$/.test(value.token)
    && link?.active === true && link.claimed === false && invitation.canCreate && value.replayed !== true);
  return value;
}
export function readParcelSnapshot(value, rideId) {
  expect(object(value) && only(value, ['rideId', 'reference', 'status', 'description', 'weightKg', 'recipientName', 'destination', 'driver', 'location', 'dropoffPin', 'verifiedAt', 'updatedAt'])
    && uuid(value.rideId) && (rideId === undefined || value.rideId === rideId) && value.reference === `PARCEL-${value.rideId.slice(0, 8).toUpperCase()}`
    && statuses.has(value.status) && text(value.description, 240) && Number.isFinite(value.weightKg) && value.weightKg > 0
    && value.weightKg <= TRANSPORT_CATEGORIES.truck.maxLoadKg && Math.abs(value.weightKg * 1000 - Math.round(value.weightKg * 1000)) < 0.000001
    && text(value.recipientName, 100) && text(value.destination, 240) && integer(value.updatedAt)
    && (value.verifiedAt === null || integer(value.verifiedAt)));
  expect(value.driver === null || object(value.driver) && only(value.driver, ['name', 'vehicle']) && text(value.driver.name, 100));
  if (value.driver) parseVehicle(value.driver.vehicle);
  const location = value.location;
  expect(location === null || value.status === 'in_progress' && object(location)
    && only(location, ['lat', 'lng', 'accuracy', 'capturedAt', 'source', 'stale'])
    && insideNigeria(location)
    && Number.isFinite(location.accuracy) && location.accuracy >= 0 && location.accuracy <= 10_000
    && integer(location.capturedAt) && location.source === 'driver_shared' && location.stale === false);
  expect(value.dropoffPin === null || value.status === 'in_progress' && typeof value.dropoffPin === 'string' && /^\d{6}$/.test(value.dropoffPin));
  return value;
}
export function readParcelResponse(value, rideId) {
  envelope(value, ['parcel', 'replayed']);
  readParcelSnapshot(value.parcel, rideId);
  expect(value.replayed === undefined || typeof value.replayed === 'boolean');
  return value;
}
export function readReceivedParcelsResponse(value) {
  envelope(value, ['parcels']);
  expect(Array.isArray(value.parcels) && value.parcels.length <= 50);
  const seen = new Set();
  for (const parcel of value.parcels) { readParcelSnapshot(parcel); expect(!seen.has(parcel.rideId)); seen.add(parcel.rideId); }
  return value;
}
