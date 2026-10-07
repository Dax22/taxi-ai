import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { harness, participants, claimRide, PASSWORD } from './helpers.mjs';
import { createStaffFactor } from '../src/infrastructure/staff-factor.mjs';

const root = '/api/admin/console/safety-alerts';
const must = (r, status = 200) => { assert.equal(r.status, status, JSON.stringify(r.body)); return r.body; };
async function fixture(t, options = {}) {
  const h = await harness(t, { persistent: true, ...options }), f = { h, ...await participants(h) };
  let ride = must(await f.customer.post('/api/rides', { pickupId: 'wuse-ii', destinationId: 'maitama',
    passenger: { kind: 'guest', name: 'Fixture passenger', phone: '+2348000000003', consent: true } }), 201).ride;
  ride = await claimRide(f.driver, ride);
  const step = async (actor, action, data = {}) => { ride = must(await actor.post(`/api/rides/${ride.id}/${action}`, { expectedVersion: ride.version, ...data })).ride; return ride; };
  await step(f.driver, 'offers', { amountKobo: 470000 }); await step(f.customer, 'accept', { offerId: ride.negotiation.currentOffer.id }); await step(f.customer, 'confirm');
  const contact = must(await f.customer.post('/api/safety/contacts', { name: 'Fixture trusted contact', phone: '+2348000000004' })).contact;
  const path = `/api/safety-monitoring/rides/${ride.id}`;
  must(await f.customer.post(path + '/preferences', { enabled: true, crash: true, distress: true, contactIds: [contact.id], emergency: false, consent: true, expectedVersion: 0 }));
  const input = { signal: { kind: 'impact', capturedAt: h.now, peakG: 6, speedBefore: 10, speedAfter: 1, windowMs: 1000 },
    position: { lat: 9.087654, lng: 7.412345, accuracy: 12, capturedAt: h.now } };
  const alert = must(await f.customer.post(path + '/signal', input)).alerts[0];
  return { ...f, ride, step, path, alert, input };
}
async function staff(f, role) {
  const actor = f.h.client(); await actor.register('safety-page-' + role);
  must(await f.admin.post('/api/admin/console/staff/assign', { email: actor.user.email, role, expectedVersion: 0, reason: 'Fixture safety access test' }));
  must(await actor.post('/api/admin/console/login', { email: actor.user.email, password: PASSWORD })); return actor;
}

test('actual signal reaches restricted staff API with separate passenger, customer, driver and location', async t => {
  const f = await fixture(t), safety = await staff(f, 'safety'), support = await staff(f, 'support');
  assert.equal((await f.h.client().send(root)).status, 401);
  for (const actor of [f.customer, f.driver, support]) {
    assert.equal((await actor.send(root)).status, 403);
    assert.equal((await actor.send(root + '/' + f.alert.id + '?live=1')).status, 403);
  }
  const list = must(await safety.send(root)); assert.equal(list.items.length, 1); assert.equal(list.items[0].label, 'Possible crash');
  assert.equal(list.items[0].customer.id, f.customer.user.id); assert.equal(list.items[0].passenger.kind, 'guest');
  for (const privateValue of [f.customer.user.email, '+2348000000003', '9.087654']) assert.ok(!JSON.stringify(list).includes(privateValue));
  const detail = must(await safety.send(root + '/' + f.alert.id));
  assert.equal(detail.passenger.name, 'Fixture passenger'); assert.equal(detail.passenger.phone, '+2348000000003');
  assert.equal(detail.customer.id, f.customer.user.id); assert.equal(detail.customer.contact.email, f.customer.user.email);
  assert.equal(detail.driver.id, f.driver.user.id); assert.equal(detail.driver.vehicle.plate, 'TEST-DRIVER');
  assert.equal(detail.incidentPosition.lat, 9.087654); assert.equal(detail.incidentPosition.source, 'reporter_device');
  assert.equal(detail.currentPosition, null); assert.equal(detail.currentPositionRequested, false);
  assert.equal(detail.alert.isTest, true); assert.equal(detail.alert.verifiedIncident, false);
  for (const key of ['pickupPin','passwordHash','recipientJson','secret_encrypted']) assert.ok(!JSON.stringify(detail).includes(key));
  assert.ok(f.h.db.prepare("SELECT 1 FROM audit_events WHERE actor_id=? AND kind='admin.safety_alert_viewed'").get(safety.user.id));
});

