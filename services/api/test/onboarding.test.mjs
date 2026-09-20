import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { request as httpRequest } from 'node:http';
import { harness, participants, bootstrapAdmin, PASSWORD, requestRide, claimRide } from './helpers.mjs';
import { IMAGE, DETAILS, CHECKS, submitApplication, approveApplication, fixtureApi } from './driver-fixtures.mjs';
import { driverDocumentDeadline } from '../../../packages/shared/src/driver-onboarding.mjs';
import { createDriverDocumentCodec } from '../src/infrastructure/driver-document-codec.mjs';

async function applicants(h) {
  const driver = h.client(), other = h.client(), admin = h.client();
  await driver.register('applicant', 'driver'); await other.register('other-driver', 'driver'); await admin.register('reviewer');
  bootstrapAdmin(h.db, admin.user.email); await admin.post('/api/auth/login', { email: admin.user.email, password: PASSWORD });
  return { driver, other, admin };
}
const app = async (driver) => (await driver.send('/api/driver/application')).body.application;
async function change(driver, action, extra = {}) {
  const current = await app(driver), result = await driver.post(`/api/driver/application/${action}`, { expectedVersion: current.version, ...extra });
  assert.equal(result.status, 200, JSON.stringify(result.body)); return result.body.application;
}
const review = (admin, application, data) => admin.post(`/api/admin/drivers/${application.driverId}/review`, { expectedVersion: application.version, ...data });
const approval = { decision: 'approved', reason: 'Fictional manual checks completed.', reference: 'TEST-REFERENCE', checks: CHECKS };

async function rideStep(who, ride, action, data = {}) {
  const result = await who.post(`/api/rides/${ride.id}/${action}`, { expectedVersion: ride.version, ...data });
  assert.equal(result.status, 200, JSON.stringify(result.body)); return result.body.ride;
}

test('private application submission, document inspection and manual evidence are all required for approval', async (t) => {
  const h = await harness(t, { persistent: true }), { driver, other, admin } = await applicants(h);
  assert.equal((await app(driver)).status, 'draft');
  assert.equal((await driver.post('/api/driver/application/submit', { expectedVersion: 0 })).body.error.code, 'APPLICATION_INCOMPLETE');
  let application = await submitApplication(fixtureApi(driver));
  assert.equal(application.status, 'submitted'); assert.equal(application.eligibility.eligible, false);
  assert.equal((await driver.availability('/api/availability/online', { mode: 'sample', areaId: 'wuse-ii' })).status, 403);
  assert.equal((await review(admin, application, approval)).body.error.code, 'INVALID_REVIEW');
  assert.equal((await admin.post(`/api/admin/drivers/${driver.user.id}/review`, { decision: 'approved' })).status, 400, 'old shortcut cannot grant approval');
  for (const doc of application.documents) {
    assert.equal((await other.send(`/api/driver-documents/${doc.id}`)).status, 404);
    assert.equal((await driver.send(`/api/driver-documents/${doc.id}`)).body.base64, IMAGE.base64);
  }
  assert.equal((await review(admin, application, approval)).status, 400, 'owner downloads do not count for the reviewer');
  for (const doc of application.documents) assert.equal((await admin.send(`/api/driver-documents/${doc.id}`)).status, 200);
  assert.equal((await review(admin, application, { ...approval, checks: { ...CHECKS, identity: false } })).status, 400);
  assert.equal((await review(admin, application, { ...approval, reference: '' })).status, 400);
  application = (await review(admin, application, approval)).body.application;
  assert.equal(application.eligibility.eligible, true); assert.equal(application.verification.method, 'manual');
  assert.equal(application.verification.documents.length, 5); assert.equal(application.reviewedBy, admin.user.id);
  await driver.online(); await h.restart();
  assert.deepEqual((await app(driver)).verification, application.verification);
  assert.equal((await admin.send(`/api/admin/drivers/${driver.user.id}`)).body.application.events[0].action, 'approved');
});

