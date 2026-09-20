import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { harness, participants, requestRide, claimRide, PASSWORD, bootstrapAdmin } from './helpers.mjs';
import { submitApplication, approveApplication, fixtureApi } from './driver-fixtures.mjs';
import { SCHEMA_VERSION } from '../src/infrastructure/database.mjs';

const vehicle = { model: 'Toyota Corolla', plate: 'TEST-UNIFIED' };
async function addDriver(client, key = randomUUID()) {
  const result = await client.post('/api/account/driver-profile', { vehicle }, key);
  assert.equal(result.status, 200, JSON.stringify(result.body)); return result;
}
async function change(client, ride, action, extra = {}) {
  const result = await client.post(`/api/rides/${ride.id}/${action}`, { expectedVersion: ride.version, ...extra });
  assert.equal(result.status, 200, JSON.stringify(result.body)); return result.body.ride;
}
async function agree(customer, driver) {
  let ride = await claimRide(driver, await requestRide(customer));
  ride = await change(driver, ride, 'offers', { amountKobo: 470001 });
  return change(customer, ride, 'accept', { offerId: ride.negotiation.currentOffer.id });
}
const call = (client, path, data = {}, key = randomUUID()) => client.send(path, { method: 'POST', data,
  headers: { 'X-Call-Client': 'aaaa1111-1111-4111-8111-111111111111', 'Idempotency-Key': key } });

test('one login can add a pending driver application atomically without losing its personal history or session', async (t) => {
  const h = await harness(t, { persistent: true }), account = h.client();
  assert.equal((await account.post('/api/auth/register', { name: 'Unified', email: 'unified@example.test', password: PASSWORD })).status, 201);
  const id = account.user.id, cookie = account.cookie, csrf = account.csrf;
  assert.deepEqual(account.user.capabilities, ['customer']);
  const ride = await requestRide(account);
  const key = randomUUID();
  h.db.exec("CREATE TRIGGER reject_account_command BEFORE INSERT ON account_commands BEGIN SELECT RAISE(ABORT, 'fixture failure'); END;");
  assert.equal((await account.post('/api/account/driver-profile', { vehicle }, key)).status, 500);
  assert.equal(h.db.prepare('SELECT count(*) AS n FROM drivers').get().n, 0);
  assert.equal(h.db.prepare('SELECT count(*) AS n FROM driver_applications').get().n, 0);
  assert.equal(h.db.prepare("SELECT count(*) AS n FROM account_capabilities WHERE capability='driver'").get().n, 0);
  h.db.exec('DROP TRIGGER reject_account_command');
  await addDriver(account, key);
  assert.equal(account.user.id, id); assert.equal(account.cookie, cookie); assert.equal(account.csrf, csrf);
  assert.deepEqual(account.user.capabilities, ['customer', 'driver']);
  assert.equal(account.user.driver.status, 'pending'); assert.equal(account.user.driver.eligibility.eligible, false);
  assert.equal((await account.send('/api/driver/application')).body.application.status, 'draft');
  assert.equal((await addDriver(account, key)).body.replayed, true);
  assert.equal((await account.post('/api/account/driver-profile', { vehicle: { ...vehicle, plate: 'DIFFERENT' } }, key)).body.error.code, 'KEY_REUSED');
  assert.equal((await account.post('/api/account/driver-profile', { vehicle })).body.error.code, 'DRIVER_PROFILE_EXISTS');
  assert.equal((await account.availability('/api/availability/online', { mode: 'sample', areaId: 'wuse-ii' })).status, 403);
  await h.restart();
  assert.equal((await account.send('/api/session')).body.user.id, id);
  assert.equal((await account.send('/api/rides?mode=customer')).body.rides[0].id, ride.id);
  assert.deepEqual((await account.send('/api/rides?mode=work')).body.rides, []);
  assert.equal((await account.send('/api/rides?mode=work')).body.activeElsewhere[0].id, ride.id);
  assert.equal(h.db.prepare('SELECT count(*) AS n FROM users').get().n, 1);
  assert.equal(h.db.prepare('SELECT count(*) AS n FROM account_commands').get().n, 1);
});

test('capabilities cannot be forged through mode selection, signup, enrollment or administrator promotion', async (t) => {
  const h = await harness(t), { customer, admin } = await participants(h, 0);
  for (const extra of [{ role: 'admin' }, { capabilities: ['driver', 'admin'] }, { approved: true }, { userId: admin.user.id }]) {
    assert.equal((await customer.post('/api/account/driver-profile', { vehicle, ...extra })).status, 400);
  }
  assert.equal((await customer.send('/api/rides?mode=work')).status, 403);
  assert.equal((await customer.send('/api/rides?mode=admin')).status, 400);
  assert.equal((await admin.post('/api/account/driver-profile', { vehicle })).status, 403);
  assert.deepEqual(admin.user.capabilities, []);
  assert.equal((await customer.send('/api/account/driver-profile', { method: 'POST', data: { vehicle },
    headers: { 'X-CSRF-Token': null, 'Idempotency-Key': randomUUID() } })).status, 403);
  await addDriver(customer);
  assert.equal((await customer.send('/api/admin/drivers')).status, 403);
  const separate = await harness(t), applicant = separate.client(); await applicant.register('applicant'); await addDriver(applicant);
  assert.throws(() => bootstrapAdmin(separate.db, applicant.user.email), { code: 'INVALID_ACCOUNT' });
});

