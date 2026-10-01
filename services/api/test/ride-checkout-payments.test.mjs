import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { harness, participants, requestRide, claimRide } from './helpers.mjs';
import { createApplication } from '../src/application.mjs';
import { asAsyncDatabase } from '../src/infrastructure/async-database.mjs';
import { createAudit } from '../src/infrastructure/audit.mjs';
import { tokens } from '../src/infrastructure/tokens.mjs';
import { createRidesService } from '../src/modules/rides/service.mjs';
import { createRidesRepository } from '../src/modules/rides/repository.mjs';
import { createDeliveriesService } from '../src/modules/deliveries/service.mjs';
import { createDeliveriesRepository } from '../src/modules/deliveries/repository.mjs';
import { createGuestRidesRepository } from '../src/modules/guest-rides/repository.mjs';
import { check } from '../src/shared/errors.mjs';

const FARE = 470001;
const paidCheckout = () => ({ enabled: true, requirePaid() {}, close() {} });
async function step(actor, ride, action, extra = {}, key) {
  if (['depart', 'arrive', 'start'].includes(action)) await actor.shareTripLocation(ride.id);
  const result = await actor.post(`/api/rides/${ride.id}/${action}`, { expectedVersion: ride.version, ...extra }, key);
  assert.equal(result.status, 200, JSON.stringify(result.body));
  return result.body.ride;
}
async function fixture(t, { phase = 'arrived', driverCount = 1, paymentMode = 'paystack_test', delivery = false } = {}) {
  const h = await harness(t), actors = await participants(h, driverCount);
  const db = asAsyncDatabase(h.db), app = createApplication({ db, clock: () => h.now });
  const repository = createRidesRepository(db), guestRepository = createGuestRidesRepository(db);
  const service = (checkoutPayments, extra = {}) => createRidesService({
    repository, getAccount: app.accounts.profile, unitOfWork: run => db.transaction(run),
    deliveries: createDeliveriesService({ repository: createDeliveriesRepository(db), tokens }),
    passengerForRide: guestRepository.passenger, savePassenger: guestRepository.savePassenger,
    tokens, audit: createAudit(db), clock: () => h.now, checkoutPayments,
    requireTripLocation: async (driverId, rideId) => check(await app.locations.freshPositionFor(driverId, rideId, h.now),
      'TRIP_LOCATION_REQUIRED', 'A fresh driver location is required.'), ...extra,
  });
  let ride, pickupPin;
  if (delivery) {
    const response = await actors.customer.post('/api/rides', { pickupId: 'wuse-ii', destinationId: 'maitama',
      vehicleCategory: 'standard', delivery: { description: 'Sealed checkout test parcel', weightKg: 2, recipientName: 'Checkout recipient' } });
    assert.equal(response.status, 201, JSON.stringify(response.body)); ride = response.body.ride;
  } else ride = await requestRide(actors.customer);
  if (phase !== 'requested') {
    ride = await claimRide(actors.driver, ride);
    ride = await step(actors.driver, ride, 'offers', { amountKobo: FARE });
    ride = await step(actors.customer, ride, 'accept', { offerId: ride.negotiation.currentOffer.id });
    if (phase !== 'agreed') {
      ride = (await service(paymentMode === 'paystack_test' ? paidCheckout() : undefined)
        .mutate(command(actors.customer, ride, 'confirm'))).ride;
      assert.equal((await repository.findTrip(ride.id)).paymentMode, paymentMode);
      pickupPin = ride.trip.pickupPin;
      if (phase === 'arrived') {
        ride = await step(actors.driver, ride, 'depart');
        ride = await step(actors.driver, ride, 'arrive');
      }
    }
  }
  return { h, db, app, repository, service, ...actors, ride, pickupPin, paymentMode };
}
const command = (actor, ride, action, extra = {}, key = randomUUID()) => ({
  userId: actor.user.id, id: ride.id, action, key, data: { expectedVersion: ride.version, ...extra },
});
const expectedContext = (f, status = f.ride.status, eligible = f.paymentMode === 'paystack_test') => ({
  kind: 'ride', targetId: f.ride.id, customerId: f.customer.user.id, driverId: f.driver.user.id,
  amountKobo: FARE, currency: 'NGN', bookedAt: f.ride.trip.bookedAt, status, paymentMode: f.paymentMode, eligible,
});
function state(h, id) {
  return {
    ride: h.db.prepare('SELECT * FROM rides WHERE id=?').get(id),
    trip: h.db.prepare('SELECT * FROM ride_trips WHERE ride_id=?').get(id),
    activity: h.db.prepare('SELECT * FROM ride_activity WHERE ride_id=? ORDER BY id').all(id),
    fares: h.db.prepare('SELECT * FROM fare_events WHERE ride_id=? ORDER BY version').all(id),
    audit: h.db.prepare('SELECT * FROM audit_events WHERE subject_id=? ORDER BY id').all(id),
    commands: h.db.prepare('SELECT * FROM idempotency WHERE ride_id=? ORDER BY key').all(id),
  };
}