test('document bytes, contact and licence details are owner/admin only and never appear in session, queue, rides or logs', async (t) => {
  const h = await harness(t), { customer, driver, admin } = await participants(h);
  const other = h.client(); await other.register('outsider', 'driver');
  const application = await app(driver), doc = application.documents[0];
  assert.equal((await other.send(`/api/admin/drivers/${driver.user.id}`)).status, 403);
  assert.equal((await customer.send('/api/driver/application')).status, 403);
  for (const who of [other, customer, h.client()]) assert.ok([401, 404].includes((await who.send(`/api/driver-documents/${doc.id}`)).status));
  assert.equal((await driver.send(`/api/driver-documents/${doc.id}`, { headers: { 'Sec-Fetch-Site': 'cross-site' } })).status, 403);
  const download = await admin.send(`/api/driver-documents/${doc.id}`);
  assert.match(download.headers.get('cache-control'), /no-store/); assert.match(download.body.document.downloadName, /^[a-z_]+-[a-f0-9-]+\.png$/);
  const ride = await claimRide(driver, await requestRide(customer));
  const projections = [(await driver.send('/api/session')).body, (await admin.send('/api/admin/drivers')).body, (await customer.send(`/api/rides/${ride.id}`)).body,
    h.db.prepare('SELECT * FROM audit_events').all()];
  for (const value of projections) {
    const text = JSON.stringify(value);
    for (const secret of [DETAILS.phone, DETAILS.licenceNumber, IMAGE.base64, IMAGE.name]) assert.ok(!text.includes(secret), secret);
  }
  assert.equal((await driver.post('/api/auth/logout', {})).status, 200);
  assert.equal((await driver.send(`/api/driver-documents/${doc.id}`)).status, 401);
  for (const path of ['/driver-documents/' + doc.id, '/uploads/' + doc.name, '/data/taxi-ai.sqlite']) assert.equal((await fetch(h.base + path)).status, 404);
});

test('corrections and rejected applications can be resubmitted; replacement removes old bytes and reviewer access records', async (t) => {
  const h = await harness(t), { driver, admin } = await applicants(h);
  let application = await submitApplication(fixtureApi(driver)), old = application.documents.find((doc) => doc.kind === 'driving_licence');
  await admin.send(`/api/driver-documents/${old.id}`);
  application = (await review(admin, application, { decision: 'changes_requested', reason: 'Please replace the unclear licence image.' })).body.application;
  assert.equal(application.status, 'changes_requested');
  application = await change(driver, 'upload', { ...IMAGE, kind: old.kind, expiresOn: '2098-01-01' });
  assert.equal(application.status, 'draft'); assert.equal(application.verification, null);
  assert.equal((await admin.send(`/api/driver-documents/${old.id}`)).status, 404);
  assert.equal(h.db.prepare('SELECT count(*) AS n FROM driver_document_reads WHERE document_id=?').get(old.id).n, 0);
  application = await change(driver, 'submit');
  application = (await review(admin, application, { decision: 'rejected', reason: 'The fictional replacement does not match.' })).body.application;
  assert.equal(application.status, 'rejected'); assert.equal(application.eligibility.eligible, false);
  await change(driver, 'save', { details: { ...DETAILS, licenceNumber: 'CORRECTED-TEST-NUMBER' } });
  await change(driver, 'submit'); application = await approveApplication(fixtureApi(admin), driver.user.id);
  assert.equal(application.eligibility.eligible, true);
  assert.deepEqual(application.events.filter((event) => ['changes_requested', 'rejected', 'approved'].includes(event.action)).map((event) => event.action), ['approved', 'rejected', 'changes_requested']);
});

test('versions, idempotency, review/edit races and failed persistence cannot approve or partially save changed evidence', async (t) => {
  const h = await harness(t), { driver, admin } = await applicants(h);
  const key = randomUUID(), data = { expectedVersion: 0, details: DETAILS };
  let result = await driver.post('/api/driver/application/save', data, key); assert.equal(result.status, 200);
  assert.equal((await driver.post('/api/driver/application/save', data, key)).body.replayed, true);
  assert.equal((await driver.post('/api/driver/application/save', { ...data, details: { ...DETAILS, phone: '+2348111111111' } }, key)).body.error.code, 'KEY_REUSED');
  assert.equal((await driver.post('/api/driver/application/save', data)).body.error.code, 'STALE_VERSION');
  let application = await submitApplication(fixtureApi(driver));
  for (const doc of application.documents) await admin.send(`/api/driver-documents/${doc.id}`);
  const results = await Promise.all([
    review(admin, application, approval), driver.post('/api/driver/application/reopen', { expectedVersion: application.version }),
  ]);
  assert.deepEqual(results.map((item) => item.status).sort(), [200, 409]);
  if ((await app(driver)).status === 'approved') await change(driver, 'reopen');
  application = await app(driver);
  const before = JSON.stringify(application), upload = { expectedVersion: application.version, ...IMAGE, kind: 'insurance', expiresOn: '2097-02-03' }, uploadKey = randomUUID();
  h.db.exec("CREATE TRIGGER reject_driver_retry BEFORE INSERT ON driver_application_commands BEGIN SELECT RAISE(ABORT, 'fixture failure'); END");
  assert.equal((await driver.post('/api/driver/application/upload', upload, uploadKey)).status, 500);
  assert.equal(JSON.stringify(await app(driver)), before, 'document replacement, version and audit roll back together');
  h.db.exec('DROP TRIGGER reject_driver_retry');
  assert.equal((await driver.post('/api/driver/application/upload', upload, uploadKey)).status, 200);
});

