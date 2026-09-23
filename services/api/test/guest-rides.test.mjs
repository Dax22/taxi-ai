import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { harness, participants, claimRide, PASSWORD } from './helpers.mjs';
import { openDatabase, SCHEMA_VERSION } from '../src/infrastructure/database.mjs';
import { saveSnapshot } from '../src/infrastructure/database-snapshot.mjs';
import { createTelemetry } from '../src/infrastructure/telemetry.mjs';
import { removeGuestFixtureTables } from './migration-fixtures.mjs';
import { readGuestResponse, readGuestTripResponse } from '../../../packages/shared/src/guest-rides.mjs';

const route = { pickupId: 'wuse-ii', destinationId: 'maitama' };
const passenger = { kind: 'guest', name: 'Ada Test Guest', phone: '+2348000000099', consent: true };
const ok = (response, status = 200) => { assert.equal(response.status, status, JSON.stringify(response.body)); return response.body; };
const basePath = (ride) => `/api/guest-rides/${ride.id}`;
const createLink = (actor, ride, expectedLinkId = null, key = randomUUID()) => actor.post(basePath(ride) + '/link', { expectedLinkId }, key);
const publicView = (h, token, extra = {}) => h.client().post('/api/guest-trip/view', { token, ...extra });
const metadata = async (actor, ride) => ok(await actor.send(basePath(ride))).guest;
async function step(actor, ride, action, extra = {}, key) {
  return ok(await actor.post(`/api/rides/${ride.id}/${action}`, { expectedVersion: ride.version, ...extra }, key)).ride;
}
async function request(actor, data = {}, key) {
  return ok(await actor.post('/api/rides', { ...route, passenger, ...data }, key), 201).ride;
}
async function confirm(actors, requested) {
  let ride = await claimRide(actors.driver, requested);
  ride = await step(actors.driver, ride, 'offers', { amountKobo: 470000 });
  ride = await step(actors.customer, ride, 'accept', { offerId: ride.negotiation.currentOffer.id });
  return step(actors.customer, ride, 'confirm');
}
async function fixture(t, options = {}) {
  const h = await harness(t, options), actors = await participants(h);
  const ride = await confirm(actors, await request(actors.customer));
  return { h, ...actors, ride };
}
async function native(h, path, token, data, key = randomUUID(), headers = {}) {
  const response = await fetch(h.base + '/api/mobile/v1' + path, {
    method: data === undefined ? 'GET' : 'POST',
    headers: { 'Content-Type': 'application/json', 'Idempotency-Key': key, ...(token ? { Authorization: `Bearer ${token}` } : {}), ...headers },
    ...(data === undefined ? {} : { body: JSON.stringify(data) }),
  });
  return { status: response.status, body: await response.json(), headers: response.headers };
}
const phone = async (h, actor) => ok(await native(h, '/auth/login', null, {
  email: actor.user.email, password: PASSWORD, deviceName: 'Guest ride test phone',
})).credentials;

test('web guest requests preserve the booker and immutable passenger snapshot across retry and restart', async (t) => {
  const h = await harness(t, { persistent: true }), actors = await participants(h), { customer, driver } = actors;
  const key = randomUUID();
  let ride = await request(customer, {}, key);
  assert.equal(ride.customer.id, customer.user.id);
  assert.equal(ride.passenger.kind, 'guest'); assert.equal(ride.passenger.name, passenger.name);
  assert.equal(ride.passenger.phone, passenger.phone);
  const replay = ok(await customer.post('/api/rides', { ...route, passenger }, key), 200);
  assert.equal(replay.replayed, true); assert.equal(replay.ride.id, ride.id);
  assert.equal(h.db.prepare('SELECT count(*) AS n FROM guest_ride_passengers').get().n, 1);
  const snapshot = h.db.prepare('SELECT snapshot_json FROM guest_ride_passengers WHERE ride_id=?').get(ride.id).snapshot_json;
  const accounts = h.db.prepare('SELECT count(*) AS n FROM users').get().n;
  const driverQueue = ok(await driver.send('/api/rides'));
  assert.equal(JSON.stringify(driverQueue).includes(passenger.phone), false);
  assert.equal(JSON.stringify(driverQueue).includes(passenger.name), false);
  assert.equal(JSON.stringify(driverQueue).includes('"passenger"'), false);
  ride = await confirm(actors, ride);
  const driverRide = ok(await driver.send(`/api/rides/${ride.id}`)).ride;
  assert.equal(driverRide.passenger.name, passenger.name);
  assert.equal(driverRide.passenger.kind, 'guest'); assert.equal(driverRide.passenger.phone, undefined);
  for (const action of ['cancel', 'confirm']) {
    assert.equal((await customer.post(`/api/rides/${ride.id}/${action}`, {
      expectedVersion: ride.version, passenger: { ...passenger, name: 'Replacement' },
    })).status, 400);
  }
  h.db.prepare('UPDATE users SET name=? WHERE id=?').run('Changed account name', customer.user.id);
  const created = ok(await createLink(customer, ride));
  assert.equal(ok(await publicView(h, created.token)).guestTrip.bookerName, 'Changed account name');
  await h.restart();
  assert.equal(h.db.prepare('SELECT snapshot_json FROM guest_ride_passengers WHERE ride_id=?').get(ride.id).snapshot_json, snapshot);
  assert.equal(h.db.prepare('SELECT count(*) AS n FROM users').get().n, accounts, 'guest booking never creates an account for the passenger');
  assert.equal(ok(await customer.send(`/api/rides/${ride.id}`)).ride.customer.id, customer.user.id);
  assert.equal(ok(await publicView(h, created.token)).guestTrip.passengerName, passenger.name);
});