test('disabled checkout preserves legacy ride start without invoking payment ports', async t => {
  const f = await fixture(t, { paymentMode: 'simulation' });
  const unexpected = () => assert.fail('A disabled checkout port must never run');
  const rides = f.service({ enabled: false, requirePaid: unexpected, close: unexpected });
  const result = await rides.mutate(command(f.driver, f.ride, 'start', { pickupPin: f.pickupPin }));
  assert.equal(result.ride.status, 'in_progress');
  assert.equal(result.ride.trip.fareKobo, FARE);
  assert.equal(f.h.db.prepare('SELECT count(*) AS n FROM payments').get().n, 0);
});

test('absent checkout preserves cancellation and its existing close callback', async t => {
  const f = await fixture(t, { phase: 'booked', paymentMode: 'simulation' }), closed = [];
  const rides = f.service(undefined, { onRideClosed: (...args) => closed.push(args) });
  const input = command(f.customer, f.ride, 'cancel');
  const result = await rides.mutate(input);
  assert.equal(result.ride.status, 'cancelled');
  assert.equal((await rides.mutate(input)).replayed, true);
  assert.deepEqual(closed, [[f.ride.id, f.h.now]]);
});

test('unpaid checkout blocks before consuming a pickup PIN attempt or committing ride writes', async t => {
  const f = await fixture(t), calls = [];
  let paid = false;
  const rides = f.service({ enabled: true, close() { assert.fail('Starting does not close checkout'); },
    requirePaid(context) { calls.push(context); check(paid, 'PAYMENT_REQUIRED', 'Pay for the confirmed booking first.'); },
  });
  const wrongPin = f.pickupPin === '000000' ? '000001' : '000000';
  const input = command(f.driver, f.ride, 'start', { pickupPin: wrongPin });
  const before = state(f.h, f.ride.id);
  for (let attempt = 0; attempt < 2; attempt++) {
    await assert.rejects(rides.mutate(input), { code: 'PAYMENT_REQUIRED' });
    assert.deepEqual(state(f.h, f.ride.id), before);
    assert.deepEqual(calls.at(-1), expectedContext(f));
  }
  assert.equal(calls.length, 2, 'An unpaid failure does not consume the command key');
  paid = true;
  await assert.rejects(rides.mutate(input), { code: 'INVALID_PICKUP_PIN' });
  assert.equal((await f.repository.findTrip(f.ride.id)).pinFailures, 1);
  assert.equal((await f.repository.find(f.ride.id)).version, f.ride.version);
  await assert.rejects(rides.mutate(input), { code: 'INVALID_PICKUP_PIN' });
  assert.equal(calls.length, 3, 'Replaying a committed PIN rejection does not recheck payment or consume another PIN attempt');
  assert.equal((await f.repository.findTrip(f.ride.id)).pinFailures, 1);
});

