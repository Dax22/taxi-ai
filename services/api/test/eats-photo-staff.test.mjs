import test from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import { randomUUID } from 'node:crypto';
import { harness, bootstrapAdmin, PASSWORD } from './helpers.mjs';
import { createStaffFactor, totpCode } from '../src/infrastructure/staff-factor.mjs';

const consolePath = '/api/admin/console';
const must = (response) => { assert.equal(response.status, 200, JSON.stringify(response.body)); return response.body; };
const login = (client) => client.post(consolePath + '/login', { email: client.user.email, password: PASSWORD });
const image = { mimeType: 'image/jpeg', base64: (await sharp({ create: { width: 240, height: 180, channels: 3, background: '#aa6432' } }).jpeg().toBuffer()).toString('base64') };
async function fixture(t, mfa = false) {
  const factor = createStaffFactor({ key: '49'.repeat(32), required: mfa });
  const h = await harness(t, { staffMfa: { required: mfa, factor } });
  const admin = h.client(), seller = h.client();
  await admin.register('photo-review-owner'); await bootstrapAdmin(h.db, admin.user.email); must(await login(admin));
  await seller.register('photo-review-seller');
  let { store } = must(await seller.post('/api/eats/stores', { details: { name: 'Fictional photo kitchen', cuisine: 'Nigerian',
    description: 'Synthetic restaurant used for photo authorization checks.', address: '10 Fictional Road, Wuse II', areaId: 'wuse-ii',
    prepMinutes: 25, minimumKobo: 100000, deliveryFeeKobo: 150000 } }));
  ({ store } = must(await seller.post(`/api/eats/stores/${store.id}/assets`, { expectedVersion: store.version, purpose: 'cover', image })));
  const photo = store.assets.cover;
  return { h, admin, seller, store, photo, path: `/api/eats/photos/${photo.id}`, data: { expectedVersion: photo.version, decision: 'approved', reason: 'Synthetic cover photo reviewed for accurate and appropriate content.' } };
}

test('Eats photo queue, evidence and review require current browser MFA before returning images or persisting approval', async (t) => {
  const f = await fixture(t, true), reviewKey = randomUUID();
  for (const result of [await f.admin.send('/api/eats/admin/photos'), await f.admin.send(f.path), await f.admin.post(f.path + '/review', f.data, reviewKey)]) {
    assert.equal(result.status, 403); assert.equal(result.body.error.code, 'MFA_SETUP_REQUIRED');
    assert.equal(JSON.stringify(result.body).includes(image.base64), false);
  }
  assert.equal(f.h.db.prepare('SELECT status FROM eats_photos WHERE id=?').get(f.photo.id).status, 'pending');
  assert.equal(f.h.db.prepare('SELECT count(*) AS n FROM eats_photo_reviews').get().n, 0);
  const { setup } = must(await f.admin.post(consolePath + '/staff/mfa/enroll', { password: PASSWORD }));
  must(await f.admin.post(consolePath + '/staff/mfa/confirm', { code: totpCode(setup.secret, f.h.now) }));
  assert.ok(must(await f.admin.send('/api/eats/admin/photos')).photos.some((photo) => photo.id === f.photo.id));
  assert.equal(must(await f.admin.send(f.path)).photo.mimeType, 'image/jpeg');
  const approved = must(await f.admin.post(f.path + '/review', f.data, reviewKey));
  assert.equal(approved.photoReview.status, 'approved');
  const another = f.h.client(); another.user = f.admin.user; must(await login(another));
  for (const result of [await another.send('/api/eats/admin/photos?status=approved'), await another.send(f.path), await another.post(f.path + '/review', { ...f.data, expectedVersion: approved.photoReview.version, decision: 'rejected' })]) {
    assert.equal(result.status, 403); assert.equal(result.body.error.code, 'MFA_REQUIRED');
  }
  f.h.advance(15 * 60_000);
  const replay = await f.admin.post(f.path + '/review', f.data, reviewKey);
  assert.equal(replay.status, 403); assert.equal(replay.body.error.code, 'MFA_REQUIRED', 'Expired MFA cannot replay a privileged command.');
  assert.equal(f.h.db.prepare('SELECT status FROM eats_photos WHERE id=?').get(f.photo.id).status, 'approved');
  assert.equal(f.h.db.prepare('SELECT count(*) AS n FROM eats_photo_reviews').get().n, 1);
});

test('Eats photo moderation rejects customers, restricted staff, native sessions and revoked legacy admins', async (t) => {
  const f = await fixture(t), support = f.h.client(); await support.register('photo-review-support');
  must(await f.admin.post(consolePath + '/staff/assign', { email: support.user.email, role: 'support', expectedVersion: 0, reason: 'Synthetic support role without vendor review permission.' }));
  must(await login(support));
  assert.equal((await f.h.client().send('/api/eats/admin/photos')).status, 401);
  for (const client of [f.seller, support]) {
    assert.equal((await client.send('/api/eats/admin/photos')).status, 403);
    assert.equal((await client.post(f.path + '/review', f.data)).status, 403);
  }
  const nativeLogin = await f.seller.send('/api/mobile/v1/auth/login', { method: 'POST',
    data: { email: f.seller.user.email, password: PASSWORD, deviceName: 'Fictional seller phone' },
    headers: { Origin: null, Cookie: null, 'X-CSRF-Token': null } });
  const token = must(nativeLogin).credentials.accessToken;
  const nativeHeaders = { Origin: null, Cookie: null, 'X-CSRF-Token': null, Authorization: `Bearer ${token}`, 'Idempotency-Key': randomUUID() };
  assert.equal((await f.seller.send('/api/mobile/v1/eats/admin/photos', { headers: nativeHeaders })).status, 403);
  assert.equal((await f.seller.send('/api/mobile/v1' + f.path.slice(4) + '/review', { method: 'POST', data: f.data, headers: nativeHeaders })).status, 403);
  assert.equal((await f.h.client().send('/api/eats/admin/photos', { headers: { Authorization: `Bearer ${token}` } })).status, 401);
  assert.equal((await f.admin.send('/api/mobile/v1/auth/login', { method: 'POST', data: { email: f.admin.user.email, password: PASSWORD, deviceName: 'Fictional admin phone' }, headers: { Origin: null, Cookie: null, 'X-CSRF-Token': null } })).status, 403);
  assert.equal((await f.admin.send(f.path + '/review', { method: 'POST', data: f.data, headers: { 'X-CSRF-Token': 'forged', 'Idempotency-Key': randomUUID() } })).status, 403);
  must(await f.admin.send('/api/eats/admin/photos'));
  // Simulate externally revoked membership while its old browser cookie remains live.
  f.h.db.prepare(`INSERT INTO staff_memberships(user_id,role,status,version,updated_at) VALUES (?,'owner','revoked',2,?)
    ON CONFLICT(user_id) DO UPDATE SET status='revoked',version=version+1`).run(f.admin.user.id, f.h.now);
  for (const result of [await f.admin.send('/api/eats/admin/photos'), await f.admin.send(f.path), await f.admin.post(f.path + '/review', f.data)]) assert.equal(result.status, 403);
  assert.equal(f.h.db.prepare('SELECT status FROM eats_photos WHERE id=?').get(f.photo.id).status, 'pending');
  assert.equal(f.h.db.prepare('SELECT count(*) AS n FROM eats_photo_reviews').get().n, 0);
});