test('guest booking rejects forged identity, unsafe details and missing consent without writing a ride', async (t) => {
  const h = await harness(t), { customer } = await participants(h);
  for (const invalid of [null, { ...passenger, consent: false }, { ...passenger, consent: 'true' },
    { ...passenger, name: 'Bad\u0000name' }, { ...passenger, name: 'x'.repeat(501) },
    { ...passenger, phone: 'not a phone' }, { ...passenger, bookerId: randomUUID() },
    { ...passenger, kind: 'driver' }, { kind: 'self', name: 'Forged self' }]) {
    assert.equal((await customer.post('/api/rides', { ...route, passenger: invalid })).status, 400, JSON.stringify(invalid));
  }
  assert.equal((await customer.post('/api/rides', { ...route, passenger, customerId: randomUUID() })).status, 400);
  assert.equal(h.db.prepare('SELECT count(*) AS n FROM rides').get().n, 0);
  assert.equal(h.db.prepare('SELECT count(*) AS n FROM guest_ride_passengers').get().n, 0);
  const self = ok(await customer.post('/api/rides', route), 201).ride;
  assert.deepEqual(self.passenger, { kind: 'self', name: customer.user.name });
  assert.equal(h.db.prepare('SELECT count(*) AS n FROM guest_ride_passengers').get().n, 0);
});

test('only the booker can manage confirmed guest links; web and native authentication boundaries agree', async (t) => {
  const h = await harness(t), actors = await participants(h), { customer, driver, admin } = actors;
  const outsider = h.client(); await outsider.register('outsider');
  let ride = await request(customer);
  assert.equal((await metadata(customer, ride)).canCreate, false);
  assert.equal((await createLink(customer, ride)).status, 409);
  ride = await confirm(actors, ride);
  assert.equal((await metadata(customer, ride)).canCreate, true);
  for (const actor of [driver, admin, outsider]) {
    assert.equal((await actor.send(basePath(ride))).status, 404);
    assert.equal((await createLink(actor, ride)).status, 404);
  }
  assert.equal((await h.client().send(basePath(ride))).status, 401);
  assert.equal((await customer.send(basePath(ride) + '/link', { method: 'POST', data: { expectedLinkId: null },
    headers: { 'X-CSRF-Token': null, 'Idempotency-Key': randomUUID() } })).status, 403);
  for (const data of [{}, { expectedLinkId: 'invalid' }, { expectedLinkId: null, minutes: 5 }, { expectedLinkId: null, token: 'forged' }]) {
    assert.equal((await customer.post(basePath(ride) + '/link', data)).status, 400);
  }
  const credentials = await phone(h, customer), path = `/guest-rides/${ride.id}`;
  assert.equal(ok(await native(h, path, credentials.accessToken)).guest.canCreate, true);
  assert.equal((await native(h, path, null, undefined, undefined, { Cookie: customer.cookie })).status, 401);
  assert.equal((await native(h, path, credentials.accessToken, undefined, undefined, { Origin: h.base })).status, 403);
  for (const actor of [driver, outsider]) {
    const device = await phone(h, actor);
    assert.equal((await native(h, path, device.accessToken)).status, 404);
    assert.equal((await native(h, path + '/link', device.accessToken, { expectedLinkId: null })).status, 404);
  }
  assert.equal((await native(h, path + '/link', credentials.accessToken, { expectedLinkId: null }, '')).status, 400);
});

