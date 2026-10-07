import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { harness, participants, PASSWORD } from './helpers.mjs';
import { DETAILS, submitApplication, approveApplication, fixtureApi } from './driver-fixtures.mjs';
import { parseBookingRide } from '../../../packages/shared/src/mobile-booking.mjs';
import { parseJourney, parseWork } from '../../../packages/shared/src/mobile-journeys.mjs';
import { parseActivity } from '../../../packages/shared/src/mobile-contracts.mjs';

const route = { pickupId: 'wuse-ii', destinationId: 'maitama' };
const delivery = { description: 'Sealed parcel of test books', weightKg: 2, recipientName: 'Fictional Recipient',
  pickupInstructions: 'PRIVATE-PICKUP-INSTRUCTION-ONLY', dropoffInstructions: 'Reception desk' };
const ok = (response, status = 200) => { assert.equal(response.status, status, JSON.stringify(response.body)); return response.body; };
const base = (ride) => `/api/parcels/${ride.id}`;
const invite = async (sender, ride) => ok(await sender.send(base(ride) + '/invitation')).invitation;
const create = (sender, ride, expectedLinkId = null, key = randomUUID(), recipientEmail = 'parcel-recipient@example.test') => sender.post(base(ride) + '/link', { expectedLinkId, recipientEmail }, key);
const accept = (recipient, token, key = randomUUID()) => recipient.post('/api/parcels/accept', { token }, key);
const received = async (recipient, ride) => ok(await recipient.send(`/api/parcels/received/${ride.id}`)).parcel;
const book = async (customer, extra = {}) => ok(await customer.post('/api/rides', { ...route, vehicleCategory: 'standard', delivery, ...extra }), 201).ride;
async function step(actor, ride, action, extra = {}, key) {
  return ok(await actor.post(`/api/rides/${ride.id}/${action}`, { expectedVersion: ride.version, ...extra }, key)).ride;
}
async function confirm(customer, driver, ride) {
  ride = await step(driver, ride, 'claim');
  ride = await step(driver, ride, 'offers', { amountKobo: ride.suggestedFareKobo + 10000 });
  ride = await step(customer, ride, 'accept', { offerId: ride.negotiation.currentOffer.id });
  return step(customer, ride, 'confirm');
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
  email: actor.user.email, password: PASSWORD, deviceName: 'Parcel test phone',
})).credentials;
const login = async (actor) => ok(await actor.post('/api/auth/login', { email: actor.user.email, password: PASSWORD }));
async function fixture(t, options) {
  const h = await harness(t, options), actors = await participants(h), recipient = h.client(), outsider = h.client();
  await recipient.register('parcel-recipient'); await outsider.register('parcel-outsider');
  // Isolated mailbox-verification fixtures. These are not live email tests.
  for (const actor of [recipient, outsider]) h.db.prepare('INSERT INTO account_email_verifications VALUES (?,?,?)')
    .run(actor.user.id, actor.user.email, h.now);
  return { h, ...actors, recipient, outsider, ride: await book(actors.customer) };
}
function privateSnapshot(parcel, customer, driver, ride) {
  const forbiddenKeys = new Set(['pickup', 'pickupPin', 'pickupInstructions', 'customerId', 'driverId', 'email', 'phone',
    'fareKobo', 'suggestedFareKobo', 'amountKobo', 'negotiation', 'payment', 'chat', 'token', 'sessionToken']);
  const walk = (value) => {
    if (!value || typeof value !== 'object') return;
    for (const [key, child] of Object.entries(value)) { assert.equal(forbiddenKeys.has(key), false, `Private field: ${key}`); walk(child); }
  };
  walk(parcel);
  const json = JSON.stringify(parcel);
  for (const value of [customer.user.id, customer.user.email, driver.user.id, driver.user.email,
    delivery.pickupInstructions, ride.pickup.name, ride.trip?.pickupPin].filter(Boolean)) {
    assert.equal(json.includes(value), false, `Private value leaked: ${value}`);
  }
}