test('uploads reject unsafe names, types, signatures, malformed base64, forged fields and oversized bodies', async (t) => {
  const h = await harness(t), { driver, other } = await applicants(h);
  const payload = { expectedVersion: 0, ...IMAGE, kind: 'profile_photo', expiresOn: null };
  for (const extra of [{ name: '../licence.png' }, { name: '<img>.png' }, { name: 'test.svg' }, { mimeType: 'text/html' },
    { base64: Buffer.from('<html>not an image</html>').toString('base64') }, { base64: IMAGE.base64 + '\n' }, { kind: 'passport' },
    { expiresOn: '2099-01-01' }, { expectedVersion: '0' }, { driverId: other.user.id }, { status: 'approved' }]) {
    assert.equal((await driver.post('/api/driver/application/upload', { ...payload, ...extra })).status, 400, JSON.stringify(extra));
  }
  assert.equal((await driver.post('/api/driver/application/upload', { ...payload, base64: 'A'.repeat(2_800_000) })).status, 413);
  assert.equal((await driver.post('/api/driver/application/save', { expectedVersion: 0, details: 'a'.repeat(17000) })).status, 413, 'other routes retain their small limit');
  assert.equal((await driver.send('/api/driver/application/upload', { method: 'POST', data: payload, headers: { 'Idempotency-Key': randomUUID(), 'X-CSRF-Token': null } })).status, 403);
  assert.equal((await app(driver)).documents.length, 0);
  assert.equal((await driver.post('/api/driver/application/upload', payload)).status, 200);
  const codec = createDriverDocumentCodec(2 * 1024 * 1024), max = Buffer.alloc(2 * 1024 * 1024);
  const source = Buffer.from(IMAGE.base64, 'base64'); source.copy(max); source.subarray(-12).copy(max, max.length - 12);
  assert.equal(codec.decode({ ...IMAGE, base64: max.toString('base64') }).sizeBytes, max.length, 'large envelope validates without a regexp stack overflow');
  assert.throws(() => codec.decode({ ...IMAGE, base64: Buffer.concat([max, Buffer.from('a')]).toString('base64') }), { code: 'INVALID_DOCUMENT' });
});

test('a revoked session during a streamed upload cannot write after logout', async (t) => {
  const h = await harness(t), driver = h.client(); await driver.register('streaming', 'driver');
  const data = JSON.stringify({ expectedVersion: 0, ...IMAGE, kind: 'profile_photo', expiresOn: null });
  let started;
  const ready = new Promise((resolve) => { started = resolve; });
  let req;
  const response = new Promise((resolve, reject) => {
    req = httpRequest(h.base + '/api/driver/application/upload', { method: 'POST', headers: {
      Cookie: driver.cookie, Origin: h.base, 'Content-Type': 'application/json', 'X-CSRF-Token': driver.csrf,
      'Idempotency-Key': randomUUID(), 'Content-Length': Buffer.byteLength(data),
    } }, (res) => { const chunks = []; res.on('data', (chunk) => chunks.push(chunk)); res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(Buffer.concat(chunks)) })); });
    req.on('error', reject); req.write(data.slice(0, 15), started);
  });
  await ready;
  await driver.post('/api/auth/logout', {}); req.end(data.slice(15));
  assert.equal((await response).status, 401);
  assert.equal(h.db.prepare('SELECT count(*) AS n FROM driver_documents').get().n, 0);
});