test('guest identity and preview capability never transfer the booker’s fare, chat or payment authority', async (t) => {
  const h = await harness(t), { customer, driver } = await participants(h), guestAccount = h.client();
  ok(await guestAccount.post('/api/auth/register', {
    name: passenger.name, email: 'ada-guest@example.test', password: PASSWORD, role: 'customer',
  }), 201);
  const credentials = await phone(h, guestAccount);
  let ride = await claimRide(driver, await request(customer));
  const farePath = `/api/rides/${ride.id}`, nativePath = `/journeys/${ride.id}`, payPath = `/api/payments/rides/${ride.id}`;
  assert.equal(guestAccount.user.name, passenger.name, 'a matching passenger name does not imply account membership');
  const offer = { expectedVersion: ride.version, amountKobo: 470000 };
  assert.equal((await guestAccount.post(farePath + '/offers', offer)).status, 404);
  assert.equal((await native(h, nativePath + '/propose', credentials.accessToken, offer)).status, 404);
  ride = await step(driver, ride, 'offers', { amountKobo: offer.amountKobo });
  const acceptance = { expectedVersion: ride.version, offerId: ride.negotiation.currentOffer.id };
  assert.equal((await guestAccount.post(farePath + '/accept', acceptance)).status, 404);
  assert.equal((await native(h, nativePath + '/accept', credentials.accessToken, acceptance)).status, 404);
  ride = await step(customer, ride, 'accept', { offerId: acceptance.offerId });
  const confirmation = { expectedVersion: ride.version };
  assert.equal((await guestAccount.post(farePath + '/confirm', confirmation)).status, 404);
  assert.equal((await native(h, nativePath + '/confirm', credentials.accessToken, confirmation)).status, 404);
  ride = await step(customer, ride, 'confirm');
  const pin = ride.trip.pickupPin, created = ok(await createLink(customer, ride));
  const bearerPost = (path, data) => h.client().send(path, { method: 'POST', data,
    headers: { Authorization: `Bearer ${created.token}`, 'Idempotency-Key': randomUUID() } });
  assert.equal((await publicView(h, created.token)).status, 200);
  assert.equal((await bearerPost(farePath + '/offers', { expectedVersion: ride.version, amountKobo: 1 })).status, 401);
  assert.equal((await native(h, nativePath + '/propose', created.token, { expectedVersion: ride.version, amountKobo: 1 })).status, 401);
  assert.equal((await bearerPost(payPath + '/start', { expectedVersion: 0 })).status, 401);
  assert.equal((await guestAccount.send(farePath + '/chat')).status, 404);
  assert.equal((await guestAccount.post(farePath + '/chat/messages', { body: 'Attempt to join the booker conversation' })).status, 404);
  assert.equal((await native(h, nativePath + '/chat/messages', credentials.accessToken, { body: 'Attempt to join the booker conversation' })).status, 404);
  ok(await customer.post(farePath + '/chat/messages', { body: 'The booked passenger is waiting at pickup.' }), 201);
  for (const action of ['depart', 'arrive', 'start', 'complete']) ride = await step(driver, ride, action, action === 'start' ? { pickupPin: pin } : {});
  let payment = ok(await customer.send(payPath)).payment;
  assert.equal(payment.status, 'unpaid'); assert.equal(payment.amountKobo, offer.amountKobo);
  assert.equal((await guestAccount.send(payPath)).status, 404);
  assert.equal((await guestAccount.send(payPath + '/receipt')).status, 404);
  assert.equal((await guestAccount.post(payPath + '/start', { expectedVersion: payment.version })).status, 404);
  assert.equal((await driver.post(payPath + '/start', { expectedVersion: payment.version })).status, 403);
  assert.equal((await bearerPost(payPath + '/start', { expectedVersion: payment.version })).status, 401);
  assert.equal(h.db.prepare('SELECT count(*) AS n FROM payment_attempts').get().n, 0);
  payment = ok(await customer.post(payPath + '/start', { expectedVersion: payment.version })).payment;
  const settlementPath = payPath + `/attempts/${payment.attempt.id}/simulate`, settlement = { expectedVersion: payment.version, outcome: 'success' };
  assert.equal((await guestAccount.post(settlementPath, settlement)).status, 404);
  assert.equal((await bearerPost(settlementPath, settlement)).status, 401);
  assert.equal(ok(await customer.send(payPath)).payment.status, 'pending');
  payment = ok(await customer.post(settlementPath, settlement)).payment;
  assert.equal(payment.status, 'paid'); assert.equal(payment.amountKobo, offer.amountKobo);
  assert.equal(ok(await customer.send(payPath + '/receipt')).receipt.amountKobo, offer.amountKobo);
  assert.equal((await guestAccount.send(payPath + '/receipt')).status, 404);
  const saved = h.db.prepare('SELECT customer_id,amount_kobo,status FROM payments WHERE ride_id=?').get(ride.id);
  assert.equal(saved.customer_id, customer.user.id); assert.equal(saved.amount_kobo, offer.amountKobo); assert.equal(saved.status, 'paid');
});

