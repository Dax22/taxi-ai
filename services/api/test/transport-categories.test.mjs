import { removeEatsFixtureTables } from './migration-fixtures.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { harness, participants } from './helpers.mjs';
import { DETAILS, submitApplication, approveApplication, fixtureApi } from './driver-fixtures.mjs';
import { categoryFare, TRANSPORT_CATEGORIES } from '../../../packages/shared/src/transport-categories.mjs';

const parcel = { description: 'Test parcel, one small box', weightKg: 2, recipientName: 'Fictional recipient', pickupInstructions: 'Front desk', dropoffInstructions: 'Reception' };
const sample = { pickupId: 'wuse-ii', destinationId: 'maitama' };
const ok = (response, status = 200) => { assert.equal(response.status, status, JSON.stringify(response.body)); return response.body; };
async function courier(h, admin, category, payloadKg = null) {
  const driver = h.client(); await driver.register(`category-${category}`, 'driver');
  const details = { ...DETAILS, vehicle: { ...DETAILS.vehicle, category, payloadKg } };
  await submitApplication(fixtureApi(driver), '2099-12-31', details);
  await approveApplication(fixtureApi(admin), driver.user.id); await driver.online();
  return driver;
}
async function action(actor, ride, name, extra = {}, key) {
  if (['depart', 'arrive', 'start'].includes(name)) await actor.shareTripLocation(ride.id);
  return ok(await actor.post(`/api/rides/${ride.id}/${name}`, { expectedVersion: ride.version, ...extra }, key)).ride;
}
async function agreed(customer, driver, ride) {
  ride = await action(driver, ride, 'claim');
  ride = await action(customer, ride, 'offers', { amountKobo: ride.suggestedFareKobo + 1 });
  ride = await action(driver, ride, 'accept', { offerId: ride.negotiation.currentOffer.id });
  return action(customer, ride, 'confirm');
}
async function collected(customer, driver, ride) {
  const pickupPin = ride.trip.pickupPin;
  ride = await action(driver, ride, 'depart'); ride = await action(driver, ride, 'arrive');
  ride = await action(driver, ride, 'start', { pickupPin });
  assert.equal(ride.trip.pickupPin, undefined);
  return ok(await customer.send(`/api/rides/${ride.id}`)).ride;
}

test('all five categories match approved vehicles and finish their distinct passenger or delivery lifecycle', async (t) => {
  const h = await harness(t), { customer, admin } = await participants(h, 0), drivers = {};
  for (const [category, policy] of Object.entries(TRANSPORT_CATEGORIES)) drivers[category] = await courier(h, admin, category, policy.maxLoadKg);
  for (const [category, policy] of Object.entries(TRANSPORT_CATEGORIES)) {
    const delivery = policy.service === 'delivery';
    const key = randomUUID(), payload = { ...sample, vehicleCategory: category, ...(delivery ? { delivery: parcel } : {}) };
    let ride = ok(await customer.post('/api/rides', payload, key), 201).ride;
    assert.equal(ride.vehicleCategory, category); assert.equal(ride.service, policy.service);
    assert.equal(ride.suggestedFareKobo, categoryFare(450000, category));
    assert.equal(ok(await customer.post('/api/rides', payload, key)).ride.id, ride.id);
    for (const [other, driver] of Object.entries(drivers)) {
      await driver.online();
      const available = ok(await driver.send('/api/rides')).available;
      assert.equal(available.some((r) => r.id === ride.id), other === category);
      assert.equal(JSON.stringify(available).includes(parcel.recipientName), false);
      if (other !== category) assert.equal((await driver.post(`/api/rides/${ride.id}/claim`, { expectedVersion: ride.version })).body.error.code, 'VEHICLE_MISMATCH');
    }
    const driver = drivers[category];
    ride = await agreed(customer, driver, ride);
    assert.equal(ride.delivery?.dropoffPin, undefined, 'handover code is not exposed before collection');
    ride = await collected(customer, driver, ride);
    if (delivery) assert.match(ride.delivery.dropoffPin, /^\d{6}$/);
    const complete = await action(driver, ride, 'complete', delivery ? { deliveryPin: ride.delivery.dropoffPin } : {});
    assert.equal(complete.status, 'completed'); assert.equal(complete.vehicleCategory, category);
    assert.equal(complete.delivery?.dropoffPin, undefined);
    if (delivery) assert.equal(complete.delivery.verifiedAt, h.now);
    const payment = h.db.prepare('SELECT amount_kobo,status FROM payments WHERE ride_id=?').get(ride.id);
    assert.equal(payment.amount_kobo, ride.trip.fareKobo); assert.equal(payment.status, 'unpaid');
    assert.equal(ok(await customer.send('/api/rides/history')).rides.find((r) => r.id === ride.id).vehicleCategory, category);
  }
});