for (const delivery of [false, true]) test(`paid ${delivery ? 'courier' : 'ride'} start binds the exact booked fare and concurrent retries invoke its gate once`, async t => {
  const f = await fixture(t, { delivery }), calls = [];
  const rides = f.service({ enabled: true, requirePaid(context) { calls.push(context); }, close() { assert.fail('Unexpected close'); } });
  const fares = state(f.h, f.ride.id).fares;
  await assert.rejects(rides.mutate(command(f.customer, f.ride, 'start', { pickupPin: f.pickupPin })), { code: 'FORBIDDEN' });
  assert.equal(calls.length, 0, 'An unauthorized actor cannot invoke payment checks');
  const input = command(f.driver, f.ride, 'start', { pickupPin: f.pickupPin });
  const results = await Promise.all([rides.mutate(input), rides.mutate(input)]);
  assert.deepEqual(results.map(result => result.replayed).sort(), [false, true]);
  assert.deepEqual(calls, [expectedContext(f)]);
  for (const { ride } of results) {
    assert.equal(ride.status, 'in_progress');
    assert.equal(ride.version, f.ride.version + 1);
    assert.equal(ride.trip.fareKobo, FARE);
    assert.deepEqual(ride.negotiation.agreement, f.ride.negotiation.agreement);
  }
  assert.deepEqual(state(f.h, f.ride.id).fares, fares);
  assert.equal(f.h.db.prepare("SELECT count(*) AS n FROM ride_activity WHERE ride_id=? AND type='in_progress'").get(f.ride.id).n, 1);
  assert.equal(f.h.db.prepare('SELECT count(*) AS n FROM idempotency WHERE actor_id=? AND key=?').get(f.driver.user.id, input.key).n, 1);
});

test('checkout context is participant-only, requires confirmation and follows the immutable booked fare through completion', async t => {
  const f = await fixture(t, { phase: 'requested', driverCount: 2 }), completed = [];
  const rides = f.service(paidCheckout(), { onTripCompleted: data => completed.push(data) });
  const customer = await f.app.accounts.profile(f.customer.user.id);
  const driver = await f.app.accounts.profile(f.driver.user.id);
  const stranger = f.h.client(); await stranger.register('checkout-stranger');
  await assert.rejects(rides.checkoutPaymentContext(customer, f.ride.id), { code: 'PAYMENT_NOT_READY' });
  let ride = await claimRide(f.driver, f.ride);
  await assert.rejects(rides.checkoutPaymentContext(driver, ride.id), { code: 'PAYMENT_NOT_READY' });
  ride = await step(f.driver, ride, 'offers', { amountKobo: FARE });
  ride = await step(f.customer, ride, 'accept', { offerId: ride.negotiation.currentOffer.id });
  await assert.rejects(rides.checkoutPaymentContext(customer, ride.id), { code: 'PAYMENT_NOT_READY' });
  ride = (await rides.mutate(command(f.customer, ride, 'confirm'))).ride;
  f.ride = ride;
  const pickupPin = ride.trip.pickupPin;
  for (const actor of [stranger, f.drivers[1], f.admin]) {
    await assert.rejects(rides.checkoutPaymentContext(await f.app.accounts.profile(actor.user.id), ride.id), { code: 'NOT_FOUND' });
  }
  const assertContext = async (status, eligible = true) => {
    const expected = expectedContext(f, status, eligible);
    assert.deepEqual(await rides.checkoutPaymentContext(customer, ride.id), expected);
    assert.deepEqual(await rides.checkoutPaymentContext(driver, ride.id), expected);
  };
  await assertContext('booked');
  ride = await step(f.driver, ride, 'depart'); await assertContext('on_way');
  ride = await step(f.driver, ride, 'arrive'); await assertContext('arrived');
  ride = (await rides.mutate(command(f.driver, ride, 'start', { pickupPin }))).ride; await assertContext('in_progress');
  ride = (await rides.mutate(command(f.driver, ride, 'complete'))).ride; await assertContext('completed', false);
  assert.deepEqual(completed, [{ rideId: ride.id, customerId: f.customer.user.id, driverId: f.driver.user.id,
    amountKobo: FARE, paymentMode: 'paystack_test', completedAt: f.h.now }]);
});