test('guest bearer secrets are emitted once, stored as digests and grant only a minimal preview', async (t) => {
  const lines = [], { h, customer, driver, ride } = await fixture(t, { telemetry: createTelemetry({ write: (line) => lines.push(line) }) });
  const key = randomUUID(), created = ok(await createLink(customer, ride, null, key));
  readGuestResponse(created, ride.id);
  assert.match(created.token, /^[a-f0-9]{64}$/); assert.equal(created.replayed, false);
  assert.equal(created.guest.rideId, ride.id); assert.equal(created.guest.link.active, true);
  const replay = ok(await createLink(customer, ride, null, key));
  assert.equal(replay.replayed, true); assert.equal(replay.token ?? null, null);
  assert.equal(replay.guest.link.id, created.guest.link.id);
  const stored = h.db.prepare('SELECT * FROM guest_ride_links WHERE id=?').get(created.guest.link.id);
  assert.equal(stored.token_hash, createHash('sha256').update(created.token).digest('hex'));
  assert.equal(stored.expires_at - stored.created_at, 24 * 60 * 60_000);
  for (const table of ['guest_ride_links', 'guest_ride_commands', 'audit_events', 'idempotency']) {
    assert.equal(JSON.stringify(h.db.prepare(`SELECT * FROM ${table}`).all()).includes(created.token), false, table);
  }
  const viewed = await publicView(h, created.token), body = ok(viewed);
  readGuestTripResponse(body);
  assert.equal(body.mode, 'preview'); assert.equal(body.expiresAt, created.guest.link.expiresAt);
  assert.deepEqual(Object.keys(body.guestTrip).sort(), ['bookerName', 'destination', 'driver', 'location', 'passengerName', 'pickup', 'pickupPin', 'reference', 'status']);
  assert.equal(body.guestTrip.pickupPin, ride.trip.pickupPin);
  assert.equal(body.guestTrip.passengerName, passenger.name); assert.equal(body.guestTrip.bookerName, customer.user.name);
  assert.equal(body.guestTrip.driver.name, driver.user.name);
  assert.deepEqual(Object.keys(body.guestTrip.driver).sort(), ['name', 'vehicle']);
  assert.equal(viewed.headers.get('cache-control'), 'no-store');
  for (const secret of [passenger.phone, customer.user.email, customer.user.id, driver.user.id]) {
    assert.equal(JSON.stringify(body).includes(secret), false, secret);
  }
  assert.equal((await native(h, `/journeys/${ride.id}/cancel`, created.token, { expectedVersion: ride.version })).status, 401);
  assert.equal((await h.client().post(`/api/rides/${ride.id}/cancel`, { token: created.token, expectedVersion: ride.version })).status, 401);
  assert.equal((await native(h, `/guest-rides/${ride.id}`, created.token)).status, 401);
  assert.equal((await publicView(h, created.token, { rideId: ride.id })).status, 400);
  assert.equal((await publicView(h, 'f'.repeat(64))).status, 404);
  assert.equal((await h.client().send('/api/guest-trip/view', { method: 'POST', data: { token: created.token }, headers: { Origin: 'https://foreign.example' } })).status, 403);
  for (const secret of [created.token, passenger.phone, ride.trip.pickupPin]) assert.equal(lines.join('\n').includes(secret), false, 'telemetry omits ' + secret);
});

