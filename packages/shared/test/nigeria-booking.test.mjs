import test from 'node:test';
import assert from 'node:assert/strict';
import { parsePlaces, parsePreview } from '../src/mobile-booking.mjs';

const envelope = { apiVersion: 1, serverNow: 1_800_000_000_000 };
const lagos = { name: 'Ikeja, Lagos', lat: 6.6018, lng: 3.3515 };
const kano = { name: 'Kano', lat: 12.0022, lng: 8.5920 };
const portHarcourt = { name: 'Port Harcourt', lat: 4.8156, lng: 7.0498 };
const preview = () => ({ ...envelope, preview: { kind: 'route', vehicleCategory: 'standard',
  pickup: lagos.name, destination: kano.name, suggestedFareKobo: 30_000_000,
  expiresAt: envelope.serverNow + 900_000,
  request: { quoteId: '11111111-1111-4111-8111-111111111111', vehicleCategory: 'standard' },
  route: { distanceMeters: 1_200_000, durationSeconds: 60_000, distanceKind: 'road',
    coordinates: [[lagos.lng, lagos.lat], [kano.lng, kano.lat]] } } });

test('native wire contracts accept Nigerian cities outside the former Abuja rectangle', () => {
  const response = { ...envelope, attribution: 'Test provider', places: [lagos, kano, portHarcourt] };
  assert.deepEqual(parsePlaces(response).places, response.places);
  assert.equal(parsePreview(preview()).preview.route.distanceMeters, 1_200_000);
});

test('native wire contracts reject foreign coordinates and routes beyond national preview limits', () => {
  assert.throws(() => parsePlaces({ ...envelope, attribution: 'Test provider',
    places: [{ name: 'Porto-Novo, Benin', lat: 6.4969, lng: 2.6289 }] }));
  for (const change of [{ distanceMeters: 2_500_001 }, { durationSeconds: 172_801 },
    { coordinates: [[lagos.lng, lagos.lat], [2.6289, 6.4969]] }]) {
    const value = preview(); Object.assign(value.preview.route, change);
    assert.throws(() => parsePreview(value));
  }
});
