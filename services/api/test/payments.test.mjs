import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { harness, participants, requestRide, claimRide } from './helpers.mjs';
import { createApplication } from '../src/application.mjs';
import { createPaymentsService } from '../src/modules/payments/service.mjs';
import { createPaymentsRepository } from '../src/modules/payments/repository.mjs';
import { simulatePayment } from '../src/infrastructure/simulated-payment-provider.mjs';
import { transaction } from '../src/infrastructure/database.mjs';
import { tokens } from '../src/infrastructure/tokens.mjs';
import { createAudit } from '../src/infrastructure/audit.mjs';
import { saveSnapshot } from '../src/infrastructure/database-snapshot.mjs';

const path = (ride) => `/api/payments/rides/${ride.id ?? ride.rideId}`;
async function step(actor, ride, action, extra = {}, key) {
  const result = await actor.post(`/api/rides/${ride.id}/${action}`, { expectedVersion: ride.version, ...extra }, key);
  assert.equal(result.status, 200, JSON.stringify(result.body)); return result.body.ride;
}
async function startedTrip(customer, driver, amountKobo = 470001) {
  let ride = await claimRide(driver, await requestRide(customer));
  ride = await step(driver, ride, 'offers', { amountKobo });
  ride = await step(customer, ride, 'accept', { offerId: ride.negotiation.currentOffer.id });
  ride = await step(customer, ride, 'confirm'); const pickupPin = ride.trip.pickupPin;
  ride = await step(driver, ride, 'depart'); ride = await step(driver, ride, 'arrive');
  return step(driver, ride, 'start', { pickupPin });
}
async function complete(customer, driver, amountKobo) { return step(driver, await startedTrip(customer, driver, amountKobo), 'complete'); }
async function payment(customer, ride) {
  const result = await customer.send(path(ride)); assert.equal(result.status, 200, JSON.stringify(result.body)); return result.body.payment;
}
async function start(customer, current, key) {
  const result = await customer.post(path(current) + '/start', { expectedVersion: current.version }, key);
  assert.equal(result.status, 200, JSON.stringify(result.body)); return result.body.payment;
}
async function resolve(customer, current, outcome = 'success', key) {
  const result = await customer.post(path(current) + `/attempts/${current.attempt.id}/simulate`, { expectedVersion: current.version, outcome }, key);
  assert.equal(result.status, 200, JSON.stringify(result.body)); return result.body.payment;
}

test('completed trips use the exact agreed fare; pending, failed, retried and paid records and receipts survive restart', async (t) => {
  const h = await harness(t, { persistent: true }), { customer, driver } = await participants(h);
  let ride = await startedTrip(customer, driver);
  assert.equal(await payment(customer, ride), null);
  assert.equal((await customer.post(path(ride) + '/start', { expectedVersion: 0 })).status, 404);
  const agreement = ride.negotiation.agreement;
  ride = await step(driver, ride, 'complete');
  let current = await payment(customer, ride);
  assert.equal(current.status, 'unpaid'); assert.equal(current.amountKobo, 470001); assert.equal(current.currency, 'NGN');
  assert.equal(current.mode, 'simulation'); assert.equal(current.attempt, null);
  assert.equal((await customer.send(path(ride) + '/receipt')).status, 409);
  current = await start(customer, current); const failedReference = current.attempt.reference;
  assert.equal(current.status, 'pending');
  assert.equal((await customer.send(path(ride) + '/receipt')).status, 409);
  await h.restart(); assert.deepEqual(await payment(customer, ride), current);
  current = await resolve(customer, current, 'failure');
  assert.equal(current.status, 'failed'); assert.equal(current.paidAt, null);
  assert.equal((await customer.send(path(ride) + '/receipt')).status, 409);
  const failedSummary = (await driver.send('/api/driver/earnings')).body.summary;
  assert.equal(failedSummary.failedTrips, 1); assert.equal(failedSummary.simulatedPaidKobo, '0');
  current = await start(customer, current); assert.notEqual(current.attempt.reference, failedReference);
  h.advance(1000); current = await resolve(customer, current);
  assert.equal(current.status, 'paid'); assert.equal(current.attempt.status, 'succeeded');
  const receipt = (await customer.send(path(ride) + '/receipt')).body.receipt;
  assert.deepEqual(receipt, { number: current.attempt.reference, reference: current.attempt.reference, rideId: ride.id,
    mode: 'simulation', currency: 'NGN', amountKobo: 470001, pickup: 'Wuse II', destination: 'Maitama',
    completedAt: ride.trip.completedAt, paidAt: current.paidAt, notice: 'SIMULATED RECEIPT — NO MONEY MOVED' });
  assert.deepEqual((await driver.send(path(ride) + '/receipt')).body.receipt, receipt);
  const summary = (await driver.send('/api/driver/earnings')).body.summary;
  assert.deepEqual(summary, { completedTrips: 1, paidTrips: 1, pendingTrips: 0, failedTrips: 0, unpaidTrips: 0,
    grossFareKobo: '470001', simulatedPaidKobo: '470001', outstandingKobo: '0' });
  await h.restart(); assert.deepEqual(await payment(customer, ride), current);
  assert.deepEqual((await customer.send(path(ride) + '/receipt')).body.receipt, receipt);
  assert.deepEqual((await customer.send(`/api/rides/${ride.id}`)).body.ride.negotiation.agreement, agreement);
  assert.equal(h.db.prepare('SELECT count(*) AS n FROM payment_attempts').get().n, 2);
  assert.equal(h.db.prepare('SELECT count(*) AS n FROM payment_receipts').get().n, 1);
  assert.equal((await customer.post(path(current) + '/start', { expectedVersion: current.version })).status, 409);
  const snapshotPath = h.filename.replace('test.sqlite', 'payment-backup.sqlite');
  saveSnapshot(h.filename, snapshotPath);
  const copy = new DatabaseSync(snapshotPath, { readOnly: true });
  try {
    assert.deepEqual(JSON.parse(copy.prepare('SELECT payload_json FROM payment_receipts').get().payload_json), receipt);
    assert.equal(copy.prepare('SELECT count(*) AS n FROM sessions').get().n, 0);
    assert.equal(copy.prepare('SELECT count(*) AS n FROM payment_commands').get().n, 4);
  } finally { copy.close(); }
});