test('replacement and revocation require the latest link identity and version; retries cannot recover a token', async (t) => {
  const { h, customer, driver, ride } = await fixture(t);
  const firstKey = randomUUID(), first = ok(await createLink(customer, ride, null, firstKey)), previous = first.guest.link;
  assert.equal((await createLink(customer, ride)).body.error.code, 'STALE_VERSION');
  const competing = await Promise.all([createLink(customer, ride, previous.id), createLink(customer, ride, previous.id)]);
  assert.deepEqual(competing.map((r) => r.status).sort(), [200, 409]);
  const second = ok(competing.find((r) => r.status === 200)), current = second.guest.link;
  assert.notEqual(current.id, previous.id); assert.equal((await publicView(h, first.token)).status, 404);
  assert.equal((await publicView(h, second.token)).status, 200);
  const oldReplay = ok(await createLink(customer, ride, null, firstKey));
  assert.equal(oldReplay.replayed, true); assert.equal(oldReplay.token ?? null, null);
  assert.equal(oldReplay.guest.link.id, previous.id); assert.equal(oldReplay.guest.link.active, false);
  assert.equal((await createLink(customer, ride, current.id, firstKey)).body.error.code, 'KEY_REUSED');
  const path = basePath(ride) + '/revoke', key = randomUUID(), data = { linkId: current.id, expectedVersion: current.version };
  assert.equal((await driver.post(path, data)).status, 404);
  assert.equal((await customer.post(path, { ...data, expectedVersion: current.version + 1 })).body.error.code, 'STALE_VERSION');
  assert.equal((await customer.post(path, { linkId: previous.id, expectedVersion: previous.version })).body.error.code, 'STALE_VERSION');
  assert.equal(ok(await customer.post(path, data, key)).guest.link.active, false);
  assert.equal(ok(await customer.post(path, data, key)).replayed, true);
  assert.equal((await publicView(h, second.token)).status, 404);
  assert.equal((await createLink(customer, ride)).body.error.code, 'STALE_VERSION');
  assert.equal(ok(await createLink(customer, ride, current.id)).guest.link.active, true);
});

test('the guest preview shares the pickup PIN only until trip start and closes when the trip completes', async (t) => {
  const { h, customer, driver, ride: initial } = await fixture(t);
  let ride = initial; const pin = ride.trip.pickupPin, created = ok(await createLink(customer, ride));
  for (const action of ['depart', 'arrive']) {
    ride = await step(driver, ride, action);
    assert.equal(ok(await publicView(h, created.token)).guestTrip.pickupPin, pin);
    assert.equal(ok(await driver.send(`/api/rides/${ride.id}`)).ride.trip.pickupPin, undefined);
  }
  ride = await step(driver, ride, 'start', { pickupPin: pin });
  const inProgress = ok(await publicView(h, created.token)).guestTrip;
  assert.equal(inProgress.status, 'in_progress'); assert.equal(inProgress.pickupPin, null);
  assert.equal(h.db.prepare('SELECT pickup_pin FROM ride_trips WHERE ride_id=?').get(ride.id).pickup_pin, null);
  ride = await step(driver, ride, 'complete');
  assert.equal((await publicView(h, created.token)).status, 404);
  const state = await metadata(customer, ride); assert.equal(state.canCreate, false); assert.equal(state.link.active, false);
  assert.equal((await createLink(customer, ride, state.link.id)).status, 409);
  const row = h.db.prepare('SELECT token_hash,session_binding FROM guest_ride_links WHERE id=?').get(state.link.id);
  assert.equal(row.token_hash, null); assert.equal(row.session_binding, null);
});

test('cancellation, web logout and exact web-session expiry remove guest preview access', async (t) => {
  for (const ending of ['cancel', 'logout', 'session_expiry']) await t.test(ending, async (t) => {
    const { h, customer, ride } = await fixture(t), created = ok(await createLink(customer, ride));
    if (ending === 'cancel') await step(customer, ride, 'cancel', { reason: 'plans_changed' });
    else if (ending === 'logout') ok(await customer.post('/api/auth/logout', {}));
    else {
      h.advance(12 * 60 * 60_000 - 1); assert.equal((await publicView(h, created.token)).status, 200);
      h.advance(1);
    }
    assert.equal((await publicView(h, created.token)).status, 404);
    const row = h.db.prepare('SELECT active,token_hash,session_binding FROM guest_ride_links WHERE id=?').get(created.guest.link.id);
    assert.equal(row.active, 0); assert.equal(row.token_hash, null); assert.equal(row.session_binding, null);
  });
});