test('car courier booking, pickup, recipient tracking and verified delivery complete without exposing sender data', async (t) => {
  const { h, customer, driver, recipient, outsider, ride: requested } = await fixture(t);
  assert.equal(requested.service, 'delivery'); assert.equal(requested.vehicleCategory, 'standard');
  assert.equal(ok(await driver.send('/api/rides')).available.some((item) => item.id === requested.id), true);
  const created = ok(await create(customer, requested));
  let parcel = ok(await accept(recipient, created.token)).parcel;
  assert.equal(parcel.status, 'requested'); assert.equal(parcel.location, null); assert.equal(parcel.dropoffPin, null);
  let ride = await confirm(customer, driver, requested);
  const pickupPin = ride.trip.pickupPin, locationClient = randomUUID();
  const share = ok(await driver.send(`/api/rides/${ride.id}/location/start`, { method: 'POST', data: {},
    headers: { 'X-Location-Client': locationClient, 'Idempotency-Key': randomUUID() } })).share;
  const publish = () => driver.send(`/api/location-shares/${share.id}/position`, { method: 'POST',
    data: { sequence: 1, lat: 9.0765, lng: 7.3986, accuracy: 12, capturedAt: h.now },
    headers: { 'X-Location-Client': locationClient, 'Idempotency-Key': randomUUID() } });
  ok(await publish());
  parcel = await received(recipient, ride);
  assert.equal(parcel.status, 'booked'); assert.equal(parcel.location, null); assert.equal(parcel.dropoffPin, null);
  privateSnapshot(parcel, customer, driver, ride);
  ride = await step(driver, ride, 'depart'); ride = await step(driver, ride, 'arrive');
  assert.equal((await received(recipient, ride)).dropoffPin, null);
  ride = await step(driver, ride, 'start', { pickupPin });
  parcel = await received(recipient, ride);
  assert.equal(parcel.status, 'in_progress'); assert.match(parcel.dropoffPin, /^\d{6}$/);
  assert.equal(parcel.location.lat, 9.0765); assert.equal(parcel.location.lng, 7.3986);
  assert.equal(parcel.driver.name, driver.user.name); privateSnapshot(parcel, customer, driver, ride);
  h.advance(30000);
  assert.equal((await received(recipient, ride)).location, null, 'stale GPS must not appear to be the current parcel position');
  assert.equal(ok(await driver.send(`/api/rides/${ride.id}`)).ride.delivery.dropoffPin, undefined);
  assert.equal((await outsider.send(`/api/parcels/received/${ride.id}`)).status, 404);
  assert.equal((await recipient.send(`/api/rides/${ride.id}`)).status, 404);
  assert.equal((await recipient.post(`/api/rides/${ride.id}/complete`, { expectedVersion: ride.version, deliveryPin: parcel.dropoffPin })).status, 404);
  const key = randomUUID(), finish = { expectedVersion: ride.version, deliveryPin: parcel.dropoffPin };
  ride = ok(await driver.post(`/api/rides/${ride.id}/complete`, finish, key)).ride;
  assert.equal(ride.status, 'completed');
  assert.equal(ok(await driver.post(`/api/rides/${ride.id}/complete`, finish, key)).replayed, true);
  parcel = await received(recipient, ride);
  assert.equal(parcel.status, 'completed'); assert.equal(parcel.verifiedAt, h.now);
  assert.equal(parcel.location, null); assert.equal(parcel.dropoffPin, null);
  assert.equal(ok(await recipient.send('/api/parcels/received')).parcels.find((item) => item.rideId === ride.id).status, 'completed');
  assert.equal((await invite(customer, ride)).canCreate, false);
  assert.equal((await create(customer, ride, created.invitation.link.id)).status, 409);
  assert.equal(h.db.prepare('SELECT count(*) AS n FROM payments WHERE ride_id=?').get(ride.id).n, 1);
  const recipientRecord = ok(await recipient.send(base(ride) + '/operations')).operations;
  assert.equal(recipientRecord.state, 'delivered');
  assert.equal(recipientRecord.evidence.method, 'recipient_pin');
  assert.equal(recipientRecord.evidence.position, undefined, 'Recipients do not receive saved handover coordinates.');
  assert.equal(recipientRecord.evidence.locationRecorded, false, 'Old GPS is not invented as a handover position.');
});

