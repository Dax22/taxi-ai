import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const configure = require('../app.config.cjs');

test('signed acceptance profile is internal, auto-versioned and separate from store release', () => {
  const eas = JSON.parse(readFileSync(new URL('../eas.json', import.meta.url), 'utf8'));
  const app = JSON.parse(readFileSync(new URL('../app.json', import.meta.url), 'utf8'));
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  assert.equal(eas.cli.version, '>=24.0.0'); assert.equal(eas.cli.appVersionSource, 'local');
  assert.deepEqual(eas.build.acceptance, { extends: 'preview', environment: 'preview', env: { TAXI_AI_ACCEPTANCE_BUILD: 'true' } });
  assert.equal(eas.build.preview.distribution, 'internal'); assert.equal(eas.build.preview.autoIncrement, true);
  assert.equal(eas.build.preview.android.buildType, 'apk');
  assert.equal(eas.build.production.distribution, 'store'); assert.equal(eas.build.production.environment, 'production'); assert.equal(eas.build.production.autoIncrement, true); assert.equal(eas.build.production.env.TAXI_AI_PRODUCTION_BUILD, 'true');
  assert.equal(app.expo.version, pkg.version); assert.equal(app.expo.ios.bundleIdentifier, 'com.taxiai.app'); assert.equal(app.expo.android.package, 'com.taxiai.app');
  assert.equal(app.expo.owner, 'dax-ai-labs'); assert.equal(app.expo.extra.eas.projectId, 'b157df43-402c-4c24-a966-30fce874de42');
  assert.match(app.expo.ios.buildNumber, /^\d+$/); assert.ok(Number(app.expo.ios.buildNumber) >= 1);
  assert.ok(Number.isInteger(app.expo.android.versionCode)); assert.ok(app.expo.android.versionCode >= 1);
});


test('acceptance app config fails closed when production client configuration is incomplete', () => {
  const names = ['TAXI_AI_ACCEPTANCE_BUILD','EXPO_PUBLIC_API_ORIGIN','EXPO_PUBLIC_EXPO_PROJECT_ID','EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID','EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID','GOOGLE_MAPS_ANDROID_API_KEY','GOOGLE_SERVICES_JSON'];
  const saved = names.map(name => process.env[name]);
  try {
    process.env.TAXI_AI_ACCEPTANCE_BUILD='true'; process.env.EXPO_PUBLIC_API_ORIGIN='https://taxiai.app';
    process.env.EXPO_PUBLIC_EXPO_PROJECT_ID='11111111-1111-4111-8111-111111111111';
    process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID='webfixture.apps.googleusercontent.com'; process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID='iosfixture.apps.googleusercontent.com';
    process.env.GOOGLE_MAPS_ANDROID_API_KEY='A'.repeat(30); process.env.GOOGLE_SERVICES_JSON='/tmp/google-services.json';
    assert.doesNotThrow(() => configure({ config: { plugins: [], android: { package: 'com.taxiai.app' }, ios: { bundleIdentifier: 'com.taxiai.app' } } }));
    delete process.env.EXPO_PUBLIC_API_ORIGIN;
    assert.throws(() => configure({ config: { plugins: [] } }), /must target https:\/\/taxiai\.app/);
  } finally { names.forEach((name,i) => { if (saved[i] === undefined) delete process.env[name]; else process.env[name]=saved[i]; }); }
});
