import test from 'node:test';
import assert from 'node:assert/strict';
import { createFoodPhoto, photoStatus } from '../public/eats/photo-view.mjs';
import { photoDimensions, validatePhotoFile, prepareFoodPhoto } from '../public/eats/photo-upload.mjs';

const flush = () => new Promise((resolve) => setImmediate(resolve));
function documentFixture(t) {
  const previous = globalThis.document;
  class Element {
    constructor(tag) { this.tag = tag; this.handlers = {}; this.children = []; }
    append(...children) { this.children.push(...children); }
    setAttribute(name, value) { this[name] = value; }
    removeAttribute(name) { delete this[name]; }
    addEventListener(name, handler) { this.handlers[name] = handler; }
  }
  globalThis.document = { createElement: (tag) => new Element(tag) };
  t.after(() => { globalThis.document = previous; });
}

test('actual dish photos show an explicit placeholder until decoded and restore it on decode failure', async (t) => {
  documentFixture(t); let reads = 0;
  const empty = createFoodPhoto({ label: 'Jollof rice', load: async () => { reads++; } });
  assert.equal(empty.children[0].textContent, 'Photo coming soon'); assert.equal(reads, 0);
  const photo = createFoodPhoto({ id: 'dish-1', label: 'Jollof rice', load: async () => 'data:image/jpeg;base64,Zm9vZA==' });
  const [fallback, image] = photo.children; await flush();
  assert.equal(image.hidden, true); assert.notEqual(fallback.hidden, true);
  image.handlers.load(); assert.equal(image.hidden, false); assert.equal(fallback.hidden, true);
  image.handlers.error(); assert.equal(image.hidden, true); assert.equal(fallback.hidden, false); assert.equal(image.src, undefined);
});

test('failed access and late photo reads cannot reveal an image after its account changes', async (t) => {
  documentFixture(t); let resolve, owner = 'first';
  const stale = createFoodPhoto({ id: 'private', label: 'Private menu', load: () => new Promise((done) => { resolve = done; }), current: () => owner === 'first' });
  await flush(); owner = 'second'; resolve('data:image/jpeg;base64,cHJpdmF0ZQ=='); await flush();
  assert.equal(stale.children[1].src, undefined); assert.notEqual(stale.children[0].hidden, true);
  const denied = createFoodPhoto({ id: 'denied', label: 'Food', load: async () => { throw new Error('403'); } });
  await flush(); assert.equal(denied.children[1].src, undefined); assert.equal(denied.children[0].hidden, false);
});

test('photo preparation preserves the full frame, limits pixels and rejects unsupported or oversized files', () => {
  assert.deepEqual(photoDimensions(4000, 3000), { width: 1600, height: 1200 });
  assert.deepEqual(photoDimensions(1200, 1600), { width: 1200, height: 1600 });
  assert.deepEqual(photoDimensions(3000, 4000), { width: 1200, height: 1600 });
  assert.throws(() => photoDimensions(10000, 10000), /25 megapixels/);
  assert.throws(() => validatePhotoFile({ type: 'image/svg+xml', size: 100 }), /JPEG, PNG or WebP/);
  assert.throws(() => validatePhotoFile({ type: 'image/jpeg', size: 8 * 1024 * 1024 + 1 }), /8 MiB/);
  validatePhotoFile({ type: 'image/webp', size: 100 });
});

test('browser uploads use a newly encoded bounded JPEG and release the decoded image', async (t) => {
  documentFixture(t); const previous = globalThis.createImageBitmap;
  let closed = 0, draw, quality = [];
  const bitmap = { width: 4000, height: 3000, close() { closed++; } };
  globalThis.createImageBitmap = async () => bitmap;
  globalThis.document.createElement = () => ({ getContext: () => ({ fillRect() {}, drawImage(...args) { draw = args; } }), toBlob(done, type, value) { quality.push(value); done(new Blob(['fresh-jpeg'], { type })); } });
  t.after(() => { globalThis.createImageBitmap = previous; });
  const result = await prepareFoodPhoto({ type: 'image/png', size: 100 });
  assert.deepEqual(draw, [bitmap, 0, 0, 1600, 1200]); assert.equal(closed, 1);
  assert.deepEqual(result.photo, { mimeType: 'image/jpeg', base64: btoa('fresh-jpeg') });
  assert.equal(result.preview, `data:image/jpeg;base64,${result.photo.base64}`); assert.deepEqual(quality, [0.86]);
  bitmap.width = bitmap.height = 10000;
  await assert.rejects(prepareFoodPhoto({ type: 'image/png', size: 100 }), /25 megapixels/); assert.equal(closed, 2);
});

test('photo status distinguishes pending, rejected, approved and private references', () => {
  assert.match(photoStatus(null), /optional/);
  assert.match(photoStatus({ status: 'pending' }), /cannot see/);
  assert.match(photoStatus({ status: 'rejected', reviewNote: 'Remove the private address.' }), /Remove the private address/);
  assert.match(photoStatus({ status: 'approved' }), /visible to customers/);
  assert.match(photoStatus({ status: 'private' }), /never shown to customers/);
  assert.match(photoStatus({ status: 'legacy-approved' }), /not been reviewed/);
});

test('a hanging browser decoder times out and closes a bitmap that finishes after the timeout', async (t) => {
  const previous = globalThis.createImageBitmap; let finish, closed = 0;
  globalThis.createImageBitmap = () => new Promise((resolve) => { finish = resolve; });
  t.after(() => { globalThis.createImageBitmap = previous; });
  await assert.rejects(prepareFoodPhoto({ type: 'image/jpeg', size: 100 }, { timeoutMs: 5 }), /took too long/);
  finish({ width: 2000, height: 1500, close() { closed++; } }); await flush(); assert.equal(closed, 1);
});

test('failed or hanging JPEG encoding releases the image and rejects oversized encoded output', async (t) => {
  documentFixture(t); const previous = globalThis.createImageBitmap; let closed = 0, behavior = 'large';
  globalThis.createImageBitmap = async () => ({ width: 2000, height: 1500, close() { closed++; } });
  globalThis.document.createElement = () => ({ getContext: () => ({ fillRect() {}, drawImage() {} }), toBlob(done, type) { if (behavior === 'large') done(new Blob([new Uint8Array(1024 * 1024 + 1)], { type })); } });
  t.after(() => { globalThis.createImageBitmap = previous; });
  await assert.rejects(prepareFoodPhoto({ type: 'image/jpeg', size: 100 }), /too detailed/); assert.equal(closed, 1);
  behavior = 'hang'; await assert.rejects(prepareFoodPhoto({ type: 'image/jpeg', size: 100 }, { timeoutMs: 5 }), /took too long/); assert.equal(closed, 2);
});
