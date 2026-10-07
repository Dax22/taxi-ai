import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { harness, bootstrapAdmin, PASSWORD } from './helpers.mjs';
import { DETAILS, IMAGE, KINDS, CHECKS } from './driver-fixtures.mjs';
import { parseOnboarding } from '../../../packages/shared/src/mobile-contracts.mjs';

const MATCH = { provider: 'aws-rekognition', threshold: 99, status: 'matched', reason: 'matched', similarity: 99.8 };
function provider(compare = async () => MATCH) { return { enabled: true, provider: MATCH.provider, threshold: 99, compare }; }
const current = async driver => (await driver.send('/api/driver/application')).body.application;
async function change(driver, action, data = {}, key) {
  const application = await current(driver);
  const result = await driver.post('/api/driver/application/' + action, { expectedVersion: application.version, ...data }, key);
  assert.equal(result.status, 200, JSON.stringify(result.body)); return result.body.application;
}
async function setup(t, faceProvider) {
  const h = await harness(t, { driverFaceProvider: faceProvider }), driver = h.client();
  await driver.register('face-driver', 'driver');
  await change(driver, 'save', { details: DETAILS });
  for (const kind of KINDS) await change(driver, 'upload', { kind, ...IMAGE, expiresOn: kind.endsWith('photo') ? null : '2099-12-31' });
  return { h, driver };
}
function deferred() { let resolve; return { promise: new Promise(r => { resolve = r; }), resolve: value => resolve(value) }; }

test('automatic match needs explicit consent and current images, never grants approval, persists consent and replays without another provider call', async t => {
  let calls = 0;
  const { h, driver } = await setup(t, provider(async images => {
    calls++; assert.equal(Buffer.from(images.licenceContent).toString('base64'), IMAGE.base64);
    assert.equal(Buffer.from(images.selfieContent).toString('base64'), IMAGE.base64); return MATCH;
  }));
  let app = await current(driver);
  assert.equal(app.faceCheck.status, 'not_started'); assert.equal(app.faceCheck.available, true);
  assert.equal((await driver.post('/api/driver/application/submit', { expectedVersion: app.version })).body.error.code, 'FACE_CHECK_REQUIRED');
  for (const consent of [false, 'true', null]) assert.equal((await driver.post('/api/driver/application/face-check', { expectedVersion: app.version, consent })).body.error.code, 'INVALID_CONSENT');
  assert.equal(calls, 0);
  const key = randomUUID(), payload = { expectedVersion: app.version, consent: true };
  let result = await driver.post('/api/driver/application/face-check', payload, key);
  assert.equal(result.status, 200, JSON.stringify(result.body)); app = result.body.application;
  assert.equal(app.version, payload.expectedVersion + 2); assert.equal(app.faceCheck.status, 'matched');
  assert.equal(app.status, 'draft'); assert.equal(app.eligibility.eligible, false);
  const attempt = h.db.prepare('SELECT * FROM driver_face_checks').get();
  assert.equal(attempt.consent_version, 'driver-face-match-v2'); assert.equal(attempt.consented_at, h.now);
  assert.equal(JSON.parse(attempt.documents_json).length, 2); assert.ok(!JSON.stringify(attempt).includes(IMAGE.base64));
  app = await change(driver, 'submit'); assert.equal(app.faceCheck.status, 'matched');
  result = await driver.post('/api/driver/application/face-check', payload, key);
  assert.equal(result.body.replayed, true); assert.equal(result.body.application.faceCheck.status, 'matched'); assert.equal(calls, 1);
  assert.equal((await driver.post('/api/driver/application/face-check', { ...payload, expectedVersion: app.version }, key)).body.error.code, 'KEY_REUSED');
  const admin = h.client(); await admin.register('face-reviewer'); await bootstrapAdmin(h.db, admin.user.email);
  await admin.post('/api/auth/login', { email: admin.user.email, password: PASSWORD });
  for (const doc of app.documents) await admin.send('/api/driver-documents/' + doc.id);
  const reviewed = await admin.post(`/api/admin/drivers/${driver.user.id}/review`, { expectedVersion: app.version, decision: 'approved',
    reason: 'Fictional documents reviewed with face comparison evidence.', reference: 'FACE-TEST-ONLY', checks: CHECKS });
  assert.equal(reviewed.status, 200); assert.equal(reviewed.body.application.verification.faceCheck.status, 'matched');
  assert.equal(reviewed.body.application.verification.method, 'manual');
});