test('the assigned passenger and driver retain distinct powers even when both have driver profiles', async (t) => {
  const h = await harness(t), { customer, driver, admin } = await participants(h);
  await addDriver(customer); await submitApplication(fixtureApi(customer)); await approveApplication(fixtureApi(admin), customer.user.id);
  let ride = await agree(customer, driver);
  const path = `/api/rides/${ride.id}`;
  assert.equal((await driver.post(`${path}/confirm`, { expectedVersion: ride.version })).status, 403);
  ride = await change(customer, ride, 'confirm'); const pin = ride.trip.pickupPin;
  assert.equal((await customer.post(`${path}/depart`, { expectedVersion: ride.version })).status, 403);
  assert.equal((await driver.send(path)).body.ride.trip.pickupPin, undefined);
  for (const action of ['depart', 'arrive', 'start', 'complete']) ride = await change(driver, ride, action, action === 'start' ? { pickupPin: pin } : {});
  let payment = (await customer.send(`/api/payments/rides/${ride.id}`)).body.payment;
  assert.equal((await driver.post(`/api/payments/rides/${ride.id}/start`, { expectedVersion: payment.version })).status, 403);
  payment = (await customer.post(`/api/payments/rides/${ride.id}/start`, { expectedVersion: payment.version })).body.payment;
  assert.equal((await driver.post(`/api/payments/rides/${ride.id}/attempts/${payment.attempt.id}/simulate`, { expectedVersion: payment.version, outcome: 'success' })).status, 403);
  const paid = await customer.post(`/api/payments/rides/${ride.id}/attempts/${payment.attempt.id}/simulate`, { expectedVersion: payment.version, outcome: 'success' });
  assert.equal(paid.status, 200, JSON.stringify(paid.body));
  const customerHistory = (await customer.send('/api/rides/history?mode=customer')).body.rides;
  assert.equal(customerHistory[0].id, ride.id);
  assert.deepEqual((await customer.send('/api/rides/history?mode=work')).body.rides, []);
  assert.equal((await customer.send(`/api/rides/history?mode=work&before=${ride.id}`)).status, 400);
  assert.equal((await driver.send('/api/rides/history?mode=work')).body.rides[0].id, ride.id);
  assert.deepEqual((await driver.send('/api/rides/history?mode=customer')).body.rides, []);
  assert.equal((await customer.send('/api/driver/earnings')).body.summary.simulatedPaidKobo, '0');
  const reverse = await agree(driver, customer);
  assert.equal(reverse.driver.id, customer.user.id);
  assert.equal((await customer.send('/api/rides?mode=work')).body.rides[0].id, reverse.id);
  assert.equal((await customer.send('/api/rides/history?mode=customer')).body.rides[0].id, ride.id);
  assert.equal((await driver.send('/api/driver/earnings')).body.summary.simulatedPaidKobo, '470001');
});

test('an unapproved legacy driver can be a passenger, negotiate, chat and call without bypassing driving approval', async (t) => {
  const h = await harness(t), { driver } = await participants(h), passenger = h.client();
  await passenger.register('pending-passenger', 'driver');
  let ride = await claimRide(driver, await requestRide(passenger));
  const path = `/api/rides/${ride.id}`;
  const message = await passenger.post(`${path}/chat/messages`, { body: 'Passenger with a pending application' });
  assert.equal(message.status, 201, JSON.stringify(message.body));
  const ringing = await call(passenger, `${path}/calls`); assert.equal(ringing.status, 201, JSON.stringify(ringing.body));
  // Sweep must look up the assigned driver, not assume a caller with role=driver is driving.
  assert.equal((await passenger.send('/api/calls')).body.active.id, ringing.body.call.id);
  ride = await change(passenger, ride, 'offers', { amountKobo: 470000 });
  ride = await change(driver, ride, 'accept', { offerId: ride.negotiation.currentOffer.id });
  ride = await change(passenger, ride, 'confirm');
  assert.equal((await passenger.send(`${path}/location`)).status, 200);
  const sos = await passenger.post(`/api/safety/rides/${ride.id}/incidents`, { kind: 'need_help', note: 'Fixture only', contactIds: [] });
  assert.equal(sos.status, 200, JSON.stringify(sos.body));
  assert.equal(sos.body.incident.snapshot.reporter.role, 'customer');
  assert.equal((await passenger.availability('/api/availability/online', { mode: 'sample', areaId: 'wuse-ii' })).status, 403);
  assert.equal((await passenger.post(`${path}/depart`, { expectedVersion: ride.version })).status, 403);
});

