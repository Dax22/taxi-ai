import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { harness, participants, requestRide, claimRide, PASSWORD } from './helpers.mjs';
import { DETAILS } from './driver-fixtures.mjs';

const endpoint = '/api/account/driver-profile/delete';
const app = async (client) => (await client.send('/api/driver/application')).body.application;
const confirmation = (application) => ({ expectedVersion: application.version, confirmation: 'DELETE' });
const changeRide = async (client, ride, action, extra = {}) => {
  const result = await client.post(`/api/rides/${ride.id}/${action}`, { expectedVersion: ride.version, ...extra });
  assert.equal(result.status, 200, JSON.stringify(result.body)); return result.body.ride;
};

test('deleting Work removes current documents and availability, preserves customer access and historical vehicle identity across restart', async (t) => {
  const h = await harness(t, { persistent: true }), { driver, customer, admin } = await participants(h);
  const ride = await claimRide(driver, await requestRide(customer)), identity = structuredClone(ride.driver);
  await changeRide(customer, ride, 'cancel'); await driver.online();
  const application = await app(driver), data = confirmation(application), key = randomUUID(), id = driver.user.id;
  const cookie = driver.cookie, csrf = driver.csrf, events = application.events.length;
  const deleted = await driver.post(endpoint, data, key);
  assert.equal(deleted.status, 200, JSON.stringify(deleted.body));
  assert.equal(driver.user.id, id); assert.equal(driver.cookie, cookie); assert.equal(driver.csrf, csrf);
  assert.deepEqual(driver.user.capabilities, ['customer']); assert.equal(driver.user.driver, null);
  assert.equal(h.db.prepare('SELECT count(*) AS n FROM driver_documents WHERE driver_id=?').get(id).n, 0);
  assert.equal(h.db.prepare('SELECT count(*) AS n FROM driver_document_reads').get().n, 0);
  assert.equal(h.db.prepare('SELECT details_json FROM driver_applications WHERE driver_id=?').get(id).details_json, null);
  const availability = h.db.prepare('SELECT active,position_json,session_hash,reason FROM driver_availability WHERE driver_id=? ORDER BY started_at DESC').all(id);
  assert.ok(availability.every((row) => row.active === 0 && row.position_json === null && row.session_hash === null));
  assert.ok(availability.some((row) => row.reason === 'approval_changed'));
  assert.equal(h.db.prepare('SELECT count(*) AS n FROM driver_application_events WHERE driver_id=?').get(id).n, events + 1);
  assert.equal((await admin.send('/api/admin/drivers')).body.drivers.some((d) => d.id === id), false);
  assert.equal((await admin.send(`/api/admin/drivers/${id}`)).status, 404);
  for (const client of [driver, admin]) assert.equal((await client.send(`/api/driver-documents/${application.documents[0].id}`)).status, 404);
  assert.equal((await driver.send('/api/driver/application')).status, 403);
  assert.equal((await driver.availability('/api/availability/online', { mode: 'sample', areaId: 'wuse-ii' })).status, 403);
  assert.equal((await driver.post(endpoint, data, key)).body.replayed, true);
  await h.restart();
  assert.equal((await driver.send('/api/session')).body.user.driver, null);
  assert.deepEqual((await customer.send(`/api/rides/${ride.id}`)).body.ride.driver, identity);
  assert.deepEqual(h.db.prepare('PRAGMA foreign_key_check').all(), []);
  assert.equal((await requestRide(driver)).customer.id, id);
});