test('delivery validation, category rechecks and approved payload limits cannot be bypassed', async (t) => {
  const h = await harness(t), { customer, admin } = await participants(h, 0), driver = await courier(h, admin, 'van', 5);
  for (const data of [
    { ...sample, vehicleCategory: 'unknown' }, { ...sample, vehicleCategory: null },
    { ...sample, vehicleCategory: 'van' }, { ...sample, vehicleCategory: 'suv', delivery: parcel },
    { ...sample, vehicleCategory: 'motorcycle', delivery: { ...parcel, weightKg: 21 } },
    { ...sample, vehicleCategory: 'truck', delivery: { ...parcel, recipientName: '' } },
    { ...sample, vehicleCategory: 'van', delivery: { ...parcel, dropoffPin: '123456' } },
  ]) assert.equal((await customer.post('/api/rides', data)).status, 400, JSON.stringify(data));
  const ride = ok(await customer.post('/api/rides', { ...sample, vehicleCategory: 'van', delivery: { ...parcel, weightKg: 6 } }), 201).ride;
  assert.deepEqual(ok(await driver.send('/api/rides')).available, []);
  assert.equal((await driver.post(`/api/rides/${ride.id}/claim`, { expectedVersion: ride.version })).body.error.code, 'VEHICLE_MISMATCH');
  await action(customer, ride, 'cancel');
  let small = ok(await customer.post('/api/rides', { ...sample, vehicleCategory: 'van', delivery: parcel }), 201).ride;
  small = await action(driver, small, 'claim');
  small = await action(customer, small, 'offers', { amountKobo: small.suggestedFareKobo });
  small = await action(driver, small, 'accept', { offerId: small.negotiation.currentOffer.id });
  // Simulate independently changed reviewed data to exercise checks after claim.
  const original = h.db.prepare('SELECT details_json FROM driver_applications WHERE driver_id=?').get(driver.user.id).details_json;
  const details = JSON.parse(original); details.vehicle.payloadKg = 1;
  h.db.prepare('UPDATE driver_applications SET details_json=? WHERE driver_id=?').run(JSON.stringify(details), driver.user.id);
  assert.equal((await customer.post(`/api/rides/${small.id}/confirm`, { expectedVersion: small.version })).body.error.code, 'VEHICLE_MISMATCH');
  h.db.prepare('UPDATE driver_applications SET details_json=? WHERE driver_id=?').run(original, driver.user.id);
  small = await action(customer, small, 'confirm');
  const pin = small.trip.pickupPin;
  small = await action(driver, small, 'depart'); small = await action(driver, small, 'arrive');
  h.db.prepare('UPDATE driver_applications SET details_json=? WHERE driver_id=?').run(JSON.stringify(details), driver.user.id);
  assert.equal((await driver.post(`/api/rides/${small.id}/start`, { expectedVersion: small.version, pickupPin: pin })).body.error.code, 'VEHICLE_MISMATCH');
});