test('parcel links are sender-only and bind one signed-in recipient without granting booking or payment authority', async (t) => {
  const { h, customer, driver, admin, recipient, outsider, ride: requested } = await fixture(t);
  let ride = await confirm(customer, driver, requested);
  assert.equal((await invite(customer, ride)).canCreate, true);
  for (const actor of [driver, admin, recipient, outsider]) {
    const status = actor === admin ? 403 : 404;
    assert.equal((await actor.send(base(ride) + '/invitation')).status, status);
    assert.equal((await create(actor, ride)).status, status);
    assert.equal((await actor.send(`/api/parcels/received/${ride.id}`)).status, status);
  }
  assert.equal((await h.client().send(base(ride) + '/invitation')).status, 401);
  const link = ok(await create(customer, ride));
  assert.equal((await accept(h.client(), link.token)).status, 401);
  for (const actor of [customer, driver]) assert.ok((await accept(actor, link.token)).status >= 400);
  const racing = await Promise.all([accept(recipient, link.token), accept(outsider, link.token)]);
  assert.deepEqual(racing.map((result) => result.status).sort(), [200, 404]);
  const winner = racing[0].status === 200 ? recipient : outsider, loser = winner === recipient ? outsider : recipient;
  assert.equal((await invite(customer, ride)).link.claimed, true);
  assert.equal((await received(winner, ride)).rideId, ride.id);
  assert.equal((await loser.send(`/api/parcels/received/${ride.id}`)).status, 404);
  assert.equal((await winner.send(`/api/parcels/received/${randomUUID()}`)).status, 404);
  for (const path of [`/api/rides/${ride.id}`, `/api/rides/${ride.id}/chat`, `/api/payments/rides/${ride.id}`]) {
    assert.equal((await winner.send(path)).status, 404);
  }
  for (const [action, data] of [['offers', { amountKobo: 450000 }], ['cancel', {}], ['start', { pickupPin: ride.trip.pickupPin }]]) {
    assert.equal((await winner.post(`/api/rides/${ride.id}/${action}`, { expectedVersion: ride.version, ...data })).status, 404);
  }
  privateSnapshot(await received(winner, ride), customer, driver, ride);
});

test('link creation and recipient acceptance retries never reissue secrets or attach another account', async (t) => {
  const { h, customer, recipient, outsider, ride } = await fixture(t, { persistent: true });
  const creationKey = randomUUID(), created = ok(await create(customer, ride, null, creationKey));
  assert.match(created.token, /^[a-f0-9]{64}$/);
  const replay = ok(await create(customer, ride, null, creationKey));
  assert.equal(replay.replayed, true); assert.equal(replay.token ?? null, null);
  assert.equal(replay.invitation.link.id, created.invitation.link.id);
  const acceptanceKey = randomUUID(), first = ok(await accept(recipient, created.token, acceptanceKey));
  assert.equal(first.parcel.rideId, ride.id);
  assert.equal(ok(await accept(recipient, created.token, acceptanceKey)).replayed, true);
  assert.equal(ok(await accept(recipient, created.token)).parcel.rideId, ride.id);
  assert.equal((await accept(outsider, created.token, acceptanceKey)).status, 404);
  assert.equal((await accept(recipient, 'f'.repeat(64), acceptanceKey)).body.error.code, 'KEY_REUSED');
  const tables = h.db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND (name LIKE 'parcel_%' OR name IN ('audit_events','idempotency'))").all();
  let digestFound = false;
  for (const { name } of tables) {
    const stored = JSON.stringify(h.db.prepare(`SELECT * FROM ${name}`).all());
    assert.equal(stored.includes(created.token), false, `${name} must not store a raw link token`);
    digestFound ||= stored.includes(createHash('sha256').update(created.token).digest('hex'));
  }
  assert.equal(digestFound, true, 'link secret is stored as a digest');
  await h.restart();
  assert.equal((await received(recipient, ride)).rideId, ride.id);
  assert.equal(ok(await accept(recipient, created.token, acceptanceKey)).replayed, true);
});