test('Abuja expiry is exact, impossible dates fail, and expiry blocks online, claim, booking and starting without blocking cancellation', async (t) => {
  assert.equal(driverDocumentDeadline('2026-02-29'), null); assert.equal(driverDocumentDeadline('2028-02-29'), Date.parse('2028-02-29T23:00:00Z'));
  const h = await harness(t), { customer, driver } = await participants(h);
  let ride = await claimRide(driver, await requestRide(customer));
  ride = await rideStep(driver, ride, 'offers', { amountKobo: 450000 }); ride = await rideStep(customer, ride, 'accept', { offerId: ride.negotiation.currentOffer.id });
  // Move expiry to an exact boundary without advancing beyond the session lifetime.
  h.db.prepare("UPDATE driver_documents SET expires_on='1970-01-01' WHERE driver_id=? AND kind='insurance'").run(driver.user.id);
  h.advance(driverDocumentDeadline('1970-01-01') - 1_000_000 - 1);
  await driver.post('/api/auth/login', { email: driver.user.email, password: PASSWORD });
  await customer.post('/api/auth/login', { email: customer.user.email, password: PASSWORD });
  assert.equal((await app(driver)).eligibility.eligible, true);
  h.advance(1); assert.equal((await app(driver)).eligibility.eligible, false);
  assert.equal((await customer.post(`/api/rides/${ride.id}/confirm`, { expectedVersion: ride.version })).body.error.code, 'DRIVER_NOT_ELIGIBLE');
  assert.equal((await driver.availability('/api/availability/online', { mode: 'sample', areaId: 'wuse-ii' })).body.error.code, 'DRIVER_NOT_ELIGIBLE');
  assert.equal((await driver.post(`/api/rides/${ride.id}/claim`, { expectedVersion: ride.version })).body.error.code, 'DRIVER_NOT_ELIGIBLE');
  await rideStep(customer, ride, 'cancel');
});

test('application edits are blocked throughout assigned work; expired documents permit an already-started trip to finish', async (t) => {
  const h = await harness(t), { customer, driver } = await participants(h);
  let ride = await claimRide(driver, await requestRide(customer));
  const application = await app(driver);
  async function blocked() { assert.equal((await driver.post('/api/driver/application/reopen', { expectedVersion: application.version })).body.error.code, 'DRIVER_BUSY'); }
  await blocked(); ride = await rideStep(driver, ride, 'offers', { amountKobo: 450000 });
  ride = await rideStep(customer, ride, 'accept', { offerId: ride.negotiation.currentOffer.id }); await blocked();
  ride = await rideStep(customer, ride, 'confirm'); const pin = ride.trip.pickupPin; await blocked();
  ride = await rideStep(driver, ride, 'depart'); ride = await rideStep(driver, ride, 'arrive');
  h.db.prepare("UPDATE driver_documents SET expires_on='1969-12-31' WHERE driver_id=? AND kind='insurance'").run(driver.user.id);
  assert.equal((await driver.post(`/api/rides/${ride.id}/start`, { expectedVersion: ride.version, pickupPin: pin })).body.error.code, 'DRIVER_NOT_ELIGIBLE');
  h.db.prepare("UPDATE driver_documents SET expires_on='2099-12-31' WHERE driver_id=? AND kind='insurance'").run(driver.user.id);
  ride = await rideStep(driver, ride, 'start', { pickupPin: pin }); await blocked();
  h.db.prepare("UPDATE driver_documents SET expires_on='1969-12-31' WHERE driver_id=? AND kind='insurance'").run(driver.user.id);
  ride = await rideStep(driver, ride, 'complete'); assert.equal(ride.status, 'completed');
  assert.equal((await driver.send('/api/driver/earnings')).status, 200);
  assert.equal((await driver.send('/api/rides/history')).body.rides[0].id, ride.id);
  await change(driver, 'reopen');
});

test('reopening immediately removes new-work eligibility and later vehicle changes cannot rewrite old trip identities', async (t) => {
  const h = await harness(t), { customer, driver, admin } = await participants(h);
  let ride = await claimRide(driver, await requestRide(customer)); const original = structuredClone(ride.driver);
  ride = await rideStep(customer, ride, 'cancel');
  await driver.online(); await change(driver, 'reopen');
  assert.equal((await driver.send('/api/availability')).body.availability, null);
  await change(driver, 'save', { details: { ...DETAILS, vehicle: { ...DETAILS.vehicle, make: 'Honda', model: 'Accord', plate: 'NEW-123' } } });
  await change(driver, 'submit'); await approveApplication(fixtureApi(admin), driver.user.id);
  assert.equal((await driver.send('/api/session')).body.user.driver.vehicle.plate, 'NEW-123');
  assert.deepEqual((await customer.send(`/api/rides/${ride.id}`)).body.ride.driver, original);
  const history = (await customer.send('/api/rides/history')).body.rides[0]; assert.deepEqual(history.driver, original);
});
