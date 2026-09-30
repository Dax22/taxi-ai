import test from 'node:test';
import assert from 'node:assert/strict';
import { canDeleteGeneratedPhoto } from '../src/eats/photo-cache.ts';

test('food photo cleanup preserves the selected original even if it already lives in app cache', () => {
  const cache = 'file:///application/cache/';
  assert.equal(canDeleteGeneratedPhoto(cache + 'original.jpg', cache + 'original.jpg', cache), false);
  assert.equal(canDeleteGeneratedPhoto(cache + 'original%20photo.jpg', cache + 'original photo.jpg', cache), false);
  assert.equal(canDeleteGeneratedPhoto(cache + 'processed.jpg', cache + 'original.jpg', cache), true);
  assert.equal(canDeleteGeneratedPhoto(cache + 'processed.jpg', 'content://photos/123', cache), true);
});

test('food photo cleanup only deletes generated files within the complete cache directory boundary', () => {
  const cache = 'file:///application/cache', source = 'file:///photos/original.jpg';
  assert.equal(canDeleteGeneratedPhoto(cache + '/processed.jpg', source, cache), true);
  assert.equal(canDeleteGeneratedPhoto(cache + '-backup/processed.jpg', source, cache), false);
  assert.equal(canDeleteGeneratedPhoto(cache + '/../photos/processed.jpg', source, cache), false);
  assert.equal(canDeleteGeneratedPhoto(cache + '/%2e%2e%2fphotos/processed.jpg', source, cache), false);
  assert.equal(canDeleteGeneratedPhoto('file:///photos/processed.jpg', source, cache), false);
  assert.equal(canDeleteGeneratedPhoto('https://example.test/image.jpg', source, cache), false);
  assert.equal(canDeleteGeneratedPhoto('invalid-uri', source, cache), false);
});
