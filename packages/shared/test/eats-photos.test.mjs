import test from 'node:test';
import assert from 'node:assert/strict';
import { createEatsController } from '../src/eats-controller.mjs';
import { readEatsResponse } from '../src/eats-contracts.mjs';
const id = (n) => `00000000-0000-4000-a000-${String(n).padStart(12, '0')}`;
const admin = { id: id(1), role: 'admin' };
const store = { id: id(2), version: 1, name: 'Kitchen', description: '', address: '', areaId: 'wuse-ii', cuisine: 'Nigerian', status: 'approved', isOpen: true, prepMinutes: 20, minimumKobo: 0, deliveryFeeKobo: 0 };
const asset = { id: id(3), purpose: 'dish', status: 'pending', version: 1, reviewNote: '', storeId: store.id, storeName: store.name, itemId: id(4), itemName: 'Rice', createdAt: 1000 };
const photo = { photo: { id: asset.id, mimeType: 'image/jpeg', base64: 'aGVsbG8=' } };
const deferred = () => { let resolve; const promise = new Promise((r) => { resolve = r; }); return { resolve, promise }; };

test('photo responses enforce review purposes and exclude owner-only reference metadata from discovery', () => {
  const reference = { id: id(7), purpose: 'menu_reference', status: 'private', version: 1, reviewNote: '' };
  assert.equal(readEatsResponse({ store: { ...store, assets: { logo: null, cover: null, menuReference: reference } }, menu: [] }).store.assets.menuReference.id, reference.id);
  assert.throws(() => readEatsResponse({ restaurants: [{ ...store, assets: { menuReference: reference } }] }));
  assert.throws(() => readEatsResponse({ store: { ...store, assets: { logo: reference } }, menu: [] }));
  assert.throws(() => readEatsResponse({ photos: [{ ...asset, purpose: 'menu_reference', status: 'private' }], nextBefore: null }));
  assert.throws(() => readEatsResponse({ photoReview: { ...asset, version: 0 } }));
  assert.throws(() => readEatsResponse({ photoReview: { ...asset, itemId: null } }));
  assert.equal(readEatsResponse({ photos: [asset], nextBefore: null }).photos[0].id, asset.id);
  assert.throws(() => readEatsResponse({ current: [], available: [{ id: id(20), version: 1, restaurant: { ...store, assets: { menuReference: reference } }, deliveryArea: { name: 'Town' }, deliveryFeeKobo: 0 }], online: true, eligible: true, isDemo: true }));
});

test('photo failures retry after a short cooldown, revisions bypass stale cache, and late account reads stay private', async () => {
  let now = 1000, calls = 0, fails = true;
  const api = { async request() { calls++; if (fails) throw new Error('offline'); return photo; } };
  const c = createEatsController({ api, makeKey: () => 'photo-test', now: () => now }); c.context(admin);
  assert.equal(await c.photo(asset.id, 1), null); fails = false;
  assert.equal(await c.photo(asset.id, 1), null); assert.equal(calls, 1);
  now += 5001; assert.match(await c.photo(asset.id, 1), /^data:image\/jpeg/); assert.equal(calls, 2);
  await c.photo(asset.id, 2); assert.equal(calls, 3);
  assert.equal(await c.photo(id(8), 1), null, 'a response for a different image is never displayed');
  const waiting = deferred(); api.request = () => waiting.promise;
  const pending = c.photo(id(9), 1); c.context({ id: id(10), role: 'customer' }); waiting.resolve(photo);
  assert.equal(await pending, null);
});

test('photo review retries the identical command after a lost reply without overwriting selected store review', async () => {
  let current = { ...asset }, attempts = 0; const writes = [];
  const api = { async request(path) {
    if (path === '/eats/admin/stores') return { stores: [store] };
    if (path.startsWith('/eats/admin/photos')) return { photos: current.status === 'pending' ? [current] : [], nextBefore: null };
    if (path.startsWith('/eats/restaurants/')) return { store, menu: [] };
    throw new Error(path);
  }, async command(path, data, key) {
    writes.push({ path, data, key }); current = { ...asset, status: 'approved', version: 2, reviewNote: data.reason };
    if (!attempts++) throw new Error('lost reply');
    return { photoReview: current, replayed: true };
  } };
  const c = createEatsController({ api, makeKey: () => 'review-exact-key' }); c.context(admin);
  await c.navigate('review'); await c.reviewStore(store.id);
  assert.equal(await c.reviewPhoto(asset, 'approved', 'Accurate portion and no personal details.'), false);
  assert.equal(c.snapshot().uncertain, true);
  assert.equal(await c.loadPhotoReviews('rejected'), false);
  assert.equal(await c.retry(), true); assert.deepEqual(writes[0], writes[1]);
  assert.equal(c.snapshot().review.store.id, store.id); assert.equal(c.snapshot().reviewPhotos.length, 0);
  assert.equal(c.snapshot().uncertain, false); assert.equal(c.snapshot().notice, 'Photo approved.');
});

test('late photo queues cannot replace another account or a newer filter', async () => {
  const wait = deferred();
  const api = { async request(path) {
    if (path === '/eats/admin/stores') return { stores: [] };
    if (path.includes('status=rejected')) return wait.promise;
    return { photos: [{ ...asset, status: path.includes('status=approved') ? 'approved' : 'pending' }], nextBefore: null };
  } };
  const c = createEatsController({ api, makeKey: () => 'review-test' }); c.context(admin); await c.navigate('review');
  const pending = c.loadPhotoReviews('rejected'); await c.loadPhotoReviews('approved');
  wait.resolve({ photos: [{ ...asset, status: 'rejected' }], nextBefore: null }); await pending;
  assert.equal(c.snapshot().photoReviewStatus, 'approved'); assert.equal(c.snapshot().reviewPhotos[0].status, 'approved');
  c.context({ id: id(8), role: 'customer' }); assert.deepEqual(c.snapshot().reviewPhotos, []);
});