test('replacing and revoking parcel links immediately removes the former recipient and rejects stale commands', async (t) => {
  const { customer, recipient, outsider, ride } = await fixture(t);
  const first = ok(await create(customer, ride));
  ok(await accept(recipient, first.token));
  assert.equal((await create(customer, ride)).body.error.code, 'STALE_VERSION');
  const replacement = ok(await create(customer, ride, first.invitation.link.id, randomUUID(), outsider.user.email));
  assert.equal((await recipient.send(`/api/parcels/received/${ride.id}`)).status, 404);
  assert.deepEqual(ok(await recipient.send('/api/parcels/received')).parcels, []);
  assert.equal((await accept(outsider, first.token)).status, 404);
  ok(await accept(outsider, replacement.token));
  const current = (await invite(customer, ride)).link;
  const revoke = { linkId: current.id, expectedVersion: current.version };
  assert.equal((await customer.post(base(ride) + '/revoke', { ...revoke, expectedVersion: current.version + 1 })).body.error.code, 'STALE_VERSION');
  assert.equal((await customer.post(base(ride) + '/revoke', { linkId: first.invitation.link.id, expectedVersion: first.invitation.link.version })).body.error.code, 'STALE_VERSION');
  assert.equal((await outsider.post(base(ride) + '/revoke', revoke)).status, 404);
  const key = randomUUID(), result = ok(await customer.post(base(ride) + '/revoke', revoke, key));
  assert.equal(result.invitation.link.active, false);
  assert.equal(ok(await customer.post(base(ride) + '/revoke', revoke, key)).replayed, true);
  assert.equal((await outsider.send(`/api/parcels/received/${ride.id}`)).status, 404);
  assert.equal((await accept(recipient, replacement.token)).status, 404);
});

test('expiry closes unclaimed links while accepted parcel history survives cancellation without location or PIN', async (t) => {
  const { h, customer, driver, recipient, outsider, ride: requested } = await fixture(t);
  const first = ok(await create(customer, requested));
  h.advance(first.invitation.link.expiresAt - h.now);
  for (const actor of [customer, driver, recipient, outsider]) await login(actor);
  assert.equal((await accept(outsider, first.token)).status, 404);
  // The request may expire while a link ages; use a confirmed parcel for durable history.
  const original = ok(await customer.send(`/api/rides/${requested.id}`)).ride;
  if (!['expired', 'cancelled'].includes(original.status)) await step(customer, original, 'cancel');
  await driver.online();
  let ride = await confirm(customer, driver, await book(customer));
  const link = ok(await create(customer, ride)); ok(await accept(recipient, link.token));
  ride = await step(customer, ride, 'cancel');
  h.advance(link.invitation.link.expiresAt - h.now + 1);
  for (const actor of [customer, recipient, outsider]) await login(actor);
  const parcel = await received(recipient, ride);
  assert.equal(parcel.status, 'cancelled'); assert.equal(parcel.location, null); assert.equal(parcel.dropoffPin, null);
  assert.equal((await accept(outsider, link.token)).status, 404);
  assert.equal((await invite(customer, ride)).canCreate, false);
});