test('native guest booking and links survive token refresh but end on device revocation and native sign-out', async (t) => {
  const h = await harness(t), actors = await participants(h), { customer, driver } = actors;
  let credentials = await phone(h, customer);
  const requested = ok(await native(h, '/booking/requests', credentials.accessToken, { ...route, passenger })).ride;
  assert.equal(requested.passenger.name, passenger.name); assert.equal(requested.passenger.kind, 'guest');
  const ride = await confirm(actors, ok(await customer.send(`/api/rides/${requested.id}`)).ride), path = `/guest-rides/${ride.id}`;
  const driverDevice = await phone(h, driver);
  const nativeDriverRide = ok(await native(h, `/journeys/${ride.id}`, driverDevice.accessToken)).ride;
  assert.equal(nativeDriverRide.passenger.name, passenger.name); assert.equal(JSON.stringify(nativeDriverRide).includes(passenger.phone), false);
  const key = randomUUID(), data = { expectedLinkId: null };
  let created = ok(await native(h, path + '/link', credentials.accessToken, data, key));
  assert.equal(ok(await native(h, path + '/link', credentials.accessToken, data, key)).token ?? null, null);
  credentials = ok(await native(h, '/auth/refresh', null, { refreshToken: credentials.refreshToken })).credentials;
  assert.equal((await publicView(h, created.token)).status, 200);
  const revoked = ok(await native(h, path + '/revoke', credentials.accessToken, {
    linkId: created.guest.link.id, expectedVersion: created.guest.link.version,
  }));
  assert.equal(revoked.guest.link.active, false); assert.equal((await publicView(h, created.token)).status, 404);
  created = ok(await native(h, path + '/link', credentials.accessToken, { expectedLinkId: created.guest.link.id }));
  ok(await customer.post(`/api/account/devices/${credentials.sessionId}/revoke`, {}));
  assert.equal((await publicView(h, created.token)).status, 404);
  assert.equal((await native(h, path, credentials.accessToken)).status, 401);
  credentials = await phone(h, customer);
  created = ok(await native(h, path + '/link', credentials.accessToken, { expectedLinkId: created.guest.link.id }));
  ok(await native(h, '/auth/logout', null, { refreshToken: credentials.refreshToken }));
  assert.equal((await publicView(h, created.token)).status, 404);
});

test('native-bound links expire exactly at their 24-hour deadline without a device refresh reviving them', async (t) => {
  const { h, customer, ride } = await fixture(t); let credentials = await phone(h, customer);
  const created = ok(await native(h, `/guest-rides/${ride.id}/link`, credentials.accessToken, { expectedLinkId: null }));
  h.advance(created.guest.link.expiresAt - h.now - 1);
  assert.equal((await publicView(h, created.token)).status, 200);
  h.advance(1); assert.equal((await publicView(h, created.token)).status, 404);
  credentials = ok(await native(h, '/auth/refresh', null, { refreshToken: credentials.refreshToken })).credentials;
  assert.equal(ok(await native(h, `/guest-rides/${ride.id}`, credentials.accessToken)).guest.link.active, false);
  assert.equal((await publicView(h, created.token)).status, 404);
});