test('handover codes are participant-scoped, retry-safe, rate-limited, persistent and atomic with completion/payment', async (t) => {
  const h = await harness(t, { persistent: true }), { customer, admin } = await participants(h, 0), driver = await courier(h, admin, 'truck', 100);
  const outsider = h.client(); await outsider.register('parcel-outsider');
  let ride = ok(await customer.post('/api/rides', { ...sample, vehicleCategory: 'truck', delivery: parcel }), 201).ride;
  ride = await collected(customer, driver, await agreed(customer, driver, ride));
  const pin = ride.delivery.dropoffPin;
  assert.equal(ok(await driver.send(`/api/rides/${ride.id}`)).ride.delivery.dropoffPin, undefined);
  assert.equal((await outsider.send(`/api/rides/${ride.id}`)).status, 404);
  assert.equal((await customer.post(`/api/rides/${ride.id}/complete`, { expectedVersion: ride.version, deliveryPin: pin })).status, 403);
  const payload = { expectedVersion: ride.version, deliveryPin: pin === '000000' ? '111111' : '000000' }, wrongKey = randomUUID();
  for (let i = 0; i < 5; i++) {
    const failed = await driver.post(`/api/rides/${ride.id}/complete`, payload, i ? randomUUID() : wrongKey);
    assert.equal(failed.body.error.code, 'INVALID_DELIVERY_PIN');
  }
  assert.equal((await driver.post(`/api/rides/${ride.id}/complete`, payload, wrongKey)).body.error.code, 'INVALID_DELIVERY_PIN');
  assert.equal(h.db.prepare('SELECT pin_failures FROM delivery_orders WHERE ride_id=?').get(ride.id).pin_failures, 5);
  assert.equal((await driver.post(`/api/rides/${ride.id}/complete`, { expectedVersion: ride.version, deliveryPin: pin })).body.error.code, 'DELIVERY_PIN_LOCKED');
  assert.equal(h.db.prepare('SELECT count(*) AS n FROM payments WHERE ride_id=?').get(ride.id).n, 0);
  await h.restart();
  assert.equal(ok(await customer.send(`/api/rides/${ride.id}`)).ride.delivery.dropoffPin, pin);
  h.advance(300000);
  const key = randomUUID(), data = { expectedVersion: ride.version, deliveryPin: pin };
  h.db.exec("CREATE TRIGGER fail_delivery_completion BEFORE INSERT ON payments BEGIN SELECT RAISE(ABORT,'test rollback'); END;");
  assert.equal((await driver.post(`/api/rides/${ride.id}/complete`, data, key)).status, 500);
  assert.equal(ok(await customer.send(`/api/rides/${ride.id}`)).ride.status, 'in_progress');
  assert.equal(h.db.prepare('SELECT dropoff_pin FROM delivery_orders WHERE ride_id=?').get(ride.id).dropoff_pin, pin);
  h.db.exec('DROP TRIGGER fail_delivery_completion');
  ride = ok(await driver.post(`/api/rides/${ride.id}/complete`, data, key)).ride;
  assert.equal(ride.status, 'completed'); assert.equal(ride.delivery.verifiedAt, h.now);
  assert.equal(ok(await driver.post(`/api/rides/${ride.id}/complete`, data, key)).replayed, true);
  assert.equal(h.db.prepare('SELECT count(*) AS n FROM payments WHERE ride_id=?').get(ride.id).n, 1);
  assert.equal(h.db.prepare('SELECT dropoff_pin FROM delivery_orders WHERE ride_id=?').get(ride.id).dropoff_pin, null);
});

test('category-bound delivery quotes use direct distance and cannot reuse passenger pricing', async (t) => {
  let routed = 0;
  const pickup = { lat: 9.08, lng: 7.4, name: 'Test pickup' }, destination = { lat: 9.1, lng: 7.45, name: 'Test drop-off' };
  const h = await harness(t, { mapProvider: { describe: () => ({ enabled: true }), route: async () => {
    routed++; return { distanceMeters: 7000, durationSeconds: 1200, coordinates: [[7.4, 9.08], [7.45, 9.1]] };
  } } });
  const customer = h.client(); await customer.register('category-quotes');
  const base = ok(await customer.post('/api/locations/quotes', { pickup, destination }), 201).quote;
  assert.equal(routed, 1);
  assert.equal((await customer.post('/api/rides', { quoteId: base.id, vehicleCategory: 'suv' })).body.error.code, 'QUOTE_CATEGORY_MISMATCH');
  const key = randomUUID();
  const suv = ok(await customer.post('/api/locations/quotes', { pickup, destination, vehicleCategory: 'suv' }, key), 201).quote;
  assert.equal(suv.route.suggestedFareKobo, categoryFare(base.route.suggestedFareKobo, 'suv')); assert.equal(routed, 2);
  assert.equal((await customer.post('/api/locations/quotes', { pickup, destination, vehicleCategory: 'truck' }, key)).body.error.code, 'KEY_REUSED');
  for (const category of ['van', 'truck', 'motorcycle']) {
    const quote = ok(await customer.post('/api/locations/quotes', { pickup, destination, vehicleCategory: category }), 201).quote;
    assert.equal(quote.route.source, 'direct'); assert.equal(quote.route.distanceKind, 'straight_line'); assert.equal(quote.route.durationSeconds, null);
    assert.equal(routed, 2, 'car routing is not presented as courier navigation');
    let ride = ok(await customer.post('/api/rides', { quoteId: quote.id, vehicleCategory: category, delivery: parcel }), 201).ride;
    assert.equal(ride.route.vehicleCategory, category); assert.equal(ride.suggestedFareKobo, quote.route.suggestedFareKobo);
    ride = await action(customer, ride, 'cancel'); assert.equal(ride.delivery.dropoffPin, undefined);
  }
});