test('cross-role capacity is enforced for online status, self-claim, agreed fares and active journeys', async (t) => {
  const h = await harness(t), { customer, driver, drivers } = await participants(h, 2), other = drivers[1];
  const ownAvailability = (await driver.send('/api/availability')).body.availability;
  assert.equal((await driver.post('/api/rides', { pickupId: 'wuse-ii', destinationId: 'maitama' })).body.error.code, 'DRIVER_ONLINE');
  await driver.availability(`/api/availability/${ownAvailability.id}/offline`);
  let personal = await requestRide(driver);
  assert.equal((await driver.post(`/api/rides/${personal.id}/claim`, { expectedVersion: personal.version })).status, 403);
  assert.equal((await driver.availability('/api/availability/online', { mode: 'sample', areaId: 'wuse-ii' })).body.error.code, 'DRIVER_BUSY');
  const work = await requestRide(customer);
  assert.equal((await driver.post(`/api/rides/${work.id}/claim`, { expectedVersion: work.version })).body.error.code, 'CUSTOMER_BUSY');
  personal = await claimRide(other, personal);
  personal = await change(other, personal, 'offers', { amountKobo: 400000 });
  personal = await change(driver, personal, 'accept', { offerId: personal.negotiation.currentOffer.id });
  assert.equal((await driver.availability('/api/availability/online', { mode: 'sample', areaId: 'wuse-ii' })).body.error.code, 'DRIVER_BUSY');
  assert.equal((await other.post('/api/rides', { pickupId: 'wuse-ii', destinationId: 'maitama' })).body.error.code, 'DRIVER_BUSY');
  personal = await change(driver, personal, 'confirm');
  assert.equal((await driver.post(`/api/rides/${work.id}/claim`, { expectedVersion: work.version })).body.error.code, 'CUSTOMER_BUSY');
  await change(driver, personal, 'cancel');
  await driver.online();
  const claimed = await driver.post(`/api/rides/${work.id}/claim`, { expectedVersion: work.version }); assert.equal(claimed.status, 200);
  assert.equal((await driver.post('/api/rides', { pickupId: 'wuse-ii', destinationId: 'maitama' })).body.error.code, 'DRIVER_BUSY');
});

test('simultaneous personal request and going online have a single winner, including after request expiry', async (t) => {
  const h = await harness(t), { driver } = await participants(h, 1, { online: false });
  const outcomes = await Promise.all([driver.post('/api/rides', { pickupId: 'wuse-ii', destinationId: 'maitama' }),
    driver.availability('/api/availability/online', { mode: 'sample', areaId: 'wuse-ii' })]);
  assert.equal(outcomes.filter((r) => r.status < 300).length, 1);
  assert.equal(outcomes.filter((r) => r.status === 409).length, 1);
  h.advance(5 * 60_000);
  assert.equal((await driver.availability('/api/availability/online', { mode: 'sample', areaId: 'wuse-ii' })).status, 200);
});

test('schema nine gains capabilities without changing any existing records, review evidence or active session', async (t) => {
  const h = await harness(t, { persistent: true }), { customer, driver, admin } = await participants(h);
  const pending = h.client(); await pending.register('legacy-pending', 'driver');
  const ride = await agree(customer, driver); await change(customer, ride, 'confirm');
  const tables = h.db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT IN ('account_capabilities','account_commands','device_sessions','device_refresh_tokens') ORDER BY name").all().map((row) => row.name);
  const snapshot = new Map(tables.map((name) => [name, h.db.prepare(`SELECT * FROM ${name}`).all()]));
  h.db.exec('DROP TABLE device_refresh_tokens; DROP TABLE device_sessions; DROP TABLE account_commands; DROP TABLE account_capabilities; PRAGMA user_version=9;');
  await h.restart();
  for (const name of tables) assert.deepEqual(h.db.prepare(`SELECT * FROM ${name}`).all(), snapshot.get(name), name);
  assert.equal(h.db.prepare('PRAGMA user_version').get().user_version, SCHEMA_VERSION);
  for (const person of [customer, driver, pending, admin]) await person.send('/api/session');
  assert.deepEqual(driver.user.capabilities, ['customer', 'driver']); assert.equal(driver.user.driver.eligibility.eligible, true);
  assert.deepEqual(pending.user.capabilities, ['customer', 'driver']); assert.equal(pending.user.driver.eligibility.eligible, false);
  assert.deepEqual(customer.user.capabilities, ['customer']); assert.deepEqual(admin.user.capabilities, []);
  assert.equal((await customer.send(`/api/rides/${ride.id}`)).body.ride.status, 'booked');
  await h.restart();
  assert.equal(h.db.prepare('SELECT count(*) AS n FROM account_capabilities').get().n, 5);
  assert.deepEqual(h.db.prepare('PRAGMA foreign_key_check').all(), []);
});
