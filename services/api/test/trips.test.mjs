import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { harness, participants, requestRide, claimRide } from './helpers.mjs';

async function command(client, ride, action, extra = {}, key) {
  const result = await client.post(`/api/rides/${ride.id}/${action}`, { expectedVersion: ride.version, ...extra }, key);
  assert.equal(result.status, 200, JSON.stringify(result.body));
  return result.body.ride;
}

async function agreed(customer, driver) {
  let ride = await claimRide(driver, await requestRide(customer));
  ride = await command(driver, ride, 'offers', { amountKobo: 470000 });
  return command(customer, ride, 'accept', { offerId: ride.negotiation.currentOffer.id });
}

async function arrive(customer, driver, ride) {
  ride = await command(customer, ride, 'confirm');
  const pin = ride.trip.pickupPin;
  ride = await command(driver, ride, 'depart');
  return { ride: await command(driver, ride, 'arrive'), pin };
}

test('a confirmed trip keeps the exact fare, limits PIN disclosure, persists progress and closes chat on completion', async (t) => {
  const h = await harness(t, { persistent: true });
  const { customer, driver, admin } = await participants(h);
  let ride = await agreed(customer, driver);
  const agreement = ride.negotiation.agreement;
  const key = randomUUID();
  const [one, two] = await Promise.all([
    command(customer, ride, 'confirm', {}, key), command(customer, ride, 'confirm', {}, key),
  ]);
  assert.deepEqual(one, two);
  ride = one;
  assert.equal(ride.status, 'booked');
  const pin = ride.trip.pickupPin;
  assert.match(pin, /^\d{6}$/);
  assert.equal(ride.trip.fareKobo, agreement.amountKobo);
  assert.equal((await driver.send(`/api/rides/${ride.id}`)).body.ride.trip.pickupPin, undefined);
  assert.ok((await driver.send('/api/rides')).body.rides.every((item) => !Object.hasOwn(item.trip ?? {}, 'pickupPin')));
  assert.equal((await admin.send(`/api/rides/${ride.id}`)).status, 404);
  assert.equal(h.db.prepare('SELECT count(*) AS n FROM ride_trips').get().n, 1);
  await h.restart();
  assert.equal((await customer.send(`/api/rides/${ride.id}`)).body.ride.trip.pickupPin, pin);
  for (const [action, status] of [['depart', 'on_way'], ['arrive', 'arrived'], ['start', 'in_progress'], ['complete', 'completed']]) {
    h.advance(1000);
    const original = ride;
    const actionKey = randomUUID();
    const extra = action === 'start' ? { pickupPin: pin } : {};
    ride = await command(driver, ride, action, extra, actionKey);
    assert.equal(ride.status, status);
    assert.deepEqual(ride.negotiation.agreement, agreement);
    assert.equal(ride.trip.fareKobo, 470000);
    assert.deepEqual(await command(driver, original, action, extra, actionKey), ride, 'retry has no second effect');
    assert.equal((await driver.post(`/api/rides/${ride.id}/${action}`, { expectedVersion: original.version, ...extra })).body.error.code, 'STALE_VERSION');
    const message = await customer.post(`/api/rides/${ride.id}/chat/messages`, { body: `Progress ${status}` });
    assert.equal(message.status, action === 'complete' ? 409 : 201);
    if (['start', 'complete'].includes(action)) {
      assert.equal((await customer.send(`/api/rides/${ride.id}`)).body.ride.trip.pickupPin, undefined);
      assert.equal(h.db.prepare('SELECT pickup_pin FROM ride_trips WHERE ride_id = ?').get(ride.id).pickup_pin, null);
    }
  }
  assert.deepEqual(ride.activity.map((entry) => entry.type), ['booked', 'on_way', 'arrived', 'in_progress', 'completed']);
  assert.ok(ride.trip.bookedAt < ride.trip.departedAt && ride.trip.departedAt < ride.trip.arrivedAt
    && ride.trip.arrivedAt < ride.trip.startedAt && ride.trip.startedAt < ride.trip.completedAt);
  assert.equal((await customer.send(`/api/rides/${ride.id}/chat`)).body.messages.length, 3);
  assert.equal((await customer.send(`/api/rides/${ride.id}/chat`)).body.canSend, false);
  await h.restart();
  assert.deepEqual((await driver.send(`/api/rides/${ride.id}`)).body.ride, ride);
  assert.equal((await customer.send('/api/rides/history')).body.rides[0].id, ride.id);
  assert.equal((await driver.send('/api/rides/history')).body.rides[0].id, ride.id);
  assert.deepEqual((await admin.send('/api/rides/history')).body.rides, []);
  await claimRide(driver, await requestRide(customer));
});

