import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { coordinate, mapRegion, nativeMapPolicy } from '../src/maps/model.ts';
const require = createRequire(import.meta.url);
const configure = require('../app.config.cjs');

test('platform maps keep iOS on Apple and refuse unconfigured native Android maps', () => {
  assert.deepEqual(nativeMapPolicy('ios', true, false), { label: 'Apple Maps', provider: undefined, available: true });
  assert.deepEqual(nativeMapPolicy('android', true, false), { label: 'Google Maps', provider: 'google', available: true });
  assert.equal(nativeMapPolicy('android', false, false).available, false);
  assert.equal(nativeMapPolicy('android', false, true).available, true);
  assert.equal(nativeMapPolicy('web', true, true).available, false);
});
test('Nigeria route fitting preserves coordinate order, includes every bend, and handles stationary GPS', () => {
  const points = [{ lat: 6.45, lng: 3.39 }, { lat: 6.52, lng: 3.45 }, { lat: 6.5, lng: 3.41 }];
  const region = mapRegion(points)!;
  for (const p of points) {
    assert.ok(Math.abs(p.lat - region.latitude) < region.latitudeDelta / 2);
    assert.ok(Math.abs(p.lng - region.longitude) < region.longitudeDelta / 2);
  }
  assert.deepEqual(coordinate(points[0]), { latitude: 6.45, longitude: 3.39 });
  const single = mapRegion([points[0]])!;
  assert.ok(single.latitudeDelta > 0 && single.longitudeDelta > 0);
  assert.equal(mapRegion([]), null);
  assert.throws(() => mapRegion([{ lat: NaN, lng: 7.4 }]));
  assert.throws(() => coordinate({ lat: 90, lng: 7.4 }));
});
test('native map configuration embeds only the Android SDK key while preserving other integrations', () => {
  const names = ['GOOGLE_MAPS_ANDROID_API_KEY', 'GOOGLE_SERVICES_JSON', 'EXPO_PUBLIC_EXPO_PROJECT_ID', 'EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID', 'EXPO_PUBLIC_API_ORIGIN', 'EAS_BUILD_ID', 'EAS_BUILD_PROJECT_ID', 'EAS_BUILD_PROFILE', 'EAS_BUILD_PLATFORM', 'EAS_BUILD_GIT_COMMIT_HASH'];
  const saved = names.map(name => process.env[name]);
  try {
    process.env.GOOGLE_MAPS_ANDROID_API_KEY = 'fixture_android_maps_sdk_key_only';
    process.env.GOOGLE_SERVICES_JSON = '/tmp/fixture-google-services.json';
    process.env.EXPO_PUBLIC_EXPO_PROJECT_ID = '00000000-0000-4000-8000-000000000001';
    process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID = 'fixture.apps.googleusercontent.com';
    process.env.EXPO_PUBLIC_API_ORIGIN = 'https://taxiai.app';
    process.env.EAS_BUILD_ID = '11111111-1111-4111-8111-111111111111';
    process.env.EAS_BUILD_PROJECT_ID = '00000000-0000-4000-8000-000000000001';
    process.env.EAS_BUILD_PROFILE = 'acceptance';
    process.env.EAS_BUILD_PLATFORM = 'android';
    process.env.EAS_BUILD_GIT_COMMIT_HASH = 'a'.repeat(40);
    const configured = configure({ config: { name: 'Fixture', slug: 'fixture', plugins: ['expo-router'], extra: { preserved: true }, android: { package: 'com.taxiai.app' } } });
    const maps = configured.plugins.find((entry: unknown) => Array.isArray(entry) && entry[0] === 'react-native-maps');
    assert.deepEqual(maps, ['react-native-maps', { androidGoogleMapsApiKey: 'fixture_android_maps_sdk_key_only' }]);
    assert.deepEqual(configured.extra.nativeMaps, { androidConfigured: true });
    assert.equal(configured.extra.preserved, true);
    assert.equal(configured.extra.eas.projectId, process.env.EXPO_PUBLIC_EXPO_PROJECT_ID);
    assert.deepEqual(configured.extra.release, { buildId: process.env.EAS_BUILD_ID, projectId: process.env.EAS_BUILD_PROJECT_ID,
      profile: 'acceptance', platform: 'android', gitCommit: process.env.EAS_BUILD_GIT_COMMIT_HASH, apiOrigin: 'https://taxiai.app' });
    assert.equal(configured.android.package, 'com.taxiai.app');
    assert.equal(configured.android.googleServicesFile, process.env.GOOGLE_SERVICES_JSON);
    assert.ok(configured.plugins.some((entry: unknown) => Array.isArray(entry) && entry[0] === 'react-native-nitro-google-signin'));
    assert.ok(!JSON.stringify(configured.extra).includes('fixture_android_maps_sdk_key_only'));
    delete process.env.GOOGLE_MAPS_ANDROID_API_KEY;
    const withoutKey = configure({ config: {} });
    assert.equal(withoutKey.extra.nativeMaps.androidConfigured, false);
    assert.deepEqual(withoutKey.plugins.find((entry: unknown) => Array.isArray(entry) && entry[0] === 'react-native-maps'), ['react-native-maps', {}]);
    process.env.GOOGLE_MAPS_ANDROID_API_KEY = 'bad key\nvalue';
    assert.throws(() => configure({ config: {} }), /Android Maps SDK key/);
  } finally {
    names.forEach((name, i) => { if (saved[i] === undefined) delete process.env[name]; else process.env[name] = saved[i]; });
  }
});