test('native parcel access uses bearer account membership and agrees with web acceptance and revocation', async (t) => {
  const { h, customer, recipient, outsider, driver, ride } = await fixture(t);
  const senderPhone = await phone(h, customer), receiverPhone = await phone(h, recipient), otherPhone = await phone(h, outsider);
  const path = `/parcels/${ride.id}`, receiverPath = `/parcels/received/${ride.id}`;
  assert.equal(ok(await native(h, path + '/invitation', senderPhone.accessToken)).invitation.canCreate, true);
  assert.equal((await native(h, path + '/invitation', undefined, undefined, undefined, { Cookie: customer.cookie })).status, 401);
  assert.equal((await native(h, path + '/invitation', senderPhone.accessToken, undefined, undefined, { Origin: h.base })).status, 403);
  assert.equal((await native(h, path + '/link', senderPhone.accessToken, { expectedLinkId: null }, '')).status, 400);
  const created = ok(await native(h, path + '/link', senderPhone.accessToken, { expectedLinkId: null, recipientEmail: recipient.user.email }));
  assert.equal((await native(h, '/parcels/accept', created.token, { token: created.token })).status, 401);
  const key = randomUUID(), accepted = ok(await native(h, '/parcels/accept', receiverPhone.accessToken, { token: created.token }, key));
  assert.equal(accepted.parcel.rideId, ride.id);
  assert.deepEqual(ok(await native(h, receiverPath, receiverPhone.accessToken)).parcel, await received(recipient, ride));
  assert.equal(ok(await native(h, '/parcels/received', receiverPhone.accessToken)).parcels[0].rideId, ride.id);
  assert.equal((await native(h, receiverPath, otherPhone.accessToken)).status, 404);
  assert.equal((await native(h, '/parcels/accept', otherPhone.accessToken, { token: created.token }, key)).status, 404);
  assert.equal((await native(h, `/journeys/${ride.id}`, receiverPhone.accessToken)).status, 404);
  privateSnapshot(accepted.parcel, customer, driver, ride);
  const rotated = ok(await native(h, '/auth/refresh', null, { refreshToken: receiverPhone.refreshToken })).credentials;
  assert.equal((await native(h, receiverPath, receiverPhone.accessToken)).status, 401);
  assert.equal(ok(await native(h, receiverPath, rotated.accessToken)).parcel.rideId, ride.id);
  const current = (await invite(customer, ride)).link;
  ok(await customer.post(base(ride) + '/revoke', { linkId: current.id, expectedVersion: current.version }));
  assert.equal((await native(h, receiverPath, rotated.accessToken)).status, 404);
  assert.deepEqual(ok(await native(h, '/parcels/received', rotated.accessToken)).parcels, []);
});

test('courier matching excludes unapproved or incompatible vehicles and the parcel recipient cannot deliver their own incoming parcel', async (t) => {
  const h = await harness(t), { customer, admin, drivers } = await participants(h, 2);
  const [recipientDriver, eligibleDriver] = drivers, unapproved = h.client(), motorcycle = h.client();
  await unapproved.register('unapproved-courier', 'driver'); await motorcycle.register('motorcycle-courier', 'driver');
  await submitApplication(fixtureApi(motorcycle), '2099-12-31', { ...DETAILS,
    vehicle: { ...DETAILS.vehicle, category: 'motorcycle', payloadKg: 20 } });
  await approveApplication(fixtureApi(admin), motorcycle.user.id); await motorcycle.online();
  let ride = await book(customer);
  h.db.prepare('INSERT INTO account_email_verifications VALUES (?,?,?)').run(recipientDriver.user.id, recipientDriver.user.email, h.now);
  const created = ok(await create(customer, ride, null, randomUUID(), recipientDriver.user.email)); ok(await accept(recipientDriver, created.token));
  for (const driver of [recipientDriver, unapproved, motorcycle]) {
    const list = await driver.send('/api/rides');
    if (list.status === 200) assert.equal(list.body.available.some((item) => item.id === ride.id), false);
    const claimed = await driver.post(`/api/rides/${ride.id}/claim`, { expectedVersion: ride.version });
    assert.ok(claimed.status >= 400, JSON.stringify(claimed.body));
  }
  assert.equal(ok(await eligibleDriver.send('/api/rides')).available.some((item) => item.id === ride.id), true);
  ride = await step(eligibleDriver, ride, 'claim');
  assert.equal(ride.driver.id, eligibleDriver.user.id);
  assert.equal((await received(recipientDriver, ride)).driver.name, eligibleDriver.user.name);
});