test('concurrent starts and outcomes have one effect; retries never duplicate attempts, receipts or driver totals', async (t) => {
  const h = await harness(t), { customer, driver } = await participants(h);
  const ride = await complete(customer, driver); let current = await payment(customer, ride);
  const key = randomUUID(), data = { expectedVersion: current.version };
  const first = await Promise.all([customer.post(path(ride) + '/start', data, key), customer.post(path(ride) + '/start', data, key)]);
  assert.deepEqual(first.map((r) => r.status), [200, 200]);
  assert.deepEqual(first[0].body.payment, first[1].body.payment);
  assert.equal(first.filter((r) => r.body.replayed).length, 1);
  assert.equal(h.db.prepare('SELECT count(*) AS n FROM payment_attempts').get().n, 1);
  assert.equal((await customer.post(path(ride) + '/start', data)).status, 409);
  current = first[0].body.payment;
  const settleKey = randomUUID(), settlePath = path(ride) + `/attempts/${current.attempt.id}/simulate`;
  const replies = await Promise.all([customer.post(settlePath, { expectedVersion: current.version, outcome: 'success' }, settleKey),
    customer.post(settlePath, { expectedVersion: current.version, outcome: 'failure' })]);
  assert.deepEqual(replies.map((r) => r.status).sort(), [200, 409]);
  const saved = await payment(customer, ride);
  if (saved.status === 'paid') {
    const replay = await customer.post(settlePath, { expectedVersion: current.version, outcome: 'success' }, settleKey);
    assert.equal(replay.body.replayed, true);
    assert.equal(h.db.prepare('SELECT count(*) AS n FROM payment_receipts').get().n, 1);
    assert.equal((await driver.send('/api/driver/earnings')).body.summary.paidTrips, 1);
  } else {
    assert.equal(h.db.prepare('SELECT count(*) AS n FROM payment_receipts').get().n, 0);
    assert.equal((await driver.send('/api/driver/earnings')).body.summary.paidTrips, 0);
  }
  const replayStart = await customer.post(path(ride) + '/start', data, key);
  assert.equal(replayStart.body.replayed, true); assert.equal(replayStart.body.payment.status, saved.status);
  assert.equal(h.db.prepare('SELECT count(*) AS n FROM payment_attempts').get().n, 1);
});