test('staff writes require CSRF, valid versions and current safety permission; retries do not duplicate', async t => {
  const f = await fixture(t), safety = await staff(f, 'safety'), path = root + '/' + f.alert.id;
  const key = randomUUID(), data = { action: 'acknowledge', expectedVersion: 0, note: 'Fixture responder checking this alert.' };
  const denied = await safety.send(path, { method: 'POST', data, headers: { 'X-CSRF-Token': null, 'Idempotency-Key': key } });
  assert.equal(denied.status, 403); assert.equal(f.h.db.prepare('SELECT count(*) AS n FROM safety_alert_reviews').get().n, 0);
  let result = must(await safety.post(path, data, key)); assert.equal(result.alert.review.state, 'acknowledged');
  assert.equal(must(await safety.post(path, data, key)).replayed, true);
  assert.equal((await safety.post(path, { ...data, note: 'A different test note.' }, key)).body.error.code, 'KEY_REUSED');
  assert.equal((await safety.post(path, { action: 'resolve', expectedVersion: 0, note: 'Outdated fixture review.' })).body.error.code, 'STALE_VERSION');
  result = must(await safety.post(path, { action: 'resolve', expectedVersion: 1, note: 'Fixture assessment completed, no dispatch asserted.' }));
  assert.equal(result.alert.review.state, 'resolved'); assert.equal(f.h.db.prepare('SELECT status FROM safety_auto_alerts').get().status, 'countdown');
  assert.equal(f.h.db.prepare('SELECT count(*) AS n FROM safety_alert_review_events').get().n, 2);
  const membership = f.h.db.prepare('SELECT version FROM staff_memberships WHERE user_id=?').get(safety.user.id);
  must(await f.admin.post('/api/admin/console/staff/revoke', { userId: safety.user.id, expectedVersion: membership.version, reason: 'End fixture safety access.' }));
  assert.ok([401,403].includes((await safety.send(path)).status));
  assert.ok([401,403].includes((await safety.post(path, { action: 'reopen', expectedVersion: 2, note: 'Forbidden stale session.' })).status));
});

test('historical position survives restart while current sharing ends with trip cancellation', async t => {
  const f = await fixture(t), path = root + '/' + f.alert.id;
  await f.driver.shareTripLocation(f.ride.id, { lat: 9.09, lng: 7.42 });
  let detail = must(await f.admin.send(path + '?live=1')); assert.equal(detail.currentPosition.lat, 9.09);
  assert.equal(detail.incidentPosition.lat, 9.087654);
  await f.h.restart(); detail = must(await f.admin.send(path)); assert.equal(detail.incidentPosition.lat, 9.087654);
  await f.step(f.customer, 'cancel', { reason: 'plans_changed' });
  detail = must(await f.admin.send(path + '?live=1')); assert.equal(detail.currentPosition, null); assert.equal(detail.canRequestCurrentPosition, false);
  assert.equal(detail.incidentPosition.lat, 9.087654);
});

test('failed review-event insertion rolls back acknowledgment and safely retries once', async t => {
  const f = await fixture(t), path = root + '/' + f.alert.id, key = randomUUID();
  const data = { action: 'acknowledge', expectedVersion: 0, note: 'Fixture atomic acknowledgment.' };
  f.h.db.exec("CREATE TRIGGER fail_safety_event BEFORE INSERT ON safety_alert_review_events BEGIN SELECT RAISE(ABORT,'fixture'); END");
  assert.equal((await f.admin.post(path, data, key)).status, 500);
  assert.equal(f.h.db.prepare('SELECT count(*) AS n FROM safety_alert_reviews').get().n, 0);
  f.h.db.exec('DROP TRIGGER fail_safety_event'); must(await f.admin.post(path, data, key));
  assert.equal(f.h.db.prepare('SELECT count(*) AS n FROM safety_alert_review_events').get().n, 1);
});

test('required MFA and native bearer isolation protect new staff endpoints', async t => {
  const f = await fixture(t);
  // Change the server policy only inside this disposable harness; no live configuration is read.
  const { createApplication } = await import('../src/application.mjs');
  const factor = createStaffFactor({ key: 'ab'.repeat(32), required: true });
  const app = createApplication({ db: f.h.db, clock: () => f.h.now, staffMfa: { required: true, factor } });
  const { authorizeStaffRequest } = await import('../src/http/staff-boundary.mjs');
  const owner = await app.accounts.profile(f.admin.user.id), token = f.admin.cookie.split('=')[1];
  await assert.rejects(authorizeStaffRequest(app.staffAccess, owner, token, root), { code: 'MFA_SETUP_REQUIRED' });
  const login = await fetch(f.h.base + '/api/mobile/v1/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: f.customer.user.email, password: PASSWORD, deviceName: 'Fixture phone' }) });
  const auth = await login.json();
  assert.equal((await fetch(f.h.base + root, { headers: { Authorization: `Bearer ${auth.credentials.accessToken}` } })).status, 401);
  assert.equal((await fetch(f.h.base + '/api/mobile/v1/admin/console/safety-alerts', { headers: { Authorization: `Bearer ${auth.credentials.accessToken}` } })).status, 404);
  await app.realtime.close();
});