test('passenger persistence, link replacement and revocation roll back atomically with their retry records', async (t) => {
  const { h, customer, ride } = await fixture(t), other = h.client(); await other.register('rollback');
  const createKey = randomUUID(), beforePassengers = h.db.prepare('SELECT count(*) AS n FROM guest_ride_passengers').get().n;
  h.db.exec("CREATE TRIGGER fail_guest_booking BEFORE INSERT ON idempotency BEGIN SELECT RAISE(ABORT, 'test failure'); END");
  assert.equal((await other.post('/api/rides', { ...route, passenger }, createKey)).status, 500);
  assert.equal(h.db.prepare('SELECT count(*) AS n FROM guest_ride_passengers').get().n, beforePassengers);
  assert.equal(h.db.prepare('SELECT count(*) AS n FROM rides WHERE customer_id=?').get(other.user.id).n, 0);
  h.db.exec('DROP TRIGGER fail_guest_booking');
  assert.equal((await other.post('/api/rides', { ...route, passenger }, createKey)).status, 201);
  const original = ok(await createLink(customer, ride)), key = randomUUID();
  const before = h.db.prepare('SELECT count(*) AS n FROM audit_events').get().n;
  h.db.exec("CREATE TRIGGER fail_guest_link BEFORE INSERT ON guest_ride_commands BEGIN SELECT RAISE(ABORT, 'test failure'); END");
  assert.equal((await createLink(customer, ride, original.guest.link.id, key)).status, 500);
  assert.equal((await publicView(h, original.token)).status, 200);
  assert.equal(h.db.prepare('SELECT count(*) AS n FROM guest_ride_links').get().n, 1);
  assert.equal(h.db.prepare('SELECT count(*) AS n FROM audit_events').get().n, before);
  h.db.exec('DROP TRIGGER fail_guest_link');
  const replacement = ok(await createLink(customer, ride, original.guest.link.id, key));
  assert.equal((await publicView(h, original.token)).status, 404);
  const revokeKey = randomUUID(), data = { linkId: replacement.guest.link.id, expectedVersion: replacement.guest.link.version };
  h.db.exec("CREATE TRIGGER fail_guest_revoke BEFORE INSERT ON guest_ride_commands BEGIN SELECT RAISE(ABORT, 'test failure'); END");
  assert.equal((await customer.post(basePath(ride) + '/revoke', data, revokeKey)).status, 500);
  assert.equal((await publicView(h, replacement.token)).status, 200);
  h.db.exec('DROP TRIGGER fail_guest_revoke');
  ok(await customer.post(basePath(ride) + '/revoke', data, revokeKey));
  assert.equal((await publicView(h, replacement.token)).status, 404);
});

test('database snapshots preserve guest identity while destroying guest bearer access and session bindings', async (t) => {
  const { h, customer, ride } = await fixture(t, { persistent: true }), created = ok(await createLink(customer, ride));
  const folder = mkdtempSync(join(tmpdir(), 'taxi-guest-snapshot-'));
  t.after(() => rmSync(folder, { recursive: true, force: true }));
  const filename = join(folder, 'backup.sqlite'); saveSnapshot(h.filename, filename, { now: h.now + 1 });
  assert.equal((await publicView(h, created.token)).status, 200, 'snapshot leaves the live source untouched');
  const restored = openDatabase(filename);
  try {
    const row = restored.prepare('SELECT * FROM guest_ride_links WHERE id=?').get(created.guest.link.id);
    assert.equal(row.active, 0); assert.equal(row.token_hash, null); assert.equal(row.session_binding, null); assert.equal(row.reason, 'snapshot_reset');
    assert.deepEqual(restored.prepare('SELECT * FROM guest_ride_passengers').all(), h.db.prepare('SELECT * FROM guest_ride_passengers').all());
    assert.equal(restored.prepare('SELECT count(*) AS n FROM sessions').get().n, 0);
    assert.deepEqual(restored.prepare('PRAGMA foreign_key_check').all(), []);
  } finally { restored.close(); }
});

test('schema 21 migration preserves existing self rides and adds empty guest storage', async (t) => {
  const h = await harness(t, { persistent: true }), { customer } = await participants(h);
  const ride = ok(await customer.post('/api/rides', route), 201).ride;
  const before = h.db.prepare('SELECT * FROM rides WHERE id=?').get(ride.id);
  removeGuestFixtureTables(h.db); h.db.exec('PRAGMA user_version=21'); await h.restart();
  assert.ok(SCHEMA_VERSION > 21); assert.equal(h.db.prepare('PRAGMA user_version').get().user_version, SCHEMA_VERSION);
  assert.deepEqual(h.db.prepare('SELECT * FROM rides WHERE id=?').get(ride.id), before);
  for (const table of ['guest_ride_passengers', 'guest_ride_links', 'guest_ride_commands']) assert.equal(h.db.prepare(`SELECT count(*) AS n FROM ${table}`).get().n, 0);
  assert.deepEqual(ok(await customer.send(`/api/rides/${ride.id}`)).ride.passenger, { kind: 'self', name: customer.user.name });
  assert.equal((await metadata(customer, ride)).canCreate, false);
  assert.deepEqual(h.db.prepare('PRAGMA foreign_key_check').all(), []);
});