test('parcel actions reject invalid input, forged ownership and missing CSRF without granting access to ordinary passenger rides', async (t) => {
  const { h, customer, recipient, ride } = await fixture(t);
  assert.equal((await customer.send(base(ride) + '/link', { method: 'POST', data: { expectedLinkId: null },
    headers: { 'X-CSRF-Token': null, 'Idempotency-Key': randomUUID() } })).status, 403);
  for (const data of [{}, { expectedLinkId: 'invalid' }, { expectedLinkId: null, recipientId: recipient.user.id },
    { expectedLinkId: null, token: 'forged' }]) assert.equal((await customer.post(base(ride) + '/link', data)).status, 400);
  const created = ok(await create(customer, ride));
  for (const data of [{ token: created.token, recipientId: customer.user.id }, { token: created.token, rideId: ride.id }]) {
    assert.equal((await recipient.post('/api/parcels/accept', data)).status, 400);
  }
  for (const token of [null, '', 'wrong', 'f'.repeat(64)]) assert.ok((await accept(recipient, token)).status >= 400);
  assert.equal((await invite(customer, ride)).link.claimed, false);
  await step(customer, ride, 'cancel');
  const passenger = ok(await customer.post('/api/rides', route), 201).ride;
  assert.equal(passenger.service, 'ride');
  assert.equal((await customer.send(base(passenger) + '/invitation')).status, 404);
  assert.equal((await create(customer, passenger)).status, 404);
  assert.equal((await h.client().send('/api/parcels/received')).status, 401);
});

test('competing link replacement has one winner and per-parcel invitation limits cannot be reset through revocation', async (t) => {
  const { customer, recipient, ride } = await fixture(t);
  let current = ok(await create(customer, ride));
  const competing = await Promise.all([create(customer, ride, current.invitation.link.id), create(customer, ride, current.invitation.link.id)]);
  assert.deepEqual(competing.map((result) => result.status).sort(), [200, 409]);
  current = ok(competing.find((result) => result.status === 200));
  for (let i = 2; i < 30; i++) current = ok(await create(customer, ride, current.invitation.link.id));
  assert.equal((await create(customer, ride, current.invitation.link.id)).body.error.code, 'LINK_LIMIT');
  ok(await customer.post(base(ride) + '/revoke', { linkId: current.invitation.link.id, expectedVersion: current.invitation.link.version }));
  assert.equal((await accept(recipient, current.token)).status, 404);
  assert.equal((await create(customer, ride, current.invitation.link.id)).body.error.code, 'LINK_LIMIT');
});

test('native car courier booking and work contracts retain delivery details through recipient-verified completion', async (t) => {
  const h = await harness(t), { customer, driver } = await participants(h, 1, { online: false });
  const recipient = h.client(); await recipient.register('native-car-recipient');
  h.db.prepare('INSERT INTO account_email_verifications VALUES (?,?,?)').run(recipient.user.id, recipient.user.email, h.now);
  const sender = await phone(h, customer), courier = await phone(h, driver), receiver = await phone(h, recipient), clientId = randomUUID();
  ok(await native(h, `/work/online?clientId=${clientId}`, courier.accessToken, { mode: 'sample', areaId: 'wuse-ii' }));
  let ride = parseBookingRide(ok(await native(h, '/booking/requests', sender.accessToken, { ...route, vehicleCategory: 'standard', delivery }))).ride;
  assert.equal(ride.service, 'delivery'); assert.equal(ride.vehicleCategory, 'standard');
  assert.equal(ride.delivery.description, delivery.description);
  const current = parseActivity(ok(await native(h, '/activity?mode=customer', sender.accessToken)), 'customer');
  assert.equal(current.current.find((item) => item.id === ride.id).service, 'delivery');
  const work = parseWork(ok(await native(h, `/work?clientId=${clientId}`, courier.accessToken)));
  assert.equal(work.available.find((item) => item.id === ride.id).service, 'delivery');
  const created = ok(await native(h, `/parcels/${ride.id}/link`, sender.accessToken, { expectedLinkId: null, recipientEmail: recipient.user.email }));
  ok(await native(h, '/parcels/accept', receiver.accessToken, { token: created.token }));
  const action = async (credentials, name, extra = {}) => {
    ride = parseJourney(ok(await native(h, `/journeys/${ride.id}/${name}`, credentials.accessToken,
      { expectedVersion: ride.version, ...extra }))).ride;
  };
  await action(courier, 'claim'); await action(sender, 'propose', { amountKobo: ride.suggestedFareKobo + 1 });
  await action(courier, 'accept', { offerId: ride.offer.id }); await action(sender, 'confirm');
  const pickupPin = ride.pickupPin;
  const share = ok(await native(h, `/tracking/rides/${ride.id}/start?clientId=${clientId}`, courier.accessToken, {})).share;
  ok(await native(h, `/tracking/shares/${share.id}/position?clientId=${clientId}`, courier.accessToken,
    { sequence: 1, lat: 9.08, lng: 7.4, accuracy: 10, capturedAt: h.now }));
  await action(courier, 'depart'); await action(courier, 'arrive'); await action(courier, 'start', { pickupPin });
  const parcel = ok(await native(h, `/parcels/received/${ride.id}`, receiver.accessToken)).parcel;
  assert.match(parcel.dropoffPin, /^\d{6}$/); assert.equal(ride.delivery.dropoffPin, undefined);
  await action(courier, 'complete', { deliveryPin: parcel.dropoffPin });
  assert.equal(ride.status, 'completed'); assert.equal(ride.service, 'delivery');
  const completed = ok(await native(h, `/parcels/received/${ride.id}`, receiver.accessToken)).parcel;
  assert.equal(completed.status, 'completed'); assert.equal(completed.dropoffPin, null);
  const history = parseActivity(ok(await native(h, '/activity?mode=customer', sender.accessToken)), 'customer');
  assert.equal(history.history.find((item) => item.id === ride.id).service, 'delivery');
});

