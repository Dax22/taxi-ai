import { includeExpectedStaffOwners, removeEatsFixtureTables } from './migration-fixtures.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { harness, participants, requestRide, TEST_NOW } from './helpers.mjs';
import { DETAILS } from './driver-fixtures.mjs';
import { SCHEMA_VERSION } from '../src/infrastructure/database.mjs';

const selected = { make: 'Honda', model: 'Civic', year: 2019, colour: 'Blue', plate: 'TEST-CAR' };
const enrollment = '/api/account/driver-profile';

test('initial car selections survive restart, retain retry identity and are consumed only by a successful details save', async (t) => {
  const h = await harness(t, { persistent: true }), customer = h.client(); await customer.register('car-selection');
  const key = randomUUID();
  h.db.exec("CREATE TRIGGER fail_enrollment BEFORE INSERT ON account_commands BEGIN SELECT RAISE(ABORT, 'fixture failure'); END;");
  assert.equal((await customer.post(enrollment, { vehicle: selected }, key)).status, 500);
  for (const table of ['drivers', 'driver_applications', 'driver_vehicle_selections']) {
    assert.equal(h.db.prepare(`SELECT count(*) AS n FROM ${table}`).get().n, 0, table);
  }
  h.db.exec('DROP TRIGGER fail_enrollment');
  const result = await customer.post(enrollment, { vehicle: selected }, key);
  assert.equal(result.status, 200, JSON.stringify(result.body));
  assert.equal(result.body.user.driver.eligibility.eligible, false);
  assert.deepEqual(result.body.user.driver.vehicle, { model: 'Honda Civic', plate: selected.plate });
  assert.equal((await customer.post(enrollment, { vehicle: selected }, key)).body.replayed, true);
  for (const change of [{ colour: 'Red' }, { year: 2020 }, { make: 'Toyota' }]) {
    assert.equal((await customer.post(enrollment, { vehicle: { ...selected, ...change } }, key)).body.error.code, 'KEY_REUSED');
  }
  await h.restart();
  let app = (await customer.send('/api/driver/application')).body.application;
  assert.deepEqual(app.vehicle, selected); assert.equal(app.details, null); assert.equal(app.version, 0);
  assert.equal((await customer.post('/api/driver/application/submit', { expectedVersion: 0 })).body.error.code, 'APPLICATION_INCOMPLETE');
  assert.equal((await customer.availability('/api/availability/online', { mode: 'sample', areaId: 'wuse-ii' })).status, 403);
  const other = h.client(); await other.register('other-car-owner', 'driver');
  assert.notDeepEqual((await other.send('/api/driver/application')).body.application.vehicle, selected);
  assert.equal((await other.send(`/api/admin/drivers/${customer.user.id}`)).status, 403);
  const details = { ...DETAILS, vehicle: { ...selected, colour: 'Red' } }, saveKey = randomUUID();
  h.db.exec("CREATE TRIGGER fail_selection_save BEFORE INSERT ON driver_application_commands BEGIN SELECT RAISE(ABORT, 'fixture failure'); END;");
  assert.equal((await customer.post('/api/driver/application/save', { expectedVersion: 0, details }, saveKey)).status, 500);
  app = (await customer.send('/api/driver/application')).body.application;
  assert.deepEqual(app.vehicle, selected); assert.equal(app.details, null); assert.equal(app.version, 0);
  assert.equal(h.db.prepare('SELECT count(*) AS n FROM driver_vehicle_selections').get().n, 1);
  h.db.exec('DROP TRIGGER fail_selection_save');
  const saved = await customer.post('/api/driver/application/save', { expectedVersion: 0, details }, saveKey);
  assert.equal(saved.status, 200, JSON.stringify(saved.body)); assert.deepEqual(saved.body.application.vehicle, details.vehicle);
  assert.equal(h.db.prepare('SELECT count(*) AS n FROM driver_vehicle_selections').get().n, 0);
  await h.restart();
  app = (await customer.send('/api/driver/application')).body.application;
  assert.deepEqual(app.vehicle, details.vehicle); assert.deepEqual(app.details, details); assert.equal(app.eligibility.eligible, false);
});

test('initial selection requires complete structured fields, bounded model years and a valid plate without granting approval', async (t) => {
  const h = await harness(t), customer = h.client(); await customer.register('car-validation');
  const currentYear = new Date(TEST_NOW).getUTCFullYear();
  for (const change of [{ year: 1999 }, { year: currentYear + 1 }, { year: '2020' }, { year: 2020.5 },
    { make: '' }, { model: '' }, { colour: '' }, { plate: '<script>' }, { approved: true }, { assetUrl: 'https://invalid.test/car.png' }]) {
    assert.equal((await customer.post(enrollment, { vehicle: { ...selected, ...change } })).status, 400, JSON.stringify(change));
  }
  for (const omitted of ['make', 'year', 'colour', 'plate']) {
    const partial = { ...selected }; delete partial[omitted];
    assert.equal((await customer.post(enrollment, { vehicle: partial })).status, 400, omitted);
  }
  assert.equal(h.db.prepare('SELECT count(*) AS n FROM drivers').get().n, 0);
  const first = await customer.post(enrollment, { vehicle: { ...selected, year: 2000, plate: ' test-lower ' } });
  assert.equal(first.status, 200); assert.equal(first.body.user.driver.vehicle.plate, 'TEST-LOWER');
  const another = h.client(); await another.register('current-car');
  assert.equal((await another.post(enrollment, { vehicle: { ...selected, year: currentYear } })).status, 200);
});

test('schema eleven gains empty vehicle selections while preserving every existing record and approval', async (t) => {
  const h = await harness(t, { persistent: true }), { customer, driver } = await participants(h);
  const ride = await requestRide(customer);
  const tables = h.db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name <> 'driver_vehicle_selections' ORDER BY name").all().map((row) => row.name).filter((name) => !['account_notifications','push_registrations','push_jobs','dispatch_commands','dispatch_offers','dispatch_journeys','account_revisions','worker_leases'].includes(name));
  const before = new Map(tables.map((name) => [name, h.db.prepare(`SELECT * FROM ${name}`).all()]));
  includeExpectedStaffOwners(h.db, before);
  removeEatsFixtureTables(h.db); h.db.exec('DROP TABLE vehicle_photo_checks; DROP TABLE push_jobs; DROP TABLE push_registrations; DROP TABLE account_notifications; ALTER TABLE driver_availability DROP COLUMN native_session_id; DROP TABLE delivery_orders; ALTER TABLE rides DROP COLUMN vehicle_category; DROP TABLE driver_vehicle_selections; PRAGMA user_version=11;');
  await h.restart();
  for (const name of tables) assert.deepEqual(h.db.prepare(`SELECT * FROM ${name}`).all(), before.get(name), name);
  assert.equal(h.db.prepare('PRAGMA user_version').get().user_version, SCHEMA_VERSION);
  assert.equal(h.db.prepare('SELECT count(*) AS n FROM driver_vehicle_selections').get().n, 0);
  assert.equal((await driver.send('/api/session')).body.user.driver.eligibility.eligible, true);
  assert.equal((await customer.send(`/api/rides/${ride.id}`)).body.ride.id, ride.id);
  assert.deepEqual(h.db.prepare('PRAGMA foreign_key_check').all(), []);
});
