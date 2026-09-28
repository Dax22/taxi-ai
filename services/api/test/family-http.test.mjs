import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { harness, participants, requestRide, claimRide, PASSWORD } from './helpers.mjs';
import { openDatabase, SCHEMA_VERSION } from '../src/infrastructure/database.mjs';
import { saveSnapshot } from '../src/infrastructure/database-snapshot.mjs';
import { createApplication } from '../src/application.mjs';
import { removeFamilyFixtureTables } from './migration-fixtures.mjs';

const ok = (response, status = 200) => { assert.equal(response.status, status, JSON.stringify(response.body)); return response.body; };
const family = async actor => ok(await actor.send('/api/family')).family;
const command = (actor, action, data, key) => actor.post(`/api/family/${action}`, data, key);
const points = { pickup: { lat: 9.0765, lng: 7.3986, name: 'Family test pickup' }, destination: { lat: 9.09, lng: 7.45, name: 'Family test destination' } };
const mapProvider = { mode: 'community', tileOrigin: 'https://tile.openstreetmap.org',
  describe: () => ({ enabled: true, mode: 'community', tiles: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png' }),
  search: async () => [points.pickup, points.destination],
  route: async (a, b) => ({ distanceMeters: 7000, durationSeconds: 1200, coordinates: [[a.lng, a.lat], [7.42, 9.08], [b.lng, b.lat]] }),
};
async function step(actor, ride, action, extra = {}) {
  return ok(await actor.post(`/api/rides/${ride.id}/${action}`, { expectedVersion: ride.version, ...extra })).ride;
}
async function booked(h, actors, { routed = false, guest = false, delivery = false } = {}) {
  let ride;
  if (routed) {
    const quote = ok(await actors.customer.post('/api/locations/quotes', points), 201).quote;
    ride = ok(await actors.customer.post('/api/rides', { quoteId: quote.id }), 201).ride;
  } else if (delivery) {
    ride = ok(await actors.customer.post('/api/rides', { pickupId: 'wuse-ii', destinationId: 'maitama', vehicleCategory: 'standard',
      delivery: { description: 'Sealed test parcel', weightKg: 2, recipientName: 'Fictional parcel recipient' } }), 201).ride;
  } else if (guest) {
    ride = ok(await actors.customer.post('/api/rides', { pickupId: 'wuse-ii', destinationId: 'maitama',
      passenger: { kind: 'guest', name: 'Adult guest', phone: '+2348000000088', consent: true } }), 201).ride;
  } else ride = await requestRide(actors.customer);
  ride = await claimRide(actors.driver, ride);
  ride = await step(actors.driver, ride, 'offers', { amountKobo: 470000 });
  ride = await step(actors.customer, ride, 'accept', { offerId: ride.negotiation.currentOffer.id });
  return step(actors.customer, ride, 'confirm');
}
async function invite(owner, observer, key) {
  const before = new Set((await family(owner)).contacts.map(contact => contact.id));
  const result = ok(await command(owner, 'invite', { email: observer.user.email, adultConfirmed: true }, key));
  return result.family.contacts.find(contact => !before.has(contact.id));
}
async function link(owner, observer) {
  const contact = await invite(owner, observer);
  const accepted = ok(await command(observer, 'accept', { contactId: contact.id, expectedVersion: contact.version, adultConfirmed: true }));
  return accepted.family.contacts.find(row => row.id === contact.id);
}
async function grant(owner, observer, ride) {
  const contact = await link(owner, observer);
  const result = ok(await command(owner, 'share', { contactId: contact.id, rideId: ride.id }));
  return { contact, trip: result.family.trips.find(row => row.rideId === ride.id && row.relationship === 'sharing_with') };
}
const view = async (actor, trip) => ok(await actor.send(`/api/family/trips/${trip.shareId}`)).trip;
async function native(h, path, token, data, { key = randomUUID(), headers = {} } = {}) {
  const response = await fetch(h.base + '/api/mobile/v1' + path, { method: data === undefined ? 'GET' : 'POST',
    headers: { 'Content-Type': 'application/json', 'Idempotency-Key': key, ...(token ? { Authorization: `Bearer ${token}` } : {}), ...headers },
    ...(data === undefined ? {} : { body: JSON.stringify(data) }) });
  return { status: response.status, body: await response.json(), headers: response.headers };
}
async function phone(h, actor) {
  return ok(await native(h, '/auth/login', null, { email: actor.user.email, password: PASSWORD, deviceName: 'Family test phone' })).credentials;
}
async function people(t, options = {}) {
  const h = await harness(t, { mapProvider, ...options }), actors = await participants(h);
  const observer = h.client(), outsider = h.client();
  await observer.register('family-observer'); await outsider.register('family-outsider');
  return { h, ...actors, observer, outsider };
}
function noPrivateTripFields(value) {
  if (!value || typeof value !== 'object') return;
  for (const [key, child] of Object.entries(value)) {
    assert.ok(!['pickupPin', 'negotiation', 'agreement', 'suggestedFareKobo', 'amountKobo', 'messages', 'phone', 'passwordHash', 'password_hash', 'sessionToken'].includes(key), key);
    noPrivateTripFields(child);
  }
}

test('family invitations require both adult acknowledgements and never silently enroll a later account', async t => {
  const h = await harness(t), owner = h.client(), recipient = h.client(), other = h.client();
  await owner.register('invite-owner'); await recipient.register('invite-recipient'); await other.register('invite-other');
  assert.equal((await family(owner)).adultConfirmed, false);
  for (const data of [{ email: recipient.user.email }, { email: recipient.user.email, adultConfirmed: false },
    { email: recipient.user.email, adultConfirmed: 'true' }, { email: recipient.user.email, adultConfirmed: true, observerId: recipient.user.id }]) {
    assert.equal((await command(owner, 'invite', data)).status, 400);
  }
  const first = await invite(owner, recipient);
  assert.equal(first.status, 'pending'); assert.equal(first.direction, 'sharing_with');
  assert.equal((await family(owner)).adultConfirmed, true);
  assert.equal((await family(recipient)).adultConfirmed, false);
  assert.equal((await command(other, 'accept', { contactId: first.id, expectedVersion: first.version, adultConfirmed: true })).status, 404);
  assert.equal((await command(recipient, 'accept', { contactId: first.id, expectedVersion: first.version, adultConfirmed: false })).status, 400);
  const accepted = ok(await command(recipient, 'accept', { contactId: first.id, expectedVersion: first.version, adultConfirmed: true }));
  assert.equal(accepted.family.adultConfirmed, true);
  assert.equal(accepted.family.contacts.find(row => row.id === first.id).direction, 'watching');
  assert.equal((await family(owner)).trips.length, 0); assert.equal((await family(recipient)).trips.length, 0);
  const result = ok(await command(owner, 'invite', { email: 'later-member@example.test', adultConfirmed: true }));
  const pending = result.family.contacts.find(row => row.status === 'pending');
  assert.ok(pending); assert.equal(pending.status, first.status);
  const later = h.client(); await later.register('later-member');
  assert.equal((await family(later)).contacts.length, 0);
  assert.equal((await command(later, 'accept', { contactId: pending.id, expectedVersion: pending.version, adultConfirmed: true })).status, 404);
  assert.equal((await family(owner)).contacts.find(row => row.id === pending.id).status, 'pending');
});

test('family browser CSRF and native bearer boundaries agree without granting a public trip capability', async t => {
  const f = await people(t), ride = await booked(f.h, f), { trip } = await grant(f.customer, f.observer, ride);
  assert.equal((await f.h.client().send('/api/family')).status, 401);
  assert.equal((await f.h.client().send(`/api/family/trips/${trip.shareId}`)).status, 401);
  assert.equal((await f.outsider.send(`/api/family/trips/${trip.shareId}`)).status, 404);
  const path = '/api/family/request-check-in', data = { shareId: trip.shareId, expectedVersion: trip.version };
  assert.equal((await f.observer.send(path, { method: 'POST', data, headers: { 'X-CSRF-Token': null, 'Idempotency-Key': randomUUID() } })).status, 403);
  assert.equal((await f.observer.send(path, { method: 'POST', data, headers: { Origin: 'https://unrelated.invalid', 'Idempotency-Key': randomUUID() } })).status, 403);
  assert.equal((await f.observer.send(path, { method: 'POST', data, headers: { 'Idempotency-Key': null } })).status, 400);
  const credentials = await phone(f.h, f.observer);
  const mobile = ok(await native(f.h, '/family', credentials.accessToken));
  assert.equal(mobile.family.trips.length, 1);
  assert.equal((await native(f.h, `/family/trips/${trip.shareId}`, credentials.accessToken)).status, 200);
  assert.equal((await native(f.h, '/family', null, undefined, { headers: { Cookie: f.observer.cookie } })).status, 401);
  assert.equal((await native(f.h, '/family', credentials.accessToken, undefined, { headers: { Origin: f.h.base } })).status, 403);
  assert.equal((await native(f.h, '/family/request-check-in', credentials.accessToken, data, { key: '' })).status, 400);
  const unrelated = await phone(f.h, f.outsider);
  assert.equal((await native(f.h, `/family/trips/${trip.shareId}`, unrelated.accessToken)).status, 404);
  for (const suffix of ['?userId=' + f.customer.user.id, '?limit=100000', '?before=invalid']) {
    assert.equal((await f.observer.send('/api/family' + suffix)).status, 400);
  }
  assert.equal((await f.observer.send('/api/family')).headers.get('cache-control'), 'no-store');
});

test('family viewing requires a per-trip grant and never transfers fare, PIN, chat, payment or trip controls', async t => {
  const f = await people(t), contact = await link(f.customer, f.observer);
  let ride = await requestRide(f.customer);
  assert.equal((await command(f.customer, 'share', { contactId: contact.id, rideId: ride.id })).status, 409);
  ride = await claimRide(f.driver, ride);
  ride = await step(f.driver, ride, 'offers', { amountKobo: 470000 });
  ride = await step(f.customer, ride, 'accept', { offerId: ride.negotiation.currentOffer.id });
  ride = await step(f.customer, ride, 'confirm');
  assert.equal((await family(f.observer)).trips.length, 0);
  const result = ok(await command(f.customer, 'share', { contactId: contact.id, rideId: ride.id }));
  const trip = result.family.trips.find(row => row.rideId === ride.id);
  noPrivateTripFields(await family(f.observer)); noPrivateTripFields(await view(f.observer, trip));
  for (const actor of [f.observer, f.outsider]) {
    for (const endpoint of [`/api/rides/${ride.id}`, `/api/rides/${ride.id}/chat`, `/api/payments/rides/${ride.id}`, `/api/rides/${ride.id}/location`]) {
      assert.equal((await actor.send(endpoint)).status, 404, endpoint);
    }
    for (const [action, extra] of [['offers', { amountKobo: 500000 }], ['accept', { offerId: ride.negotiation.currentOffer.id }],
      ['confirm', {}], ['cancel', {}], ['start', { pickupPin: ride.trip.pickupPin }]]) {
      assert.equal((await actor.post(`/api/rides/${ride.id}/${action}`, { expectedVersion: ride.version, ...extra })).status, 404, action);
    }
  }
  const credentials = await phone(f.h, f.observer);
  assert.equal((await native(f.h, `/journeys/${ride.id}`, credentials.accessToken)).status, 404);
  assert.equal((await native(f.h, `/journeys/${ride.id}/propose`, credentials.accessToken, { expectedVersion: ride.version, amountKobo: 1 })).status, 404);
  assert.equal((await native(f.h, `/journeys/${ride.id}/chat/messages`, credentials.accessToken, { body: 'Unwanted observer message' })).status, 404);
  assert.equal((await command(f.observer, 'share', { contactId: contact.id, rideId: ride.id })).status, 404);
  assert.equal((await command(f.observer, 'respond', { shareId: trip.shareId, expectedVersion: trip.version, response: 'arrived' })).status, 403);
});

test('family invitations and shares replay current permissions and stale versions cannot undo a revocation', async t => {
  const f = await people(t), ride = await booked(f.h, f), key = randomUUID();
  const invited = await invite(f.customer, f.observer, key);
  const inviteData = { email: f.observer.user.email, adultConfirmed: true };
  assert.equal(ok(await command(f.customer, 'invite', inviteData, key)).replayed, true);
  assert.equal((await command(f.customer, 'invite', { ...inviteData, email: f.outsider.user.email }, key)).body.error.code, 'KEY_REUSED');
  const accept = { contactId: invited.id, expectedVersion: invited.version, adultConfirmed: true };
  const accepted = ok(await command(f.observer, 'accept', accept)).family.contacts.find(row => row.id === invited.id);
  const shareData = { contactId: accepted.id, rideId: ride.id }, shareKey = randomUUID();
  const shared = ok(await command(f.customer, 'share', shareData, shareKey)), trip = shared.family.trips.find(row => row.rideId === ride.id);
  assert.equal(ok(await command(f.customer, 'share', shareData, shareKey)).replayed, true);
  const stale = await command(f.customer, 'stop-sharing', { shareId: trip.shareId, expectedVersion: trip.version + 1 });
  assert.equal(stale.body.error.code, 'STALE_VERSION');
  const revocation = { shareId: trip.shareId, expectedVersion: trip.version }, stopKey = randomUUID();
  ok(await command(f.customer, 'stop-sharing', revocation, stopKey));
  assert.equal((await f.observer.send(`/api/family/trips/${trip.shareId}`)).status, 404);
  assert.equal((await family(f.observer)).trips.length, 0);
  assert.ok(!(await family(f.observer)).inbox.some(event => event.shareId === trip.shareId));
  const replay = ok(await command(f.customer, 'share', shareData, shareKey));
  assert.equal(replay.replayed, true);
  assert.equal((await f.observer.send(`/api/family/trips/${trip.shareId}`)).status, 404);
  assert.equal(ok(await command(f.customer, 'stop-sharing', revocation, stopKey)).replayed, true);
  const renewed = ok(await command(f.customer, 'share', shareData));
  const newTrip = renewed.family.trips.find(row => row.rideId === ride.id && row.sharingActive);
  assert.ok(newTrip); assert.notEqual(newTrip.shareId, trip.shareId);
  assert.equal((await command(f.customer, 'revoke-contact', { contactId: accepted.id, expectedVersion: invited.version })).body.error.code, 'STALE_VERSION');
  ok(await command(f.observer, 'revoke-contact', { contactId: accepted.id, expectedVersion: accepted.version }));
  assert.equal((await f.observer.send(`/api/family/trips/${newTrip.shareId}`)).status, 404);
  assert.ok(!(await family(f.observer)).inbox.some(event => event.shareId));
  assert.equal((await command(f.customer, 'share', shareData)).status, 404);
});

test('family vehicle location expires honestly and driver completion remains distinct from passenger safe arrival', async t => {
  const f = await people(t), initial = await booked(f.h, f, { routed: true }), { trip } = await grant(f.customer, f.observer, initial);
  const clientId = randomUUID();
  const positionCommand = (path, data) => f.driver.send(path, { method: 'POST', data,
    headers: { 'X-Location-Client': clientId, 'Idempotency-Key': randomUUID() } });
  assert.equal((await view(f.observer, trip)).location, null);
  const sharing = ok(await positionCommand(`/api/rides/${initial.id}/location/start`, {})).share;
  ok(await positionCommand(`/api/location-shares/${sharing.id}/position`, {
    sequence: 1, lat: points.pickup.lat, lng: points.pickup.lng, accuracy: 12, capturedAt: f.h.now,
  }));
  const live = await view(f.observer, trip);
  assert.equal(live.location.source, 'driver_shared'); assert.equal(live.location.capturedAt, f.h.now);
  assert.equal(live.location.accuracy, 12); assert.equal(live.location.lat, points.pickup.lat); assert.equal(live.location.stale, false);
  assert.equal(live.driver.name, f.driver.user.name); assert.equal(live.passengerName, f.customer.user.name);
  assert.equal(live.pickup, initial.pickup.name); noPrivateTripFields(live);
  f.h.advance(30_000); assert.equal((await view(f.observer, trip)).location.stale, true);
  f.h.advance(30_000); assert.equal((await view(f.observer, trip)).location, null);
  let ride = initial;
  for (const action of ['depart', 'arrive', 'start']) ride = await step(f.driver, ride, action, action === 'start' ? { pickupPin: initial.trip.pickupPin } : {});
  const ongoing = await view(f.customer, trip);
  assert.equal((await command(f.customer, 'respond', { shareId: trip.shareId, expectedVersion: ongoing.version, response: 'arrived' })).status, 409);
  ride = await step(f.driver, ride, 'complete');
  const completed = await view(f.observer, trip);
  assert.equal(completed.status, 'completed'); assert.equal(completed.sharingActive, false); assert.equal(completed.safeArrivalAt, null);
  for (const field of ['location', 'driver', 'pickup', 'destination', 'passengerName']) assert.equal(Object.hasOwn(completed, field), false, field);
  assert.equal(f.h.db.prepare('SELECT position_json FROM location_shares WHERE id=?').get(sharing.id).position_json, null);
  const ownerView = await view(f.customer, trip); assert.equal(ownerView.canConfirmArrival, true);
  const key = randomUUID(), response = { shareId: trip.shareId, expectedVersion: ownerView.version, response: 'arrived' };
  ok(await command(f.customer, 'respond', response, key));
  assert.equal((await view(f.observer, trip)).safeArrivalAt, f.h.now);
  const notices = (await family(f.observer)).inbox;
  assert.equal(notices.filter(event => event.kind === 'completed').length, 1);
  assert.equal(notices.filter(event => event.kind === 'safe_arrival').length, 1);
  assert.equal(ok(await command(f.customer, 'respond', response, key)).replayed, true);
  assert.equal((await family(f.observer)).inbox.filter(event => event.kind === 'safe_arrival').length, 1);
  f.h.advance(24 * 60 * 60_000);
  ok(await f.observer.post('/api/auth/login', { email: f.observer.user.email, password: PASSWORD }));
  assert.equal((await f.observer.send(`/api/family/trips/${trip.shareId}`)).status, 404);
  assert.equal((await family(f.observer)).trips.length, 0);
  assert.ok(!(await family(f.observer)).inbox.some(event => event.shareId === trip.shareId));
});

test('check-ins use one cooldown across all observers and current versions make concurrent changes safe', async t => {
  const f = await people(t), ride = await booked(f.h, f), first = await grant(f.customer, f.observer, ride);
  const secondContact = await link(f.customer, f.outsider);
  ok(await command(f.customer, 'share', { contactId: secondContact.id, rideId: ride.id }));
  const secondTrip = (await family(f.outsider)).trips[0], firstTrip = await view(f.observer, first.trip);
  const requests = [[f.observer, firstTrip], [f.outsider, secondTrip]];
  const results = await Promise.all(requests.map(([actor, trip]) => command(actor, 'request-check-in', { shareId: trip.shareId, expectedVersion: trip.version })));
  assert.deepEqual(results.map(result => result.status).sort(), [200, 409]);
  const secondCurrent = await view(f.outsider, secondTrip);
  const tooSoon = await command(f.outsider, 'request-check-in', { shareId: secondTrip.shareId, expectedVersion: secondCurrent.version });
  assert.equal(tooSoon.status, 429); assert.equal(tooSoon.body.error.code, 'FAMILY_COOLDOWN');
  assert.equal((await family(f.customer)).inbox.filter(event => event.kind === 'check_in').length, 1);
  let current = await view(f.customer, first.trip);
  const help = { shareId: current.shareId, expectedVersion: current.version, response: 'help' }, helpKey = randomUUID();
  ok(await command(f.customer, 'respond', help, helpKey));
  assert.equal(ok(await command(f.customer, 'respond', help, helpKey)).replayed, true);
  for (const observer of [f.observer, f.outsider]) {
    const state = await family(observer);
    assert.equal(state.inbox.filter(event => event.kind === 'help').length, 1);
    assert.equal(state.trips[0].checkIn.response, 'help');
  }
  current = await view(f.customer, first.trip);
  assert.equal((await command(f.customer, 'respond', { shareId: current.shareId, expectedVersion: current.version, response: 'okay' })).body.error.code, 'FAMILY_COOLDOWN');
  f.h.advance(60_000);
  ok(await command(f.customer, 'respond', { shareId: current.shareId, expectedVersion: current.version, response: 'okay' }));
  assert.equal((await view(f.observer, first.trip)).checkIn.response, 'okay');
  f.h.advance(240_000);
  const later = await view(f.outsider, secondTrip);
  assert.equal(later.canRequestCheckIn, true);
  ok(await command(f.outsider, 'request-check-in', { shareId: later.shareId, expectedVersion: later.version }));
  assert.equal((await family(f.customer)).inbox.filter(event => event.kind === 'check_in').length, 2);
});

test('family events invalidate only authorized accounts and acknowledging an event never reveals another inbox', async t => {
  const h = await harness(t), owner = h.client(), observer = h.client(), stranger = h.client();
  await owner.register('revisions-owner'); await observer.register('revisions-observer'); await stranger.register('revisions-stranger');
  const cursor = async actor => ok(await actor.send('/api/events?wait=0')).cursor;
  const before = await Promise.all([owner, observer, stranger].map(cursor));
  await invite(owner, observer);
  const after = await Promise.all([owner, observer, stranger].map(cursor));
  assert.ok(BigInt(after[0]) > BigInt(before[0])); assert.ok(BigInt(after[1]) > BigInt(before[1])); assert.equal(after[2], before[2]);
  const event = (await family(observer)).inbox.find(row => row.kind === 'invitation'); assert.ok(event);
  assert.equal(event.state, 'saved'); assert.equal(event.acknowledgedAt, null);
  assert.equal((await command(stranger, 'acknowledge', { eventId: event.id })).status, 404);
  assert.equal((await command(owner, 'acknowledge', { eventId: event.id })).status, 404);
  ok(await command(observer, 'acknowledge', { eventId: event.id }));
  const acknowledged = (await family(observer)).inbox.find(row => row.id === event.id);
  assert.equal(acknowledged.state, 'acknowledged'); assert.equal(acknowledged.acknowledgedAt, h.now);
  assert.equal(await cursor(owner), after[0]); assert.equal(await cursor(stranger), after[2]);
  assert.ok(BigInt(await cursor(observer)) > BigInt(after[1]));
  assert.deepEqual(Object.keys(ok(await observer.send('/api/events?wait=0'))).sort(), ['changed', 'cursor', 'serverNow']);
});

test('family invitations are bounded and guest passengers or car parcels cannot be enrolled through the booker account', async t => {
  const h = await harness(t), owner = h.client(); await owner.register('bounded-owner');
  for (let index = 0; index < 5; index++) ok(await command(owner, 'invite', { email: `fictional-${index}@example.test`, adultConfirmed: true }));
  const sixth = await command(owner, 'invite', { email: 'fictional-over-limit@example.test', adultConfirmed: true });
  assert.equal(sixth.status, 409); assert.equal(sixth.body.error.code, 'FAMILY_LIMIT');
  assert.equal((await family(owner)).contacts.length, 5);
  const f = await people(t), contact = await link(f.customer, f.observer), guest = await booked(f.h, f, { guest: true });
  assert.equal((await command(f.customer, 'share', { contactId: contact.id, rideId: guest.id })).status, 409);
  assert.equal((await family(f.customer)).availableTrips.length, 0);
  assert.equal((await family(f.observer)).trips.length, 0);
  await step(f.customer, guest, 'cancel');
  const parcel = await booked(f.h, f, { delivery: true });
  assert.equal(parcel.vehicleCategory, 'standard'); assert.equal(parcel.service, 'delivery');
  assert.equal((await family(f.customer)).availableTrips.length, 0);
  assert.equal((await command(f.customer, 'share', { contactId: contact.id, rideId: parcel.id })).status, 409);
  assert.equal((await family(f.observer)).trips.length, 0);
});

test('a failed family command rolls back sharing, inbox events and participant revisions together', async t => {
  const f = await people(t), ride = await booked(f.h, f), contact = await link(f.customer, f.observer);
  const snapshots = new Map(['family_shares', 'family_trip_state', 'family_events', 'family_commands', 'account_revisions']
    .map(table => [table, f.h.db.prepare(`SELECT * FROM ${table}`).all()]));
  const data = { contactId: contact.id, rideId: ride.id }, key = randomUUID();
  f.h.db.exec("CREATE TRIGGER fail_family_command BEFORE INSERT ON family_commands BEGIN SELECT RAISE(ABORT,'fixture-failure'); END");
  assert.equal((await command(f.customer, 'share', data, key)).status, 500);
  for (const [table, before] of snapshots) assert.deepEqual(f.h.db.prepare(`SELECT * FROM ${table}`).all(), before, table);
  assert.equal((await family(f.observer)).trips.length, 0);
  f.h.db.exec('DROP TRIGGER fail_family_command');
  assert.equal(ok(await command(f.customer, 'share', data, key)).replayed, false);
  assert.equal((await family(f.observer)).trips.length, 1);
});

test('passengers can escalate to help immediately after an okay response and contacts only see a generic cancellation afterwards', async t => {
  const f = await people(t), ride = await booked(f.h, f), { trip } = await grant(f.customer, f.observer, ride);
  let current = await view(f.customer, trip);
  ok(await command(f.customer, 'respond', { shareId: trip.shareId, expectedVersion: current.version, response: 'okay' }));
  current = await view(f.customer, trip);
  assert.equal(current.canRequestHelp, true);
  ok(await command(f.customer, 'respond', { shareId: trip.shareId, expectedVersion: current.version, response: 'help' }));
  assert.equal((await family(f.observer)).inbox.filter(event => event.kind === 'help').length, 1);
  await step(f.customer, ride, 'cancel');
  assert.equal((await f.observer.send(`/api/family/trips/${trip.shareId}`)).status, 404);
  const inbox = (await family(f.observer)).inbox;
  assert.ok(!inbox.some(event => event.shareId === trip.shareId));
  const cancellation = inbox.find(event => event.kind === 'cancelled');
  assert.ok(cancellation); assert.equal(cancellation.shareId, null);
  assert.ok(!JSON.stringify(cancellation).includes(ride.id));
});

test('the passenger can remove the completion summary before its expiry', async t => {
  const f = await people(t), initial = await booked(f.h, f), { trip } = await grant(f.customer, f.observer, initial);
  let ride = initial;
  for (const action of ['depart', 'arrive', 'start', 'complete']) ride = await step(f.driver, ride, action, action === 'start' ? { pickupPin: initial.trip.pickupPin } : {});
  const completed = await view(f.customer, trip);
  assert.equal(completed.sharingActive, false);
  ok(await command(f.customer, 'stop-sharing', { shareId: trip.shareId, expectedVersion: completed.version }));
  assert.equal((await f.observer.send(`/api/family/trips/${trip.shareId}`)).status, 404);
  assert.equal((await family(f.observer)).inbox.some(event => event.shareId === trip.shareId), false);
});

test('snapshot restore requires new sharing consent for active and completed trips while the source keeps its grants', async t => {
  const directory = mkdtempSync(join(tmpdir(), 'taxi-family-snapshot-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const f = await people(t, { persistent: true }), initial = await booked(f.h, f), first = await grant(f.customer, f.observer, initial);
  let ride = initial;
  for (const action of ['depart', 'arrive', 'start', 'complete']) ride = await step(f.driver, ride, action, action === 'start' ? { pickupPin: initial.trip.pickupPin } : {});
  const next = await booked(f.h, f);
  ok(await command(f.customer, 'share', { rideId: next.id, contactId: first.contact.id }));
  const before = f.h.db.prepare('SELECT * FROM family_shares ORDER BY id').all(); assert.equal(before.length, 2);
  const events = f.h.db.prepare('SELECT id FROM family_events WHERE user_id=? AND share_id IS NOT NULL LIMIT 2').all(f.observer.user.id);
  assert.equal(events.length, 2);
  for (const [index, status] of ['queued', 'provider_accepted'].entries()) {
    f.h.db.prepare(`INSERT INTO family_push_jobs(id,event_id,user_id,session_id,token,status,next_at,ticket,created_at,accepted_at)
      VALUES (?,?,?,?,?,?,?,?,?,?)`).run(randomUUID(), events[index].id, f.observer.user.id, `fictional-snapshot-device-${index}`,
      'ExpoPushToken[family_snapshot_fixture]', status, f.h.now + 86_400_000, index ? 'fictional-receipt-ticket' : null, f.h.now, index ? f.h.now : null);
  }
  const jobsBefore = f.h.db.prepare('SELECT * FROM family_push_jobs ORDER BY id').all();
  const destination = join(directory, 'restored.sqlite'); saveSnapshot(f.h.filename, destination, { now: f.h.now });
  assert.deepEqual(f.h.db.prepare('SELECT * FROM family_shares ORDER BY id').all(), before);
  assert.deepEqual(f.h.db.prepare('SELECT * FROM family_push_jobs ORDER BY id').all(), jobsBefore);
  assert.equal((await family(f.observer)).trips.length, 2);
  const restored = openDatabase(destination);
  try {
    const rows = restored.prepare('SELECT active,reason FROM family_shares').all();
    assert.ok(rows.every(row => row.active === 0 && row.reason === 'snapshot_reset'));
    const jobs = restored.prepare('SELECT status,token,ticket FROM family_push_jobs').all();
    assert.equal(jobs.length, 2); assert.ok(jobs.every(row => row.status === 'suppressed' && row.token === '' && row.ticket === null));
    const app = createApplication({ db: restored, clock: () => f.h.now });
    assert.equal((await app.family.get(f.observer.user.id)).family.trips.length, 0);
    assert.equal((await app.family.get(f.observer.user.id)).family.inbox.some(event => event.shareId), false);
    assert.equal(restored.prepare('SELECT count(*) AS n FROM family_contacts WHERE status=?').get('active').n, 1);
  } finally { restored.close(); }
});

test('schema thirty upgrades keep accounts, rides, negotiated fares and sessions unchanged without opting anyone in', t => {
  const directory = mkdtempSync(join(tmpdir(), 'taxi-family-upgrade-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const filename = join(directory, 'existing.sqlite'), original = openDatabase(filename);
  original.exec(`INSERT INTO users(id,email,name,password_hash,role,created_at) VALUES
    ('family-old-owner','old-owner@example.test','Existing owner','stored-hash','customer',1000),
    ('family-old-driver','old-driver@example.test','Existing driver','stored-driver-hash','driver',1000);
    INSERT INTO sessions(token_hash,user_id,csrf_token,expires_at) VALUES ('existing-session','family-old-owner','existing-csrf',9999999999999);
    INSERT INTO drivers(user_id,status,vehicle_model,vehicle_plate) VALUES ('family-old-driver','approved','Existing Toyota','KEEP-123');
    INSERT INTO rides(id,customer_id,driver_id,pickup_id,destination_id,suggested_fare_kobo,status,version,created_at,matched_at,updated_at,dispatch_region)
      VALUES ('family-old-ride','family-old-owner','family-old-driver','wuse-ii','maitama',450000,'agreed',3,1000,1100,1600,'sample:wuse-ii');
    INSERT INTO fare_events(ride_id,version,type,payload) VALUES ('family-old-ride',1,'propose','{"amountKobo":470001}');`);
  removeFamilyFixtureTables(original); original.exec('PRAGMA user_version=30');
  const tables = original.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all().map(row => row.name);
  const before = new Map(tables.map(name => [name, original.prepare(`SELECT * FROM ${name}`).all()])); original.close();
  for (let attempt = 0; attempt < 2; attempt++) {
    const upgraded = openDatabase(filename);
    try {
      assert.ok(SCHEMA_VERSION >= 32); assert.equal(upgraded.prepare('PRAGMA user_version').get().user_version, SCHEMA_VERSION);
      for (const name of tables) assert.deepEqual(upgraded.prepare(`SELECT * FROM ${name}`).all(), before.get(name), name);
      for (const name of ['family_adults', 'family_contacts', 'family_shares', 'family_trip_state', 'family_events', 'family_commands', 'family_push_jobs']) {
        assert.equal(upgraded.prepare(`SELECT count(*) AS count FROM ${name}`).get().count, 0, name);
      }
      assert.deepEqual(upgraded.prepare('PRAGMA foreign_key_check').all(), []);
    } finally { upgraded.close(); }
  }
});