// Loopback-only integration with the disposable harness; no hosted accounts or providers.
test('sender-authorized return closes the parcel without recording successful delivery', async t => {
  const { h, customer, driver, recipient, ride: requested } = await fixture(t);
  let ride = await confirm(customer, driver, requested);
  const pickupPin = ride.trip.pickupPin;
  await driver.shareTripLocation(ride.id);
  ride = await step(driver, ride, 'depart'); ride = await step(driver, ride, 'arrive');
  ride = await step(driver, ride, 'start', { pickupPin });
  const path = `/api/parcels/${ride.id}/operations`;
  const command = async (actor, action, expectedVersion, extra = {}) => ok(await actor.post(path, { action, expectedVersion, ...extra }));
  await command(driver, 'report', 0, { reason: 'recipient_unavailable' });
  await command(driver, 'request_return', 1);
  assert.equal((await driver.post(path, { action: 'authorize_return', expectedVersion: 2, note: 'Not the sender.' })).status, 409);
  await command(customer, 'authorize_return', 2, { note: 'Return the sealed parcel to me.' });
  const result = await command(customer, 'confirm_return', 3, { confirmation: 'RECEIVED' });
  assert.equal(result.operations.state, 'returned'); assert.equal(result.operations.evidence, null);
  ride = ok(await customer.send(`/api/rides/${ride.id}`)).ride;
  assert.equal(ride.status, 'cancelled'); assert.equal(ride.delivery.verifiedAt, null);
  assert.equal(ok(await customer.send(`/api/rides/${ride.id}/location`)).share, null);
  assert.equal(h.db.prepare('SELECT count(*) AS n FROM payments WHERE ride_id=?').get(ride.id).n, 0);
  assert.equal((await recipient.send(path)).status, 404, 'A parcel recipient still needs an accepted invitation.');
});

test('loopback parcel handover writes a timestamped evidence record without exposing the delivery code', async t => {
  const { h, customer, driver, ride: requested } = await fixture(t);
  let ride = await confirm(customer, driver, requested); const pickupPin = ride.trip.pickupPin;
  await driver.shareTripLocation(ride.id);
  ride = await step(driver, ride, 'depart'); ride = await step(driver, ride, 'arrive');
  ride = await step(driver, ride, 'start', { pickupPin });
  const pin = ride.delivery.dropoffPin ?? ok(await customer.send(`/api/rides/${ride.id}`)).ride.delivery.dropoffPin;
  ride = await step(driver, ride, 'complete', { deliveryPin: pin });
  const record = ok(await customer.send(`/api/parcels/${ride.id}/operations`)).operations;
  assert.equal(record.state, 'delivered'); assert.equal(record.evidence.verifiedAt, h.now);
  assert.equal(record.evidence.method, 'recipient_pin'); assert.equal(record.evidence.position.lat, 9.08);
  assert.equal(record.evidence.locationRecorded, true);
  assert.equal(JSON.stringify(record).includes(pin), false);
});

