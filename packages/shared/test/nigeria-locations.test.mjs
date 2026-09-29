import test from 'node:test';
import assert from 'node:assert/strict';
import { insideNigeria, NIGERIA_BOUNDS, NIGERIA_CENTER, ABUJA_CENTER, distanceMeters } from '../src/locations.mjs';
import { NIGERIA_POLYGONS } from '../src/nigeria-boundary.mjs';

// Representative urban points in all 36 states and the FCT, not dispatch seeds.
const places = [
  ['Umuahia', 5.532, 7.486], ['Yola', 9.203, 12.495], ['Uyo', 5.038, 7.928],
  ['Awka', 6.210, 7.074], ['Bauchi', 10.31, 9.844], ['Yenagoa', 4.926, 6.264],
  ['Makurdi', 7.732, 8.537], ['Maiduguri', 11.831, 13.15], ['Calabar', 4.975, 8.341],
  ['Asaba', 6.205, 6.696], ['Abakaliki', 6.3249, 8.1137], ['Benin City', 6.335, 5.627],
  ['Ado Ekiti', 7.623, 5.220], ['Enugu', 6.458, 7.546], ['Gombe', 10.285, 11.168],
  ['Owerri', 5.483, 7.034], ['Dutse', 11.756, 9.338], ['Kaduna', 10.51, 7.416],
  ['Kano', 12.002, 8.592], ['Katsina', 12.988, 7.599], ['Birnin Kebbi', 12.453, 4.197],
  ['Lokoja', 7.802, 6.733], ['Ilorin', 8.479, 4.542], ['Ikeja', 6.601, 3.351],
  ['Lafia', 8.496, 8.516], ['Minna', 9.613, 6.557], ['Abeokuta', 7.148, 3.361],
  ['Akure', 7.253, 5.193], ['Osogbo', 7.783, 4.541], ['Ibadan', 7.377, 3.947],
  ['Jos', 9.896, 8.858], ['Port Harcourt', 4.8156, 7.0498], ['Sokoto', 13.005, 5.247],
  ['Jalingo', 8.893, 11.365], ['Damaturu', 11.747, 11.960], ['Gusau', 12.162, 6.661],
  ['Abuja', 9.0765, 7.3986],
];

test('national country guard accepts representative locations across every state and FCT', () => {
  assert.equal(places.length, 37);
  for (const [name, lat, lng] of places) assert.equal(insideNigeria({ lat, lng }), true, name);
  assert.equal(insideNigeria({ lat: 6.5244, lng: 3.3792 }), true, 'Lagos');
  assert.equal(insideNigeria(ABUJA_CENTER), true, 'legacy demo locations remain valid');
});

test('country polygon rejects foreign and offshore points even inside display bounds', () => {
  const foreign = [
    ['Garoua, Cameroon', 9.3, 13.4], ['Maradi, Niger', 13.5, 7.1],
    ['Bohicon, Benin', 7.18, 2.07], ['Cotonou, Benin', 6.37, 2.39],
    ['Atlantic Ocean', 5, 3.8], ['Cameroon coast', 4.6, 9],
  ];
  for (const [name, lat, lng] of foreign) assert.equal(insideNigeria({ lat, lng }), false, name);
  assert.ok(13.4 > NIGERIA_BOUNDS.west && 13.4 < NIGERIA_BOUNDS.east);
  assert.ok(9.3 > NIGERIA_BOUNDS.south && 9.3 < NIGERIA_BOUNDS.north);
  assert.equal(insideNigeria({ lat: NIGERIA_BOUNDS.north, lng: NIGERIA_BOUNDS.west }), false);
});

test('national guard rejects malformed coordinates without coercion or throwing', () => {
  for (const point of [null, undefined, false, 7, 'Nigeria', [], {}, {lat:'9.07',lng:7.4},
    {lat:9.07,lng:'7.4'}, {lat:NaN,lng:7.4}, {lat:9,lng:Infinity}, {lat:90,lng:7},
    {lat:-90,lng:-180}, {lat:0,lng:0}]) assert.equal(insideNigeria(point), false);
});

test('preserved multipolygons include their boundary vertices and cannot be mutated', () => {
  assert.equal(NIGERIA_POLYGONS.length, 3);
  for (const polygon of NIGERIA_POLYGONS) {
    const [lng, lat] = polygon[0][0];
    assert.equal(insideNigeria({ lat, lng }), true);
  }
  assert.throws(() => { NIGERIA_POLYGONS[0][0][0][0] = 0; }, TypeError);
  assert.throws(() => { NIGERIA_BOUNDS.east = 180; }, TypeError);
  assert.equal(insideNigeria(NIGERIA_CENTER), true);
});

test('country-wide coordinate support does not change local distance calculations', () => {
  const lagos = {lat:6.5244,lng:3.3792}, kano = {lat:12.0022,lng:8.592};
  const distance = distanceMeters(lagos, kano);
  assert.ok(distance > 800_000 && distance < 900_000);
  assert.equal(distanceMeters(lagos, lagos), 0);
});