test('trip actions reject outsiders, wrong roles, forged state, missing CSRF and skipped stages', async (t) => {
  const h = await harness(t);
  const { customer, driver, admin } = await participants(h);
  const outsider = h.client(); await outsider.register('outsider');
  let ride = await claimRide(driver, await requestRide(customer));
  assert.equal((await customer.post(`/api/rides/${ride.id}/confirm`, { expectedVersion: ride.version })).body.error.code, 'INVALID_TRIP_STATE');
  ride = await command(driver, ride, 'offers', { amountKobo: 450000 });
  ride = await command(customer, ride, 'accept', { offerId: ride.negotiation.currentOffer.id });
  for (const actor of [outsider, admin]) {
    for (const action of ['confirm', 'depart', 'arrive', 'start', 'complete', 'cancel']) {
      assert.equal((await actor.post(`/api/rides/${ride.id}/${action}`, {
        expectedVersion: ride.version, ...(action === 'start' ? { pickupPin: '123456' } : {}),
      })).status, 404);
    }
  }
  assert.equal((await driver.post(`/api/rides/${ride.id}/confirm`, { expectedVersion: ride.version })).status, 403);
  assert.equal((await h.client().post(`/api/rides/${ride.id}/confirm`, { expectedVersion: ride.version })).status, 401);
  assert.equal((await customer.send(`/api/rides/${ride.id}/confirm`, { method: 'POST', data: { expectedVersion: ride.version },
    headers: { 'X-CSRF-Token': null, 'Idempotency-Key': randomUUID() } })).status, 403);
  for (const extra of [{ fareKobo: 1 }, { driverId: outsider.user.id }, { now: 0 }, { pickupPin: '123456' }, { expectedVersion: '3' }]) {
    assert.equal((await customer.post(`/api/rides/${ride.id}/confirm`, { expectedVersion: ride.version, ...extra })).status, 400);
  }
  ride = await command(customer, ride, 'confirm');
  for (const action of ['depart', 'arrive', 'start', 'complete']) {
    assert.equal((await customer.post(`/api/rides/${ride.id}/${action}`, { expectedVersion: ride.version,
      ...(action === 'start' ? { pickupPin: ride.trip.pickupPin } : {}) })).status, 403);
  }
  for (const action of ['arrive', 'start', 'complete']) {
    assert.equal((await driver.post(`/api/rides/${ride.id}/${action}`, { expectedVersion: ride.version,
      ...(action === 'start' ? { pickupPin: ride.trip.pickupPin } : {}) })).body.error.code, 'INVALID_TRIP_STATE');
  }
  assert.equal((await customer.post(`/api/rides/${ride.id}/offers`, { expectedVersion: ride.version, amountKobo: 1 })).body.error.code, 'REQUEST_CLOSED');
  const key = randomUUID();
  const before = ride;
  ride = await command(driver, ride, 'depart', {}, key);
  h.db.prepare("UPDATE drivers SET status = 'rejected' WHERE user_id = ?").run(driver.user.id);
  assert.equal((await driver.post(`/api/rides/${ride.id}/arrive`, { expectedVersion: ride.version })).status, 403);
  assert.equal((await driver.post(`/api/rides/${ride.id}/depart`, { expectedVersion: before.version }, key)).status, 403);
});

test('incorrect pickup PINs are counted once per command, survive restart, and lock for exactly five minutes', async (t) => {
  const h = await harness(t, { persistent: true });
  const { customer, driver } = await participants(h);
  const { ride, pin } = await arrive(customer, driver, await agreed(customer, driver));
  const path = `/api/rides/${ride.id}/start`;
  const wrong = pin === '000000' ? '000001' : '000000';
  for (const bad of [123456, '12345', '1234567', ' 12345', '12345x']) {
    assert.equal((await driver.post(path, { expectedVersion: ride.version, pickupPin: bad })).body.error.code, 'INVALID_PIN_FORMAT');
  }
  const key = randomUUID();
  const data = { expectedVersion: ride.version, pickupPin: wrong };
  for (let i = 0; i < 3; i++) assert.equal((await driver.post(path, data, key)).body.error.code, 'INVALID_PICKUP_PIN');
  assert.equal(h.db.prepare('SELECT pin_failures FROM ride_trips').get().pin_failures, 1);
  assert.equal((await driver.post(path, { ...data, pickupPin: pin }, key)).body.error.code, 'KEY_REUSED');
  for (let i = 0; i < 4; i++) assert.equal((await driver.post(path, data)).body.error.code, 'INVALID_PICKUP_PIN');
  assert.equal(h.db.prepare('SELECT pin_failures FROM ride_trips').get().pin_failures, 5);
  const locked = await driver.post(path, { ...data, pickupPin: pin });
  assert.equal(locked.body.error.code, 'PICKUP_PIN_LOCKED');
  assert.ok(!JSON.stringify(locked.body).includes(pin));
  await h.restart();
  h.advance(5 * 60_000 - 1);
  assert.equal((await driver.post(path, { ...data, pickupPin: pin })).body.error.code, 'PICKUP_PIN_LOCKED');
  h.advance(1);
  assert.equal((await command(driver, ride, 'start', { pickupPin: pin })).status, 'in_progress');
  assert.equal(h.db.prepare("SELECT count(*) AS n FROM audit_events WHERE kind = 'trip.pin_rejected'").get().n, 5);
  assert.equal(h.db.prepare('SELECT pickup_pin FROM ride_trips').get().pickup_pin, null);
});