test('uncertain and unavailable comparisons permit human review without reporting a match', async t => {
  for (const compare of [async () => ({ ...MATCH, status: 'needs_review', reason: 'below_threshold', similarity: 45 }),
    async () => { throw new Error('private-provider-secret'); }, async () => ({ ...MATCH, similarity: 10 })]) {
    const { h, driver } = await setup(t, provider(compare));
    const app = await change(driver, 'face-check', { consent: true });
    assert.ok(['needs_review', 'unavailable'].includes(app.faceCheck.status));
    assert.equal(app.eligibility.eligible, false); assert.ok(!JSON.stringify(app).includes('private-provider-secret'));
    const submitted = await change(driver, 'submit'); assert.equal(submitted.status, 'submitted');
    assert.equal(submitted.faceCheck.status, app.faceCheck.status);
    assert.ok(!JSON.stringify(h.db.prepare('SELECT * FROM audit_events').all()).includes('private-provider-secret'));
  }
});

test('pending comparisons release database locks, deduplicate in-flight requests, and discard replaced-document results', async t => {
  const started = deferred(), release = deferred(); let calls = 0;
  const { driver } = await setup(t, provider(async () => { calls++; started.resolve(); return await release.promise; }));
  const before = await current(driver), key = randomUUID(), data = { expectedVersion: before.version, consent: true };
  const first = driver.post('/api/driver/application/face-check', data, key);
  await started.promise;
  let app = await current(driver); assert.equal(app.faceCheck.status, 'pending');
  const replay = await driver.post('/api/driver/application/face-check', data, key);
  assert.equal(replay.body.replayed, true); assert.equal(calls, 1);
  assert.equal((await driver.post('/api/driver/application/face-check', { expectedVersion: app.version, consent: true })).body.error.code, 'FACE_CHECK_PENDING');
  assert.equal((await driver.post('/api/driver/application/submit', { expectedVersion: app.version })).body.error.code, 'FACE_CHECK_REQUIRED');
  app = await change(driver, 'upload', { kind: 'profile_photo', ...IMAGE, expiresOn: null });
  assert.equal(app.faceCheck.status, 'not_started');
  assert.equal((await driver.post('/api/driver/application/face-check', { expectedVersion: app.version, consent: true })).body.error.code, 'FACE_CHECK_PENDING');
  release.resolve(MATCH);
  const finished = await first;
  assert.equal(finished.status, 200); assert.equal(finished.body.application.faceCheck.status, 'not_started');
  assert.equal(finished.body.application.version, app.version);
});

test('edits and reopens invalidate matches and do not reset paid-attempt limits', async t => {
  let calls = 0; const { h, driver } = await setup(t, provider(async () => { calls++; return MATCH; }));
  await change(driver, 'face-check', { consent: true });
  let app = await change(driver, 'save', { details: DETAILS }); assert.equal(app.faceCheck.status, 'not_started');
  assert.equal((await driver.post('/api/driver/application/face-check', { expectedVersion: app.version, consent: true })).status, 429);
  for (let attempt = 1; attempt < 5; attempt++) {
    h.advance(60_000); await change(driver, 'face-check', { consent: true });
    await change(driver, 'submit'); app = await change(driver, 'reopen');
    assert.equal(app.faceCheck.status, 'not_started');
  }
  h.advance(60_000);
  assert.equal((await driver.post('/api/driver/application/face-check', { expectedVersion: app.version, consent: true })).body.error.code, 'FACE_CHECK_LIMIT');
  assert.equal(calls, 5); assert.ok(app.faceCheck.retryAfter > h.now);
});

