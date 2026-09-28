import test from 'node:test';
import assert from 'node:assert/strict';
import { deliveryDetails } from '../src/transport-categories.mjs';
import { readParcelInvitationResponse, readParcelResponse, readReceivedParcelsResponse } from '../src/parcels.mjs';

const rideId = '00000000-0000-4000-8000-000000000001';
const linkId = '00000000-0000-4000-8000-000000000002';
const parcel = () => ({ rideId, reference: 'PARCEL-00000000', status: 'requested', description: 'Sealed package', weightKg: 2,
  recipientName: 'Ada Okafor', destination: 'Maitama', driver: null, location: null, dropoffPin: null, verifiedAt: null, updatedAt: 1000 });
const envelope = parcel => ({ apiVersion: 1, serverNow: 1000, parcel });

test('parcel readers accept full booking text boundaries and car, van, truck and motorcycle projections', () => {
  const details = deliveryDetails('truck', { description: 'A'.repeat(240), weightKg: 3000, recipientName: 'B'.repeat(100) });
  assert.doesNotThrow(() => readParcelResponse(envelope({ ...parcel(), description: details.description,
    weightKg: details.weightKg, recipientName: details.recipientName })));
});

test('received parcel projection accepts every supported courier vehicle without account identities', () => {
  for (const [category, payloadKg] of [['standard', null], ['van', 500], ['truck', 3000], ['motorcycle', 20]]) {
    const item = { ...parcel(), driver: { name: 'Driver One', vehicle: { model: 'Courier vehicle', plate: 'ABC123XY', category, payloadKg } } };
    assert.equal(readParcelResponse(envelope(item)).parcel.driver.vehicle.category, category);
  }
  for (const key of ['pickup', 'pickupPin', 'customerId', 'driverId', 'phone', 'fareKobo', 'chat']) {
    assert.throws(() => readParcelResponse(envelope({ ...parcel(), [key]: 'private' })));
  }
});

test('recipient points and delivery codes are rejected outside collection and for stale or out-of-country positions', () => {
  const location = { lat: 9.0765, lng: 7.3986, accuracy: 10, capturedAt: 1000, source: 'driver_shared', stale: false };
  const moving = { ...parcel(), status: 'in_progress', location, dropoffPin: '123456' };
  assert.doesNotThrow(() => readParcelResponse(envelope(moving)));
  for (const status of ['booked', 'arrived', 'completed', 'cancelled', 'expired']) assert.throws(() => readParcelResponse(envelope({ ...moving, status })));
  assert.throws(() => readParcelResponse(envelope({ ...moving, location: { ...location, stale: true } })));
  assert.throws(() => readParcelResponse(envelope({ ...moving, location: { ...location, lat: 41.8781, lng: -87.6298 } })));
  assert.doesNotThrow(() => readParcelResponse(envelope({ ...parcel(), status: 'completed', verifiedAt: 1000 })));
});

test('parcel invitation readers disallow secret redisclosure on replays and claimed invitations', () => {
  const value = { invitation: { rideId, canCreate: true, link: { id: linkId, version: 0, active: true, expiresAt: 7000, claimed: false } }, token: 'a'.repeat(64), replayed: false };
  assert.equal(readParcelInvitationResponse(value, rideId), value);
  assert.throws(() => readParcelInvitationResponse(value, linkId));
  assert.throws(() => readParcelInvitationResponse({ ...value, replayed: true }));
  assert.throws(() => readParcelInvitationResponse({ ...value, invitation: { ...value.invitation, link: { ...value.invitation.link, claimed: true } } }));
});

test('parcel lists reject duplicate IDs, malformed snapshots and excess entries', () => {
  assert.equal(readReceivedParcelsResponse({ parcels: [parcel()] }).parcels.length, 1);
  assert.throws(() => readReceivedParcelsResponse({ parcels: [parcel(), parcel()] }));
  assert.throws(() => readReceivedParcelsResponse({ parcels: [null] }));
  assert.throws(() => readReceivedParcelsResponse({ parcels: Array.from({ length: 51 }, parcel) }));
});
