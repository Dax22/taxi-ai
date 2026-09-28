import test from 'node:test';
import assert from 'node:assert/strict';
import { APP_RELEASE, storeLink } from '../public/app-release.mjs';
test('download buttons remain unavailable until actual store URLs are configured', () => {
  assert.deepEqual(APP_RELEASE, { ios: null, android: null });
  assert.equal(storeLink('ios', 'https://apps.apple.com/ng/app/taxi-ai/id1234567890'), 'https://apps.apple.com/ng/app/taxi-ai/id1234567890');
  assert.equal(storeLink('android', 'https://play.google.com/store/apps/details?id=com.taxiai.app'), 'https://play.google.com/store/apps/details?id=com.taxiai.app');
  for (const value of [null, 'javascript:alert(1)', 'http://apps.apple.com/app/id123', 'https://apps.apple.com.evil.test/app/id123', 'https://user:pass@apps.apple.com/app/id123', 'https://apps.apple.com/app/id123?redirect=evil', 'https://example.test/taxi.apk', 'https://play.google.com/store/apps/details?id=com.taxiai.app&next=evil']) {
    assert.equal(storeLink('ios', value), null); assert.equal(storeLink('android', value), null);
  }
});