test('payments enforce role, membership, sessions, origin, CSRF and strict server-owned fields', async (t) => {
  const h = await harness(t), { customer, driver, admin, drivers } = await participants(h, 2);
  const stranger = h.client(); await stranger.register('stranger');
  const ride = await complete(customer, driver), current = await payment(customer, ride);
  for (const actor of [stranger, drivers[1], admin]) {
    assert.equal((await actor.send(path(ride))).status, 404);
    assert.equal((await actor.send(path(ride) + '/receipt')).status, 404);
    assert.equal((await actor.post(path(ride) + '/start', { expectedVersion: 0 })).status, 404);
  }
  assert.equal((await driver.post(path(ride) + '/start', { expectedVersion: 0 })).status, 403);
  assert.equal((await h.client().send(path(ride))).status, 401);
  for (const actor of [customer, driver, stranger]) assert.equal((await actor.send('/api/admin/payments')).status, 403);
  assert.equal((await customer.send('/api/driver/earnings')).status, 403);
  assert.deepEqual((await drivers[1].send('/api/driver/earnings')).body.payments, []);
  for (const headers of [{ Origin: 'https://evil.test' }, { 'X-CSRF-Token': null }]) {
    assert.equal((await customer.send(path(ride) + '/start', { method: 'POST', data: { expectedVersion: 0 },
      headers: { 'Idempotency-Key': randomUUID(), ...headers } })).status, 403);
  }
  for (const data of [{ expectedVersion: 0, amountKobo: 1 }, { expectedVersion: 0, currency: 'USD' },
    { expectedVersion: 0, status: 'paid' }, { expectedVersion: 0, customerId: stranger.user.id },
    {}, { expectedVersion: '0' }, { expectedVersion: -1 }, { expectedVersion: 0.5 }, []]) {
    assert.equal((await customer.post(path(ride) + '/start', data)).status, 400, JSON.stringify(data));
  }
  assert.equal((await customer.post(path(ride) + '/start', { expectedVersion: 0 }, 'short')).status, 400);
  assert.deepEqual(await payment(customer, ride), current);
  const active = await start(customer, current);
  for (const data of [{ expectedVersion: active.version, outcome: 'paid' }, { expectedVersion: active.version, outcome: 'success', amountKobo: 1 }]) {
    assert.equal((await customer.post(path(ride) + `/attempts/${active.attempt.id}/simulate`, data)).status, 400);
  }
  await resolve(customer, active);
  for (const actor of [stranger, drivers[1], admin]) assert.equal((await actor.send(path(ride) + '/receipt')).status, 404);
  const transactionRecord = (await admin.send('/api/admin/payments')).body.payments[0];
  assert.equal(transactionRecord.amountKobo, 470001); assert.equal(transactionRecord.status, 'paid');
  assert.ok(!/password|csrf|email|pickupPin|latitude|customerId|driverId|pickup|destination/.test(JSON.stringify(transactionRecord)));
  h.db.prepare("UPDATE drivers SET status = 'rejected' WHERE user_id = ?").run(driver.user.id);
  assert.equal((await driver.send('/api/driver/earnings')).status, 200, 'historical earnings are still readable');
  const cookie = customer.cookie; await customer.post('/api/auth/logout'); customer.cookie = cookie;
  assert.equal((await customer.send(path(ride) + '/receipt')).status, 401);
});

test('cancelled trips and fare agreements create no bill; completion and payment initialization commit together', async (t) => {
  const h = await harness(t), { customer, driver } = await participants(h);
  let cancelled = await claimRide(driver, await requestRide(customer));
  cancelled = await step(driver, cancelled, 'offers', { amountKobo: 123456 });
  cancelled = await step(customer, cancelled, 'accept', { offerId: cancelled.negotiation.currentOffer.id });
  assert.equal(await payment(customer, cancelled), null);
  cancelled = await step(customer, cancelled, 'cancel'); assert.equal(await payment(customer, cancelled), null);
  let ride = await startedTrip(customer, driver);
  h.db.exec("CREATE TRIGGER fail_bill BEFORE INSERT ON payments BEGIN SELECT RAISE(ABORT, 'fixture bill failure'); END");
  const key = randomUUID(), data = { expectedVersion: ride.version };
  assert.equal((await driver.post(`/api/rides/${ride.id}/complete`, data, key)).status, 500);
  assert.equal((await customer.send(`/api/rides/${ride.id}`)).body.ride.status, 'in_progress');
  assert.equal(h.db.prepare("SELECT count(*) AS n FROM ride_activity WHERE type = 'completed'").get().n, 0);
  assert.equal(h.db.prepare('SELECT count(*) AS n FROM payments').get().n, 0);
  h.db.exec('DROP TRIGGER fail_bill');
  ride = await step(driver, ride, 'complete', {}, key);
  assert.equal((await payment(customer, ride)).status, 'unpaid');
  assert.equal((await driver.post(`/api/rides/${ride.id}/complete`, data, key)).body.replayed, true);
  assert.equal(h.db.prepare('SELECT count(*) AS n FROM payments').get().n, 1);
});