test('both participants can cancel before pickup; cancellation preserves the fare and records actor/reason', async (t) => {
  const h = await harness(t);
  const { customer, driver } = await participants(h);
  for (const stage of ['requested', 'negotiating', 'agreed', 'booked', 'on_way', 'arrived']) {
    for (const actor of stage === 'requested' ? [customer] : [customer, driver]) {
      h.advance(60_001);
      let ride = await requestRide(customer);
      if (stage !== 'requested') ride = await claimRide(driver, ride);
      if (!['requested', 'negotiating'].includes(stage)) {
        ride = await command(driver, ride, 'offers', { amountKobo: 470000 });
        ride = await command(customer, ride, 'accept', { offerId: ride.negotiation.currentOffer.id });
      }
      if (['booked', 'on_way', 'arrived'].includes(stage)) ride = await command(customer, ride, 'confirm');
      if (['on_way', 'arrived'].includes(stage)) ride = await command(driver, ride, 'depart');
      if (stage === 'arrived') ride = await command(driver, ride, 'arrive');
      const agreement = ride.negotiation?.agreement;
      const cancelled = await command(actor, ride, 'cancel', { reason: 'pickup_problem' });
      assert.equal(cancelled.status, 'cancelled');
      assert.deepEqual(cancelled.negotiation?.agreement, agreement);
      assert.equal(cancelled.activity.at(-1).actorId, actor.user.id);
      assert.equal(cancelled.activity.at(-1).reason, 'pickup_problem');
      assert.ok(!cancelled.trip?.pickupPin);
      assert.equal((await actor.post(`/api/rides/${ride.id}/cancel`, { expectedVersion: cancelled.version })).body.error.code, 'REQUEST_CLOSED');
      if (stage !== 'requested') assert.equal((await customer.send(`/api/rides/${ride.id}/chat`)).body.canSend, false);
    }
  }
  h.advance(60_001);
  const { ride, pin } = await arrive(customer, driver, await agreed(customer, driver));
  const started = await command(driver, ride, 'start', { pickupPin: pin });
  for (const actor of [customer, driver]) {
    assert.equal((await actor.post(`/api/rides/${ride.id}/cancel`, { expectedVersion: started.version })).body.error.code, 'REQUEST_CLOSED');
  }
  assert.equal((await command(driver, started, 'complete')).status, 'completed');
});

test('competing confirmations and new work cannot double-book either participant', async (t) => {
  const h = await harness(t);
  const { customer, drivers } = await participants(h, 2);
  const other = h.client(); await other.register('other');
  const a = await agreed(customer, drivers[0]);
  const b = await agreed(other, drivers[0]);
  const results = await Promise.all([[customer, a], [other, b]].map(([actor, ride]) =>
    actor.post(`/api/rides/${ride.id}/confirm`, { expectedVersion: ride.version })));
  assert.deepEqual(results.map((result) => result.status).sort(), [200, 409]);
  assert.equal(results.find((r) => r.status === 409).body.error.code, 'DRIVER_BUSY');
  const winningIndex = results.findIndex((r) => r.status === 200);
  const winner = [customer, other][winningIndex], loser = [customer, other][1 - winningIndex];
  const booked = results[winningIndex].body.ride;
  assert.equal((await winner.post('/api/rides', { pickupId: 'wuse-ii', destinationId: 'maitama' })).body.error.code, 'OPEN_REQUEST_EXISTS');
  const open = await requestRide(loser);
  assert.equal((await drivers[0].post(`/api/rides/${open.id}/claim`, { expectedVersion: 0 })).body.error.code, 'DRIVER_BUSY');
  await command(loser, open, 'cancel');
  await command(winner, booked, 'cancel');
  const c = await agreed(customer, drivers[0]);
  const d = await agreed(customer, drivers[1]);
  const sameCustomer = await Promise.all([c, d].map((ride) => customer.post(`/api/rides/${ride.id}/confirm`, { expectedVersion: ride.version })));
  assert.deepEqual(sameCustomer.map((result) => result.status).sort(), [200, 409]);
  assert.equal(sameCustomer.find((r) => r.status === 409).body.error.code, 'OPEN_REQUEST_EXISTS');
  assert.equal(h.db.prepare("SELECT count(*) AS n FROM ride_trips WHERE status NOT IN ('completed', 'cancelled')").get().n, 1);
});