test('cancelling a confirmed delivery erases its unused code and never creates a payment', async (t) => {
  const h = await harness(t), { customer, admin } = await participants(h, 0), driver = await courier(h, admin, 'motorcycle', 10);
  let ride = ok(await customer.post('/api/rides', { ...sample, vehicleCategory: 'motorcycle', delivery: parcel }), 201).ride;
  ride = await agreed(customer, driver, ride);
  assert.match(h.db.prepare('SELECT dropoff_pin FROM delivery_orders WHERE ride_id=?').get(ride.id).dropoff_pin, /^\d{6}$/);
  ride = await action(customer, ride, 'cancel'); assert.equal(ride.delivery.verifiedAt, null);
  assert.equal(h.db.prepare('SELECT dropoff_pin FROM delivery_orders WHERE ride_id=?').get(ride.id).dropoff_pin, null);
  assert.equal(h.db.prepare('SELECT count(*) AS n FROM payments WHERE ride_id=?').get(ride.id).n, 0);
});

test('schema fifteen upgrades preserve accounts, approvals, active PINs and saved retry outcomes', async (t) => {
  const h = await harness(t, { persistent: true }), { customer, driver } = await participants(h);
  let ride = ok(await customer.post('/api/rides', sample), 201).ride;
  ride = await agreed(customer, driver, ride);
  const key = randomUUID(), pickupPin = ride.trip.pickupPin;
  ride = await action(driver, ride, 'depart'); ride = await action(driver, ride, 'arrive');
  assert.equal((await driver.post(`/api/rides/${ride.id}/start`, { expectedVersion: ride.version, pickupPin: pickupPin === '000000' ? '111111' : '000000' }, key)).body.error.code, 'INVALID_PICKUP_PIN');
  const commands = h.db.prepare('SELECT * FROM idempotency ORDER BY actor_id,key').all();
  const trips = h.db.prepare('SELECT * FROM ride_trips').all();
  const users = h.db.prepare('SELECT * FROM users ORDER BY id').all();
  const applications = h.db.prepare('SELECT * FROM driver_applications').all();
  removeEatsFixtureTables(h.db); h.db.exec('DROP TABLE vehicle_photo_checks; DROP TABLE push_jobs; DROP TABLE push_registrations; DROP TABLE account_notifications; ALTER TABLE driver_availability DROP COLUMN native_session_id; DROP TABLE delivery_orders; ALTER TABLE rides DROP COLUMN vehicle_category; PRAGMA user_version=15;');
  await h.restart();
  assert.deepEqual(h.db.prepare('SELECT * FROM idempotency ORDER BY actor_id,key').all(), commands);
  assert.deepEqual(h.db.prepare('SELECT * FROM ride_trips').all(), trips);
  assert.deepEqual(h.db.prepare('SELECT * FROM users ORDER BY id').all(), users);
  assert.deepEqual(h.db.prepare('SELECT * FROM driver_applications').all(), applications);
  assert.equal(h.db.prepare('SELECT vehicle_category FROM rides WHERE id=?').get(ride.id).vehicle_category, 'standard');
  assert.equal(h.db.prepare('SELECT count(*) AS n FROM delivery_orders').get().n, 0);
  assert.equal(ok(await customer.send(`/api/rides/${ride.id}`)).ride.vehicleCategory, 'standard');
});

test('vehicle categories and load capacity require valid application details and manual approval', async (t) => {
  const h = await harness(t), driver = h.client(); await driver.register('capacity-applicant', 'driver');
  for (const vehicle of [
    { ...DETAILS.vehicle, category: 'other' }, { ...DETAILS.vehicle, category: null },
    { ...DETAILS.vehicle, category: 'truck' }, { ...DETAILS.vehicle, category: 'motorcycle', payloadKg: 21 },
    { ...DETAILS.vehicle, category: 'suv', payloadKg: 100 },
  ]) assert.equal((await driver.post('/api/driver/application/save', { expectedVersion: 0, details: { ...DETAILS, vehicle } })).status, 400);
  const application = ok(await driver.post('/api/driver/application/save', { expectedVersion: 0,
    details: { ...DETAILS, vehicle: { ...DETAILS.vehicle, category: 'van', payloadKg: 50 } } })).application;
  assert.equal(application.vehicle.category, 'van'); assert.equal(application.vehicle.payloadKg, 50);
  assert.equal(application.eligibility.eligible, false);
  assert.equal((await driver.availability('/api/availability/online', { mode: 'sample', areaId: 'wuse-ii' })).status, 403);
});
