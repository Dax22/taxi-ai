import { transportCategory } from './transport-categories.mjs';
import { RIDE_STATUS_LABELS } from './trip-lifecycle.mjs';

const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const only = (value, keys) => Object.keys(value).every(key => keys.includes(key));
const integer = value => Number.isSafeInteger(value) && value >= 0;
const uuid = value => typeof value === 'string' && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(value);
const text = (value, min = 1, max = 160) => typeof value === 'string' && value.trim() === value
  && value.length >= min && value.length <= max && !/[\u0000-\u001f\u007f-\u009f]/u.test(value);
const token = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const e164 = value => typeof value === 'string' && /^\+[1-9]\d{7,14}$/.test(value);
function expect(ok) { if (!ok) throw new Error('Taxi Ai returned an incompatible guest ride response. Refresh and try again.'); }

/** Normalise contact input without guessing a country for unprefixed international numbers. */
export function guestPhone(value) {
  if (typeof value !== 'string' || value.length > 40 || !/^[+\d ()-]+$/.test(value.trim())) {
    throw new Error('Enter the passenger’s phone number with a country code, or an 11-digit Nigerian number.');
  }
  let phone = value.trim().replace(/[ ()-]/g, '');
  if (/^0[789]\d{9}$/.test(phone)) phone = '+234' + phone.slice(1);
  if (!e164(phone)) throw new Error('Enter the passenger’s phone number with a country code, or an 11-digit Nigerian number.');
  return phone;
}

/** Authoritative request contract: consent is captured at booking, never exposed in ride views. */
export function passengerDetails(value, vehicleCategory = 'standard') {
  const category = transportCategory(vehicleCategory);
  if (!category) throw new Error('Choose a vehicle category.');
  if (value === undefined) return { kind: 'self' };
  if (!record(value)) throw new Error('Choose who is riding.');
  if (value.kind === 'self' && only(value, ['kind'])) return { kind: 'self' };
  if (value.kind !== 'guest' || !only(value, ['kind', 'name', 'phone', 'consent'])) throw new Error('Choose who is riding.');
  if (category.service !== 'ride') throw new Error('Booking for a friend is available for Standard and SUV rides.');
  if (typeof value.name !== 'string' || !text(value.name.trim(), 2, 80)
    || /[\u0000-\u001f\u007f-\u009f]/u.test(value.name)) throw new Error('Enter the passenger’s name using 2–80 characters.');
  if (value.consent !== true) throw new Error('Confirm the passenger is an adult and agrees to this booking and sharing their details.');
  return { kind: 'guest', name: value.name.trim(), phone: guestPhone(value.phone), consent: true };
}

/** A passenger view is separate from the persisted booking snapshot. */
export function passengerView(snapshot, { isBooker = false, bookerName } = {}) {
  if (snapshot === undefined || snapshot === null || snapshot.kind === 'self') return { kind: 'self', ...(bookerName ? { name: bookerName } : {}) };
  const guest = passengerDetails(snapshot);
  return { kind: 'guest', name: guest.name, ...(isBooker ? { phone: guest.phone } : {}) };
}

/** Older servers may omit passenger; an explicit malformed projection is always rejected. */
export function readPassenger(value, vehicleCategory = 'standard', { allowPhone = true } = {}) {
  if (value === undefined) return value;
  expect(record(value));
  if (value.kind === 'self') {
    expect(only(value, ['kind', 'name']) && (value.name === undefined || text(value.name, 1, 100)));
  } else {
    expect(value.kind === 'guest' && transportCategory(vehicleCategory)?.service === 'ride'
      && only(value, ['kind', 'name', 'phone']) && text(value.name, 2, 80)
      && (value.phone === undefined || allowPhone && e164(value.phone)));
  }
  return value;
}

export function readGuestResponse(value, rideId) {
  expect(record(value) && only(value, ['guest', 'token', 'replayed', 'apiVersion', 'serverNow']) && record(value.guest)
    && (value.apiVersion === undefined || value.apiVersion === 1) && (value.serverNow === undefined || integer(value.serverNow)));
  const guest = value.guest, link = guest.link;
  expect(only(guest, ['rideId', 'canCreate', 'link']) && uuid(guest.rideId)
    && (rideId === undefined || guest.rideId === rideId) && typeof guest.canCreate === 'boolean');
  expect(link === null || record(link) && only(link, ['id', 'version', 'active', 'expiresAt']) && uuid(link.id)
    && integer(link.version) && typeof link.active === 'boolean' && integer(link.expiresAt));
  expect(value.replayed === undefined || typeof value.replayed === 'boolean');
  expect(value.token === undefined || token(value.token) && guest.canCreate && link?.active === true && value.replayed !== true);
  return value;
}

const vehicle = value => record(value) && only(value, ['model', 'plate', 'make', 'modelName', 'year', 'colour', 'category', 'payloadKg'])
  && text(value.model, 1, 100) && text(value.plate, 1, 30) && transportCategory(value.category)?.service === 'ride'
  && ['make', 'modelName', 'colour'].every(key => value[key] === undefined || text(value[key], 1, 100))
  && (value.year === undefined || integer(value.year) && value.year >= 1980 && value.year <= 2100) && value.payloadKg == null;

/** Public bearer projection uses a strict allowlist: it must never carry account or contact details. */
export function readGuestTripResponse(value) {
  expect(record(value) && only(value, ['mode', 'expiresAt', 'guestTrip', 'serverNow']) && value.mode === 'preview' && integer(value.expiresAt)
    && (value.serverNow === undefined || integer(value.serverNow)));
  const trip = value.guestTrip;
  expect(record(trip) && only(trip, ['reference', 'status', 'passengerName', 'bookerName', 'pickup', 'destination', 'driver', 'pickupPin', 'location'])
    && /^TAXI-[A-F0-9]{8}$/.test(trip.reference) && ['booked', 'on_way', 'arrived', 'in_progress'].includes(trip.status)
    && Object.hasOwn(RIDE_STATUS_LABELS, trip.status) && text(trip.passengerName, 2, 80) && text(trip.bookerName, 1, 100)
    && text(trip.pickup, 1, 240) && text(trip.destination, 1, 240)
    && record(trip.driver) && only(trip.driver, ['name', 'vehicle']) && text(trip.driver.name, 1, 100) && vehicle(trip.driver.vehicle)
    && (trip.pickupPin === null || trip.status !== 'in_progress' && typeof trip.pickupPin === 'string' && /^\d{6}$/.test(trip.pickupPin)));
  const location = trip.location;
  expect(location === null || record(location) && only(location, ['lat', 'lng', 'accuracy', 'capturedAt', 'source', 'stale'])
    && Number.isFinite(location.lat) && location.lat >= -90 && location.lat <= 90
    && Number.isFinite(location.lng) && location.lng >= -180 && location.lng <= 180
    && Number.isFinite(location.accuracy) && location.accuracy >= 0 && location.accuracy <= 10_000
    && integer(location.capturedAt) && location.source === 'driver_shared' && typeof location.stale === 'boolean');
  return value;
}