test('deletion is versioned, explicit, owner-only and atomic; prior retries cannot delete a new Work profile', async (t) => {
  const h = await harness(t), { driver, customer, admin } = await participants(h), original = await app(driver);
  const data = confirmation(original), key = randomUUID(), id = driver.user.id;
  assert.equal((await driver.post(endpoint, { ...data, confirmation: '' })).status, 400);
  assert.equal((await driver.post(endpoint, { ...data, driverId: customer.user.id })).status, 400);
  assert.equal((await driver.post(endpoint, { ...data, expectedVersion: 0 })).body.error.code, 'STALE_VERSION');
  assert.equal((await customer.post(endpoint, data)).status, 404);
  assert.equal((await admin.post(endpoint, data)).status, 403);
  assert.equal((await driver.send(endpoint, { method: 'POST', data, headers: { 'X-CSRF-Token': null, 'Idempotency-Key': key } })).status, 403);
  assert.equal((await h.client().post(endpoint, data)).status, 401);
  h.db.exec("CREATE TRIGGER fail_work_delete BEFORE INSERT ON account_commands BEGIN SELECT RAISE(ABORT, 'fixture rollback'); END;");
  assert.equal((await driver.post(endpoint, data, key)).status, 500);
  assert.deepEqual(await app(driver), original);
  assert.equal((await driver.send('/api/availability')).body.availability.online, true);
  h.db.exec('DROP TRIGGER fail_work_delete');
  assert.equal((await driver.post(endpoint, data, key)).status, 200);
  const reenrolled = await driver.post('/api/account/driver-profile', { vehicle: { ...DETAILS.vehicle, plate: 'NEW-CAR' } });
  assert.equal(reenrolled.status, 200, JSON.stringify(reenrolled.body));
  const next = await app(driver);
  assert.ok(next.version > original.version); assert.equal(next.details, null); assert.equal(next.documents.length, 0);
  assert.equal(driver.user.driver.status, 'pending'); assert.equal(driver.user.driver.eligibility.eligible, false);
  assert.equal(next.vehicle.plate, 'NEW-CAR');
  assert.equal((await driver.post(endpoint, data, key)).body.replayed, true);
  assert.deepEqual(await app(driver), next, 'a replay cannot remove the new profile');
  assert.equal((await driver.post(endpoint, data)).body.error.code, 'STALE_VERSION');
  assert.equal((await driver.post(endpoint, confirmation(next), key)).body.error.code, 'KEY_REUSED');
  assert.equal((await driver.post('/api/driver/application/save', { expectedVersion: original.version, details: DETAILS })).body.error.code, 'STALE_VERSION');
  assert.equal((await driver.post('/api/driver/application/save', { expectedVersion: next.version, details: DETAILS })).status, 200);
  assert.equal(h.db.prepare('SELECT count(*) AS n FROM drivers WHERE user_id=?').get(id).n, 1);
});

test('a driver cannot delete Work during negotiation, booking or a started journey', async (t) => {
  const h = await harness(t), { driver, customer } = await participants(h), data = confirmation(await app(driver));
  let ride = await claimRide(driver, await requestRide(customer));
  const blocked = async () => assert.equal((await driver.post(endpoint, data)).body.error.code, 'DRIVER_BUSY');
  await blocked(); ride = await changeRide(driver, ride, 'offers', { amountKobo: 450000 });
  ride = await changeRide(customer, ride, 'accept', { offerId: ride.negotiation.currentOffer.id }); await blocked();
  ride = await changeRide(customer, ride, 'confirm'); const pin = ride.trip.pickupPin; await blocked();
  ride = await changeRide(driver, ride, 'depart'); ride = await changeRide(driver, ride, 'arrive');
  ride = await changeRide(driver, ride, 'start', { pickupPin: pin }); await blocked();
  await changeRide(driver, ride, 'complete');
  assert.equal((await driver.post(endpoint, data)).status, 200);
  assert.equal((await customer.send(`/api/rides/${ride.id}`)).body.ride.status, 'completed');
});

test('claiming a request and deleting Work cannot both succeed', async (t) => {
  const h = await harness(t), { driver, customer } = await participants(h), ride = await requestRide(customer);
  const data = confirmation(await app(driver));
  const results = await Promise.all([driver.post(endpoint, data), driver.post(`/api/rides/${ride.id}/claim`, { expectedVersion: ride.version })]);
  assert.equal(results.filter((r) => r.status === 200).length, 1);
  assert.ok(results.some((r) => [403,409].includes(r.status)));
});

test('native deletion uses the same confirmation/version and keeps customer sessions usable', async (t) => {
  const h = await harness(t), { driver } = await participants(h), data = confirmation(await app(driver));
  let token;
  const send = async (path, payload, key = randomUUID()) => {
    const r = await fetch(h.base + '/api/mobile/v1' + path, { method: payload === undefined ? 'GET' : 'POST',
      headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), 'Content-Type': 'application/json', 'Idempotency-Key': key },
      ...(payload === undefined ? {} : { body: JSON.stringify(payload) }) });
    return { status: r.status, body: await r.json() };
  };
  const login = await send('/auth/login', { email: driver.user.email, password: PASSWORD, deviceName: 'Work test phone' });
  assert.equal(login.status, 200); token = login.body.credentials.accessToken;
  assert.equal((await send('/account/driver-profile/delete', { ...data, confirmation: 'yes' })).status, 400);
  const key = randomUUID(), result = await send('/account/driver-profile/delete', data, key);
  assert.equal(result.status, 200, JSON.stringify(result.body)); assert.equal(result.body.user.driver, null);
  assert.equal((await send('/account/driver-profile/delete', data, key)).body.replayed, true);
  assert.equal((await send('/session')).body.user.id, driver.user.id);
  assert.equal((await send('/driver/onboarding')).status, 403);
  assert.equal((await send('/work')).status, 403);
  assert.equal((await send('/activity?mode=customer')).status, 200);
  assert.equal((await driver.send('/api/session')).body.user.driver, null);
});
