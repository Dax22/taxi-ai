import test from 'node:test';
import assert from 'node:assert/strict';
import { passengerDetails, passengerView, readPassenger, readGuestResponse, readGuestTripResponse } from '../src/guest-rides.mjs';
import { parseBookingRide } from '../src/mobile-booking.mjs';
import { parseJourney } from '../src/mobile-journeys.mjs';
import { parseActivity } from '../src/mobile-contracts.mjs';

const rideId = '00000000-0000-4000-8000-000000000001';
const linkId = '00000000-0000-4000-8000-000000000002';
const passenger = { kind: 'guest', name: 'Ada Okafor', phone: '+2348031234567', consent: true };
const vehicle = { model: 'Toyota Corolla', plate: 'ABC123XY', category: 'standard' };
const envelope = { apiVersion: 1, serverNow: 1000 };
const booking = { id: rideId, version: 0, status: 'booked', vehicleCategory: 'standard', pickup: 'Wuse II', destination: 'Maitama',
  suggestedFareKobo: 100000, fareKobo: 100000, expiresAt: null, canCancel: true, driver: { name: 'Driver One', vehicle }, passenger: passengerView(passenger, { isBooker: true }) };
const publicTrip = () => ({ mode: 'preview', serverNow: 1000, expiresAt: 2000, guestTrip: { reference: 'TAXI-00000000', status: 'booked',
  passengerName: 'Ada Okafor', bookerName: 'Dapo', pickup: 'Wuse II', destination: 'Maitama', driver: { name: 'Driver One', vehicle: { ...vehicle } }, pickupPin: '123456', location: null } });

test('passenger input keeps historical self rides and normalises Nigerian contacts without guessing other countries', () => {
  assert.deepEqual(passengerDetails(undefined), { kind: 'self' });
  assert.deepEqual(passengerDetails({ kind: 'self' }), { kind: 'self' });
  assert.deepEqual(passengerDetails({ ...passenger, name: '  Ada Okafor ', phone: '0803 123 4567' }, 'suv'), passenger);
  assert.equal(passengerDetails({ ...passenger, phone: '+1 (312) 555-0199' }).phone, '+13125550199');
  for (const phone of ['3125550199', '2348031234567', '+23480\n31234567', '+2348031234567x123', '+000001234567', '123', null]) {
    assert.throws(() => passengerDetails({ ...passenger, phone }), /phone number/);
  }
});

test('booking input requires an adult passenger consent and rejects delivery guests and forged identities', () => {
  for (const category of ['van', 'truck', 'motorcycle']) assert.throws(() => passengerDetails(passenger, category), /Standard and SUV/);
  for (const name of ['', 'A', 'a'.repeat(81), 'Ada\nOkafor', 'Ada\u0000Okafor']) assert.throws(() => passengerDetails({ ...passenger, name }));
  for (const consent of [false, undefined, 'true', 1]) assert.throws(() => passengerDetails({ ...passenger, consent }), /adult/);
  assert.throws(() => passengerDetails({ kind: 'self', name: 'Someone else' }));
  assert.throws(() => passengerDetails({ ...passenger, accountId: rideId }));
  assert.throws(() => passengerDetails(null));
});

test('passenger projections expose phone only to the booker and never return consent or a guest account identity', () => {
  assert.deepEqual(passengerView(undefined, { bookerName: 'Dapo' }), { kind: 'self', name: 'Dapo' });
  assert.deepEqual(passengerView(passenger, { isBooker: false, bookerName: 'Dapo' }), { kind: 'guest', name: 'Ada Okafor' });
  assert.deepEqual(passengerView(passenger, { isBooker: true }), { kind: 'guest', name: 'Ada Okafor', phone: '+2348031234567' });
  assert.equal(readPassenger(undefined), undefined);
  assert.throws(() => readPassenger(null));
  assert.throws(() => readPassenger(passenger));
  assert.throws(() => readPassenger({ kind: 'guest', name: 'Ada Okafor', phone: '+2348031234567' }, 'standard', { allowPhone: false }));
  assert.throws(() => readPassenger({ kind: 'guest', name: 'Ada Okafor' }, 'van'));
});

test('mobile booking and activity validate passenger contracts and assigned drivers cannot receive passenger phone', () => {
  assert.equal(parseBookingRide({ ...envelope, ride: booking }).ride.passenger.name, 'Ada Okafor');
  const journey = { ...booking, mode: 'work', customerName: 'Dapo', chatReady: true, pinBlockedUntil: null, pickupPin: null,
    allowedActions: ['depart', 'cancel'], offer: null };
  assert.throws(() => parseJourney({ ...envelope, ride: journey }));
  assert.equal(parseJourney({ ...envelope, ride: { ...journey, passenger: passengerView(passenger) } }).ride.customerName, 'Dapo');
  const row = { ...booking, createdAt: 1000, isDemo: false, driver: null };
  const activity = { ...envelope, current: [row], history: [], activeElsewhere: [], nextBefore: null };
  assert.equal(parseActivity(activity).current[0].passenger.kind, 'guest');
  assert.throws(() => parseActivity(activity, 'work'));
  assert.doesNotThrow(() => parseActivity({ ...activity, current: [{ ...row, passenger: passengerView(passenger) }] }, 'work'));
  assert.throws(() => parseActivity({ ...activity, current: [{ ...row, passenger }] }));
  assert.doesNotThrow(() => parseBookingRide({ ...envelope, ride: { ...booking, passenger: undefined } }));
});

test('owner link responses reject cross-ride and secret-bearing replays', () => {
  const value = { guest: { rideId, canCreate: true, link: { id: linkId, version: 1, active: true, expiresAt: 2000 } }, token: 'a'.repeat(64), replayed: false };
  assert.equal(readGuestResponse(value, rideId), value);
  assert.throws(() => readGuestResponse(value, linkId));
  assert.throws(() => readGuestResponse({ ...value, replayed: true }));
  assert.throws(() => readGuestResponse({ ...value, guest: { ...value.guest, phone: passenger.phone } }));
  assert.throws(() => readGuestResponse({ ...value, token: 'abc' }));
  assert.throws(() => readGuestResponse({ ...value, guest: { ...value.guest, link: { ...value.guest.link, active: false } } }));
});

test('public guest response is a strict active-trip projection with no IDs, phones or PIN after start', () => {
  assert.doesNotThrow(() => readGuestTripResponse(publicTrip()));
  for (const extra of [{ phone: passenger.phone }, { rideId }, { fareKobo: 100000 }, { consent: true }]) {
    const value = publicTrip(); Object.assign(value.guestTrip, extra); assert.throws(() => readGuestTripResponse(value));
  }
  const driverId = publicTrip(); driverId.guestTrip.driver.id = rideId; assert.throws(() => readGuestTripResponse(driverId));
  const terminal = publicTrip(); terminal.guestTrip.status = 'completed'; assert.throws(() => readGuestTripResponse(terminal));
  const started = publicTrip(); started.guestTrip.status = 'in_progress'; assert.throws(() => readGuestTripResponse(started));
  started.guestTrip.pickupPin = null; assert.doesNotThrow(() => readGuestTripResponse(started));
  const location = publicTrip(); location.guestTrip.location = { lat: 9.06, lng: 7.4, accuracy: 15, capturedAt: 900, source: 'driver_shared', stale: false };
  assert.doesNotThrow(() => readGuestTripResponse(location));
  location.guestTrip.location.driverId = rideId; assert.throws(() => readGuestTripResponse(location));
});
