import test from 'node:test';
import assert from 'node:assert/strict';
import { NIGERIAN_STATES, LEGACY_FOOD_AREAS } from '../src/nigeria-areas.mjs';
import { NIGERIA_BOUNDS, insideNigeria } from '../src/locations.mjs';
import { NIGERIA_MAP_PLACES, NIGERIA_MAP_SOURCES, mapPlaceBounds } from '../src/nigeria-map-places.mjs';

test('offline map navigation includes all 36 states and FCT with valid Nigerian centres', () => {
  assert.deepEqual(
    [...new Set(NIGERIA_MAP_PLACES.map((place) => place.stateId))].sort(),
    NIGERIAN_STATES.map((state) => state.id).sort(),
  );
  assert.equal(new Set(NIGERIA_MAP_PLACES.map((place) => place.id)).size, NIGERIA_MAP_PLACES.length);
  for (const place of NIGERIA_MAP_PLACES) {
    assert.match(place.id, /^map-[a-z]+(?:-[a-z]+)*$/);
    assert.ok(insideNigeria({ lat: place.latitude, lng: place.longitude }), place.name);
    const bounds = mapPlaceBounds(place);
    assert.ok(bounds.west < place.longitude && place.longitude < bounds.east, place.name);
    assert.ok(bounds.south < place.latitude && place.latitude < bounds.north, place.name);
  }
  assert.ok(NIGERIA_MAP_PLACES.some((place) => place.longitude < 4));
  assert.ok(NIGERIA_MAP_PLACES.some((place) => place.longitude > 13));
  assert.ok(NIGERIA_MAP_PLACES.some((place) => place.latitude > 12));
  assert.ok(NIGERIA_MAP_PLACES.some((place) => place.latitude < 5));
});

test('supplemented capital and district anchors retain the retrieved point coordinates', () => {
  const expected = [
    ['map-abuja', 'natural-earth:1159150799', 9.05462, 7.489505],
    ['map-yenagoa', 'geonames:2318123', 4.92675, 6.26764],
    ['map-abakaliki', 'geonames:2353099', 6.32485, 8.11368],
    ['map-ikeja', 'geonames:2338313', 6.59651, 3.34205],
    ['map-asaba', 'geonames:2349276', 6.19824, 6.73187],
    ['map-wuse', 'geonames:2318558', 9.07056, 7.4675],
    ['map-maitama', 'geonames:2331303', 9.09563, 7.4984],
    ['map-wuse-ii', 'openstreetmap:node:31384766:v6', 9.0761981, 7.4759718],
  ];
  for (const [id, sourceId, latitude, longitude] of expected) {
    const place = NIGERIA_MAP_PLACES.find((entry) => entry.id === id);
    assert.ok(place, id);
    assert.deepEqual({ sourceId: place.sourceId, latitude: place.latitude, longitude: place.longitude },
      { sourceId, latitude, longitude });
  }
});

test('navigation anchors cannot silently geocode sample areas or claim administrative boundaries', () => {
  const sampleIds = new Set(LEGACY_FOOD_AREAS.map((area) => area.id));
  for (const place of NIGERIA_MAP_PLACES) {
    assert.equal(sampleIds.has(place.id), false);
    assert.equal('polygon' in place, false);
    assert.equal('serviceArea' in place, false);
  }
  for (const area of LEGACY_FOOD_AREAS) {
    assert.equal('latitude' in area, false);
    assert.equal('longitude' in area, false);
  }
  const wuse = mapPlaceBounds(NIGERIA_MAP_PLACES.find((place) => place.id === 'map-wuse'));
  const wuseII = mapPlaceBounds(NIGERIA_MAP_PLACES.find((place) => place.id === 'map-wuse-ii'));
  assert.ok(wuse.west < wuseII.east && wuseII.west < wuse.east, 'viewports may overlap; these are not partitioned districts');
  const city = mapPlaceBounds(NIGERIA_MAP_PLACES.find((place) => place.id === 'map-abuja'));
  assert.ok(city.east - city.west > 5 * (wuse.east - wuse.west));
  assert.ok(NIGERIA_BOUNDS.east - NIGERIA_BOUNDS.west > 10 * (city.east - city.west), 'country extent is independent of preset views');
});

test('sources identify pinned versions or snapshots and keep required attribution licenses', () => {
  const sources = new Map(NIGERIA_MAP_SOURCES.map((source) => [source.id, source]));
  assert.equal(sources.get('natural-earth').version, '5.1.2');
  assert.match(sources.get('natural-earth').dataUrl, /\/v5\.1\.2\/geojson\//);
  assert.equal(sources.get('geonames').retrievedOn, '2026-09-25');
  assert.equal(sources.get('geonames').license, 'CC BY 4.0');
  assert.equal(sources.get('openstreetmap').license, 'ODbL 1.0');
  assert.match(sources.get('openstreetmap').dataUrl, /\/node\/31384766\/6\.json$/);
  for (const source of NIGERIA_MAP_SOURCES) {
    assert.match(source.url, /^https:\/\//);
    assert.match(source.licenseUrl, /^https:\/\//);
    if (source.sha256) assert.match(source.sha256, /^[a-f0-9]{64}$/);
  }
  for (const place of NIGERIA_MAP_PLACES) assert.ok(sources.has(place.sourceId.split(':')[0]), place.id);
  assert.throws(() => { NIGERIA_MAP_PLACES.push({}); }, TypeError);
  assert.throws(() => { NIGERIA_MAP_PLACES[0].latitude = 0; }, TypeError);
  assert.throws(() => { NIGERIA_MAP_SOURCES[0].version = 'latest'; }, TypeError);
});

test('invalid coordinates and unsupported navigation kinds cannot generate map bounds', () => {
  for (const value of [null, undefined, {}, { latitude: NaN, longitude: 7, kind: 'city' },
    { latitude: 9, longitude: Infinity, kind: 'city' }, { latitude: '9', longitude: 7, kind: 'city' },
    { latitude: 91, longitude: 7, kind: 'city' }, { latitude: 9, longitude: 181, kind: 'city' },
    { latitude: 9, longitude: 7, kind: 'country' }]) {
    assert.throws(() => mapPlaceBounds(value), TypeError);
  }
});