test('abandoned pending attempt times out, and a late completion cannot overwrite a retry', async t => {
  const started = deferred(), release = deferred(); let calls = 0;
  const { h, driver } = await setup(t, provider(async () => { calls++; if (calls === 1) { started.resolve(); return release.promise; } return MATCH; }));
  const app = await current(driver), first = driver.post('/api/driver/application/face-check', { expectedVersion: app.version, consent: true });
  await started.promise; h.advance(60_000);
  const timedOut = await current(driver); assert.equal(timedOut.faceCheck.status, 'unavailable'); assert.equal(timedOut.faceCheck.reason, 'timeout');
  const retried = await change(driver, 'face-check', { consent: true }); assert.equal(retried.faceCheck.status, 'matched');
  release.resolve({ ...MATCH, status: 'needs_review', reason: 'below_threshold', similarity: 1 });
  await first; assert.equal((await current(driver)).faceCheck.status, 'matched');
});

test('revoking a browser session during comparison prevents returning its private result', async t => {
  const started = deferred(), release = deferred();
  const { driver } = await setup(t, provider(async () => { started.resolve(); return release.promise; }));
  const app = await current(driver), result = driver.post('/api/driver/application/face-check', { expectedVersion: app.version, consent: true });
  await started.promise; await driver.post('/api/auth/logout', {}); release.resolve(MATCH);
  const response = await result; assert.equal(response.status, 401); assert.equal(response.body.application, undefined);
});

test('native API uses the same face check and privacy projection; caller cannot choose another driver', async t => {
  let calls = 0; const { h, driver } = await setup(t, provider(async () => { calls++; return MATCH; }));
  async function send(path, data, token) {
    const response = await fetch(h.base + '/api/mobile/v1' + path, { method: data ? 'POST' : 'GET',
      headers: { ...(data ? { 'Content-Type': 'application/json', 'Idempotency-Key': randomUUID() } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      ...(data ? { body: JSON.stringify(data) } : {}) });
    return { status: response.status, body: await response.json() };
  }
  const auth = await send('/auth/login', { email: driver.user.email, password: PASSWORD, deviceName: 'Face test phone' });
  const token = auth.body.credentials.accessToken, before = parseOnboarding((await send('/driver/onboarding', null, token)).body);
  assert.equal((await send('/driver/application/face-check', { expectedVersion: before.version, consent: true, driverId: randomUUID() }, token)).status, 400);
  const response = await send('/driver/application/face-check', { expectedVersion: before.version, consent: true }, token);
  assert.equal(response.status, 200, JSON.stringify(response.body));
  const app = parseOnboarding(response.body); assert.equal(app.faceCheck.status, 'matched'); assert.equal(calls, 1);
  for (const secret of ['documents_json', 'sha256', 'verification', 'events', IMAGE.base64]) assert.ok(!JSON.stringify(response.body).includes(secret), secret);
  assert.equal((await driver.send('/api/session')).body.user.faceCheck, undefined);
  const other = h.client(); await other.register('face-other', 'driver');
  assert.equal((await other.send('/api/admin/drivers/' + driver.user.id)).status, 403);
});

test('disabled configuration never invokes a provider or blocks legacy manual submission', async t => {
  const { driver } = await setup(t, { enabled: false, provider: 'off', threshold: 99, compare: async () => { throw new Error('must not call'); } });
  const app = await current(driver); assert.equal(app.faceCheck.available, false);
  assert.equal((await driver.post('/api/driver/application/face-check', { expectedVersion: app.version, consent: true })).body.error.code, 'FACE_CHECK_DISABLED');
  assert.equal((await change(driver, 'submit')).status, 'submitted');
});