test('enabling checkout does not charge an existing simulation booking', async t => {
  const f = await fixture(t, { paymentMode: 'simulation' });
  const unexpected = () => assert.fail('A pre-existing simulation booking does not become a checkout booking');
  const rides = f.service({ enabled: true, requirePaid: unexpected, close: unexpected });
  assert.deepEqual(await rides.checkoutPaymentContext(await f.app.accounts.profile(f.customer.user.id), f.ride.id), expectedContext(f));
  const result = await rides.mutate(command(f.driver, f.ride, 'start', { pickupPin: f.pickupPin }));
  assert.equal(result.ride.status, 'in_progress');
  assert.equal((await f.repository.findTrip(f.ride.id)).paymentMode, 'simulation');
});

test('disabling new checkout bookings cannot bypass payment on an existing checkout booking', async t => {
  const f = await fixture(t), calls = [];
  const rides = f.service({ enabled: false, requirePaid(context) {
    calls.push(context); check(false, 'PAYMENT_REQUIRED', 'The booked checkout payment is still required.');
  } });
  const before = state(f.h, f.ride.id), input = command(f.driver, f.ride, 'start', { pickupPin: f.pickupPin });
  await assert.rejects(rides.mutate(input), { code: 'PAYMENT_REQUIRED' });
  assert.deepEqual(calls, [expectedContext(f)]);
  assert.deepEqual(state(f.h, f.ride.id), before);
  await assert.rejects(f.service().mutate(input), { code: 'PAYMENT_NOT_READY' });
  assert.deepEqual(state(f.h, f.ride.id), before);
});

test('existing checkout cancellation remains atomic after disabling new checkout bookings and a retry closes only once', async t => {
  const f = await fixture(t, { phase: 'booked' }), calls = [];
  f.h.db.exec('CREATE TABLE checkout_test_closures (target_id TEXT PRIMARY KEY, closed_at INTEGER NOT NULL)');
  let failClose = true;
  const rides = f.service({ enabled: false,
    requirePaid() { assert.fail('Cancellation must not require payment'); },
    async close(context) {
      calls.push(context);
      assert.equal((await f.repository.findTrip(f.ride.id)).status, 'cancelled', 'Closure participates in the cancellation transaction');
      await f.db.prepare('INSERT INTO checkout_test_closures(target_id,closed_at) VALUES (?,?)').run(context.targetId, context.closedAt);
      if (failClose) throw new Error('fixture checkout close failure');
    },
  });
  f.h.advance(1234);
  const input = command(f.customer, f.ride, 'cancel'), before = state(f.h, f.ride.id);
  await assert.rejects(rides.mutate(input), /fixture checkout close failure/);
  assert.deepEqual(state(f.h, f.ride.id), before);
  assert.equal(f.h.db.prepare('SELECT count(*) AS n FROM checkout_test_closures').get().n, 0);
  failClose = false;
  f.h.db.exec("CREATE TRIGGER fail_checkout_cancel_command BEFORE INSERT ON idempotency BEGIN SELECT RAISE(ABORT, 'fixture cancellation command failure'); END");
  await assert.rejects(rides.mutate(input), /fixture cancellation command failure/);
  assert.deepEqual(state(f.h, f.ride.id), before);
  assert.equal(f.h.db.prepare('SELECT count(*) AS n FROM checkout_test_closures').get().n, 0);
  f.h.db.exec('DROP TRIGGER fail_checkout_cancel_command');
  const result = await rides.mutate(input);
  assert.equal(result.ride.status, 'cancelled');
  assert.equal((await rides.mutate(input)).replayed, true);
  assert.equal(calls.length, 3, 'Only the three unreplayed transaction attempts invoke close');
  for (const context of calls) assert.deepEqual(context, { ...expectedContext(f, 'cancelled', false), closedAt: f.h.now });
  assert.equal(f.h.db.prepare('SELECT count(*) AS n FROM checkout_test_closures').get().n, 1);
  assert.equal(f.h.db.prepare("SELECT count(*) AS n FROM ride_activity WHERE ride_id=? AND type='cancelled'").get(f.ride.id).n, 1);
  assert.equal((await f.repository.findTrip(f.ride.id)).fareKobo, FARE);
  assert.deepEqual(await rides.checkoutPaymentContext(await f.app.accounts.profile(f.customer.user.id), f.ride.id), expectedContext(f, 'cancelled', false));
});