test('receipt and command failures roll back the result and allow safe retries of the same payment', async (t) => {
  const h = await harness(t), { customer, driver } = await participants(h);
  const ride = await complete(customer, driver), current = await start(customer, await payment(customer, ride));
  const key = randomUUID(), data = { expectedVersion: current.version, outcome: 'success' }, url = path(ride) + `/attempts/${current.attempt.id}/simulate`;
  for (const table of ['payment_receipts', 'payment_commands', 'audit_events']) {
    h.db.exec(`CREATE TRIGGER fail_result BEFORE INSERT ON ${table} BEGIN SELECT RAISE(ABORT, 'fixture result failure'); END`);
    assert.equal((await customer.post(url, data, key)).status, 500);
    assert.deepEqual(await payment(customer, ride), current);
    assert.equal(h.db.prepare('SELECT count(*) AS n FROM payment_receipts').get().n, 0);
    h.db.exec('DROP TRIGGER fail_result');
  }
  assert.equal((await customer.post(url, data, key)).body.payment.status, 'paid');
  assert.equal((await customer.post(url, data, key)).body.replayed, true);
  assert.equal((await driver.send('/api/driver/earnings')).body.summary.simulatedPaidKobo, '470001');
});

test('attempt initialization rolls back on failure and competing fresh keys reserve only one pending attempt', async (t) => {
  const h = await harness(t), { customer, driver } = await participants(h);
  const ride = await complete(customer, driver), initial = await payment(customer, ride), key = randomUUID();
  h.db.exec("CREATE TRIGGER fail_start BEFORE INSERT ON payment_commands BEGIN SELECT RAISE(ABORT, 'fixture start failure'); END");
  assert.equal((await customer.post(path(ride) + '/start', { expectedVersion: 0 }, key)).status, 500);
  assert.deepEqual(await payment(customer, ride), initial);
  assert.equal(h.db.prepare('SELECT count(*) AS n FROM payment_attempts').get().n, 0);
  assert.equal(h.db.prepare("SELECT count(*) AS n FROM audit_events WHERE kind = 'payment.simulation_started'").get().n, 0);
  h.db.exec('DROP TRIGGER fail_start');
  const results = await Promise.all([customer.post(path(ride) + '/start', { expectedVersion: 0 }, key),
    customer.post(path(ride) + '/start', { expectedVersion: 0 })]);
  assert.deepEqual(results.map((result) => result.status).sort(), [200, 409]);
  assert.equal((await payment(customer, ride)).status, 'pending');
  assert.equal(h.db.prepare('SELECT count(*) AS n FROM payment_attempts').get().n, 1);
});

test('keys cannot change outcomes and old failed attempts cannot settle a newer attempt', async (t) => {
  const h = await harness(t), { customer, driver } = await participants(h);
  const ride = await complete(customer, driver);
  const key = randomUUID(), pending = await start(customer, await payment(customer, ride), key);
  assert.equal((await customer.post(path(ride) + '/start', { expectedVersion: pending.version }, key)).body.error.code, 'KEY_REUSED');
  const outcomeKey = randomUUID(), failed = await resolve(customer, pending, 'failure', outcomeKey);
  const next = await start(customer, failed);
  const oldPath = path(ride) + `/attempts/${pending.attempt.id}/simulate`;
  assert.equal((await customer.post(oldPath, { expectedVersion: pending.version, outcome: 'success' }, outcomeKey)).body.error.code, 'KEY_REUSED');
  assert.equal((await customer.post(oldPath, { expectedVersion: next.version, outcome: 'success' })).body.error.code, 'PAYMENT_CLOSED');
  assert.equal((await customer.post(oldPath, { expectedVersion: pending.version, outcome: 'failure' }, outcomeKey)).body.replayed, true);
  assert.deepEqual(await payment(customer, ride), next);
  const secondRide = await complete(customer, driver);
  assert.equal((await customer.post(path(secondRide) + '/start', { expectedVersion: 0 }, key)).body.error.code, 'KEY_REUSED');
  assert.equal(h.db.prepare('SELECT count(*) AS n FROM payment_attempts').get().n, 2);
});