test('disposable-database evidence failure rolls back handover and permits one same-key retry', async t => {
  const { h, customer, driver, ride: requested } = await fixture(t);
  let ride = await confirm(customer, driver, requested); const pickupPin = ride.trip.pickupPin;
  await driver.shareTripLocation(ride.id);
  ride = await step(driver, ride, 'depart'); ride = await step(driver, ride, 'arrive');
  ride = await step(driver, ride, 'start', { pickupPin });
  const pin = ok(await customer.send(`/api/rides/${ride.id}`)).ride.delivery.dropoffPin;
  const path = `/api/rides/${ride.id}/complete`, key = randomUUID(), payload = { expectedVersion: ride.version, deliveryPin: pin };
  h.db.exec("CREATE TRIGGER fixture_evidence_failure BEFORE INSERT ON delivery_handover_evidence BEGIN SELECT RAISE(ABORT, 'fixture storage failure'); END");
  assert.equal((await driver.post(path, payload, key)).status, 500);
  assert.equal(ok(await customer.send(`/api/rides/${ride.id}`)).ride.status, 'in_progress');
  assert.equal(h.db.prepare('SELECT count(*) AS n FROM delivery_handover_evidence').get().n, 0);
  assert.equal(h.db.prepare('SELECT count(*) AS n FROM payments WHERE ride_id=?').get(ride.id).n, 0);
  h.db.exec('DROP TRIGGER fixture_evidence_failure');
  assert.equal(ok(await driver.post(path, payload, key)).ride.status, 'completed');
  assert.equal(ok(await driver.post(path, payload, key)).replayed, true);
  assert.equal(h.db.prepare('SELECT count(*) AS n FROM delivery_handover_evidence').get().n, 1);
});

test('disposable-database return failure rolls back trip closure and tracking cleanup', async t => {
  const { h, customer, driver, ride: requested } = await fixture(t);
  let ride = await confirm(customer, driver, requested); const pickupPin = ride.trip.pickupPin;
  await driver.shareTripLocation(ride.id);
  ride = await step(driver, ride, 'depart'); ride = await step(driver, ride, 'arrive');
  ride = await step(driver, ride, 'start', { pickupPin });
  const path = `/api/parcels/${ride.id}/operations`;
  ok(await customer.post(path, { action: 'request_return', expectedVersion: 0 }));
  ok(await customer.post(path, { action: 'authorize_return', expectedVersion: 1, note: 'Return the fixture parcel.' }));
  const key = randomUUID(), payload = { action: 'confirm_return', expectedVersion: 2, confirmation: 'RECEIVED' };
  h.db.exec("CREATE TRIGGER fixture_return_failure BEFORE INSERT ON delivery_exception_events WHEN NEW.kind='return_received' BEGIN SELECT RAISE(ABORT, 'fixture storage failure'); END");
  assert.equal((await customer.post(path, payload, key)).status, 500);
  assert.equal(ok(await customer.send(`/api/rides/${ride.id}`)).ride.status, 'in_progress');
  assert.equal(ok(await customer.send(path)).operations.state, 'return_authorized');
  assert.equal(ok(await customer.send(`/api/rides/${ride.id}/location`)).share.active, true);
  h.db.exec('DROP TRIGGER fixture_return_failure');
  assert.equal(ok(await customer.post(path, payload, key)).operations.state, 'returned');
  assert.equal(ok(await customer.post(path, payload, key)).replayed, true);
  assert.equal(ok(await customer.send(`/api/rides/${ride.id}/location`)).share, null);
});