test('trip and PIN mutations roll back on persistence failure and reuse their original command safely', async (t) => {
  const h = await harness(t);
  const { customer, driver } = await participants(h);
  let ride = await agreed(customer, driver);
  const key = randomUUID();
  h.db.exec("CREATE TRIGGER reject_trip_key BEFORE INSERT ON idempotency BEGIN SELECT RAISE(ABORT, 'test storage failure'); END");
  assert.equal((await customer.post(`/api/rides/${ride.id}/confirm`, { expectedVersion: ride.version }, key)).status, 500);
  assert.equal(h.db.prepare('SELECT count(*) AS n FROM ride_trips').get().n, 0);
  assert.equal(h.db.prepare('SELECT count(*) AS n FROM ride_activity').get().n, 0);
  assert.equal((await customer.send(`/api/rides/${ride.id}`)).body.ride.version, ride.version);
  h.db.exec('DROP TRIGGER reject_trip_key');
  ride = await command(customer, ride, 'confirm', {}, key);
  const pin = ride.trip.pickupPin;
  ride = await command(driver, ride, 'depart');
  ride = await command(driver, ride, 'arrive');
  const auditBefore = h.db.prepare('SELECT count(*) AS n FROM audit_events').get().n;
  const startKey = randomUUID();
  h.db.exec("CREATE TRIGGER reject_trip_key BEFORE INSERT ON idempotency BEGIN SELECT RAISE(ABORT, 'test storage failure'); END");
  for (const input of [pin, pin === '000000' ? '000001' : '000000']) {
    assert.equal((await driver.post(`/api/rides/${ride.id}/start`, { expectedVersion: ride.version, pickupPin: input }, startKey)).status, 500);
    const saved = h.db.prepare('SELECT status, pickup_pin, pin_failures FROM ride_trips').get();
    assert.equal(saved.status, 'arrived'); assert.equal(saved.pickup_pin, pin); assert.equal(saved.pin_failures, 0);
    assert.equal(h.db.prepare('SELECT count(*) AS n FROM audit_events').get().n, auditBefore);
  }
  h.db.exec('DROP TRIGGER reject_trip_key');
  assert.equal((await command(driver, ride, 'start', { pickupPin: pin }, startKey)).status, 'in_progress');
});

test('start versus cancellation races have one winner and never produce a partially started trip', async (t) => {
  const h = await harness(t);
  const { customer, driver } = await participants(h);
  const { ride, pin } = await arrive(customer, driver, await agreed(customer, driver));
  const results = await Promise.all([
    customer.post(`/api/rides/${ride.id}/cancel`, { expectedVersion: ride.version, reason: 'plans_changed' }),
    driver.post(`/api/rides/${ride.id}/start`, { expectedVersion: ride.version, pickupPin: pin }),
  ]);
  assert.deepEqual(results.map((result) => result.status).sort(), [200, 409]);
  const saved = (await customer.send(`/api/rides/${ride.id}`)).body.ride;
  assert.ok(['cancelled', 'in_progress'].includes(saved.status));
  assert.equal(saved.version, ride.version + 1);
  assert.equal(saved.activity.length, ride.activity.length + 1);
  assert.equal(saved.trip.pickupPin, undefined);
});

test('history pages all saved terminal journeys without gaps and scopes cursors to their participant', async (t) => {
  const h = await harness(t);
  const customer = h.client(); await customer.register('customer');
  const outsider = h.client(); await outsider.register('outsider');
  const ids = [];
  for (let i = 0; i < 55; i++) {
    if (i % 10 === 0) h.advance(60_001);
    const ride = await requestRide(customer);
    await command(customer, ride, 'cancel'); ids.push(ride.id);
  }
  const current = await requestRide(customer);
  assert.equal((await customer.send('/api/rides')).body.rides[0].id, current.id);
  const seen = [], sizes = [];
  let cursor = '';
  do {
    const page = await customer.send(`/api/rides/history${cursor ? `?before=${cursor}` : ''}`);
    assert.equal(page.status, 200);
    seen.push(...page.body.rides.map((ride) => ride.id)); sizes.push(page.body.rides.length);
    cursor = page.body.nextBefore;
  } while (cursor);
  assert.deepEqual(sizes, [20, 20, 15]);
  assert.equal(new Set(seen).size, 55);
  assert.deepEqual([...seen].sort(), ids.sort());
  assert.deepEqual((await outsider.send('/api/rides/history')).body.rides, []);
  assert.equal((await outsider.send(`/api/rides/history?before=${seen[0]}`)).status, 404);
  assert.equal((await customer.send(`/api/rides/history?before=${current.id}`)).status, 400);
  assert.equal((await customer.send('/api/rides/history?before=not-a-cursor')).status, 400);
});