test('server verifies simulator identity, reference, amount, currency and status before issuing a receipt', async (t) => {
  const h = await harness(t), { customer, driver } = await participants(h);
  const ride = await complete(customer, driver), current = await start(customer, await payment(customer, ride));
  const app = createApplication({ db: h.db });
  const options = { repository: createPaymentsRepository(h.db), getAccount: app.accounts.profile, tripForPayment: app.rides.paymentContext,
    unitOfWork: (fn) => transaction(h.db, fn), tokens, audit: createAudit(h.db), clock: () => 1001000, allowSimulation: true };
  const input = { userId: customer.user.id, rideId: ride.id, attemptId: current.attempt.id, action: 'simulate', key: randomUUID(),
    data: { expectedVersion: current.version, outcome: 'success' } };
  for (const override of [{ reference: 'unknown' }, { amountKobo: 1 }, { amountKobo: '470001' }, { currency: 'USD' },
    { mode: 'live' }, { provider: 'paystack' }, { status: 'processing' }]) {
    const payments = createPaymentsService({ ...options, simulate: (data) => ({ ...simulatePayment(data), ...override }) });
    assert.throws(() => payments.command(input), (error) => error.code === 'PAYMENT_VERIFICATION_FAILED');
    assert.deepEqual(await payment(customer, ride), current);
  }
  assert.equal(h.db.prepare('SELECT count(*) AS n FROM payment_receipts').get().n, 0);
  const disabled = createPaymentsService({ ...options, simulate: simulatePayment, allowSimulation: false });
  assert.equal(disabled.get(customer.user.id, ride.id).settings.canSimulate, false);
  assert.throws(() => disabled.command(input), (error) => error.code === 'FORBIDDEN');
  assert.equal(createPaymentsService({ ...options, simulate: simulatePayment }).command(input).payment.status, 'paid');
});

test('driver totals cover all saved trips with exact large values and stable private pagination', async (t) => {
  const h = await harness(t), { customer, driver, drivers, admin } = await participants(h, 2);
  const original = await complete(customer, driver, Number.MAX_SAFE_INTEGER);
  // Seed additional completed historical rows to exercise pages without spending
  // HTTP rate limits on setup. Each fare is a valid safe integer, unlike the sum.
  for (let i = 0; i < 24; i++) {
    const id = randomUUID();
    h.db.prepare(`INSERT INTO rides (id, customer_id, driver_id, pickup_id, destination_id, suggested_fare_kobo, status, version, created_at, matched_at, updated_at)
      SELECT ?, customer_id, driver_id, pickup_id, destination_id, suggested_fare_kobo, status, version, created_at, matched_at, updated_at FROM rides WHERE id = ?`).run(id, original.id);
    h.db.prepare(`INSERT INTO ride_trips (ride_id, customer_id, driver_id, status, fare_kobo, booked_at, departed_at, arrived_at, started_at, completed_at)
      SELECT ?, customer_id, driver_id, status, fare_kobo, booked_at, departed_at, arrived_at, started_at, completed_at FROM ride_trips WHERE ride_id = ?`).run(id, original.id);
    h.db.prepare(`INSERT INTO payments (ride_id, customer_id, driver_id, amount_kobo, completed_at, updated_at)
      SELECT ?, customer_id, driver_id, amount_kobo, completed_at, updated_at FROM payments WHERE ride_id = ?`).run(id, original.id);
  }
  const first = (await driver.send('/api/driver/earnings')).body;
  assert.equal(first.summary.completedTrips, 25); assert.equal(first.summary.grossFareKobo, (25n * BigInt(Number.MAX_SAFE_INTEGER)).toString());
  assert.equal(first.summary.simulatedPaidKobo, '0'); assert.equal(first.payments.length, 20); assert.ok(first.nextBefore);
  const second = (await driver.send('/api/driver/earnings?before=' + first.nextBefore)).body;
  assert.equal(second.payments.length, 5); assert.equal(second.nextBefore, null);
  assert.equal(new Set([...first.payments, ...second.payments].map((item) => item.rideId)).size, 25);
  assert.equal((await drivers[1].send('/api/driver/earnings?before=' + first.nextBefore)).status, 400);
  for (const cursor of ['wrong', randomUUID()]) assert.equal((await driver.send('/api/driver/earnings?before=' + cursor)).status, 400);
  const adminFirst = (await admin.send('/api/admin/payments')).body;
  assert.equal(adminFirst.payments.length, 20);
  assert.equal((await admin.send('/api/admin/payments?before=' + adminFirst.nextBefore)).body.payments.length, 5);
});
