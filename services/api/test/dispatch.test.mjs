import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { harness, participants, requestRide, PASSWORD } from './helpers.mjs';
import { distanceMeters } from '../../../packages/shared/src/locations.mjs';
import { parseWork, parseJourney, parseDeclinedOffer } from '../../../packages/shared/src/mobile-journeys.mjs';
import { saveSnapshot } from '../src/infrastructure/database-snapshot.mjs';
import { openDatabase } from '../src/infrastructure/database.mjs';
import { removeDispatchFixtureTables } from './migration-fixtures.mjs';

const pickup = { lat: 9.081234, lng: 7.401234, name: 'Private dispatch pickup' };
const destination = { lat: 9.101234, lng: 7.421234, name: 'Private dispatch destination' };
const provider = (eta = () => 300) => ({
  mode: 'community', describe: () => ({ enabled: true, mode: 'community' }),
  async route(a, b) {
    return { distanceMeters: Math.max(100, Math.ceil(distanceMeters(a, b) * 1.3)),
      durationSeconds: await eta(a, b), coordinates: [[a.lng, a.lat], [b.lng, b.lat]] };
  },
  async pickupEstimates(pairs) {
    return Promise.all(pairs.map(({ from, to }) => this.route(from, to)));
  },
});
async function setup(t, { count = 2, mode = 'sequential', mapProvider = provider(), ...options } = {}) {
  const h = await harness(t, { mapProvider, dispatchConfig: { mode }, ...options });
  return { h, ...await participants(h, count, { online: false }) };
}
async function routed(customer, point = pickup) {
  const quote = await customer.post('/api/locations/quotes', { pickup: point, destination });
  assert.equal(quote.status, 201, JSON.stringify(quote.body));
  const created = await customer.post('/api/rides', { quoteId: quote.body.quote.id });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  return created.body.ride;
}
async function available(driver) {
  const result = await driver.send('/api/rides?mode=work');
  assert.equal(result.status, 200, JSON.stringify(result.body));
  return result.body.available;
}
const claim = (driver, ride, offer = ride.offer, key = randomUUID()) => driver.post(`/api/rides/${ride.id}/claim`,
  { expectedVersion: ride.version, ...(offer ? { offerId: offer.id } : {}) }, key);
const decline = (driver, offer, key = randomUUID()) => driver.post(`/api/dispatch/offers/${offer.id}/decline`, {}, key);
const rejectsCommand = (result) => assert.ok(result.status >= 400 && result.status < 500, JSON.stringify(result));
const ok = (result) => { assert.equal(result.status, 200, JSON.stringify(result.body)); return result.body; };
async function phone(h, actor) {
  const send = async (path, data, token, key = randomUUID()) => {
    const response = await fetch(`${h.base}/api/mobile/v1${path}`, {
      method: data === undefined ? 'GET' : 'POST',
      headers: { 'Content-Type': 'application/json', 'Idempotency-Key': key, ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      ...(data === undefined ? {} : { body: JSON.stringify(data) }),
    });
    return { status: response.status, body: await response.json() };
  };
  const { credentials } = ok(await send('/auth/login', { email: actor.user.email, password: PASSWORD, deviceName: 'Dispatch test' }));
  const clientId = randomUUID(), token = credentials.accessToken;
  return { send: (path, data, key) => send(path, data, token, key),
    work: async () => parseWork(ok(await send(`/work?clientId=${clientId}`, undefined, token))),
    online: async () => ok(await send(`/work/online?clientId=${clientId}`, { mode: 'sample', areaId: 'wuse-ii' }, token)),
  };
}

test('road pickup time can select a farther driver and exposes only that driver\'s timed offer', async (t) => {
  const nearLat = 9.082234, fartherLat = 9.091234;
  const mapProvider = provider((a, b) => b.lat === pickup.lat ? (a.lat === nearLat ? 600 : 120) : 300);
  const { h, customer, drivers } = await setup(t, { mapProvider });
  const ride = await routed(customer);
  await drivers[0].online({ mode: 'gps', lat: nearLat, lng: pickup.lng });
  await drivers[1].online({ mode: 'gps', lat: fartherLat, lng: pickup.lng });
  assert.deepEqual(await available(drivers[0]), []);
  const requests = await available(drivers[1]);
  assert.equal(requests.length, 1);
  assert.equal(requests[0].id, ride.id);
  assert.equal(requests[0].offer.pickupEtaMinutes, 2);
  assert.equal(requests[0].offer.etaSource, 'road');
  assert.equal(requests[0].offer.expiresAt, h.now + 20_000);
  assert.equal((await customer.send(`/api/rides/${ride.id}`)).body.ride.status, 'requested');
  for (const value of ['Private dispatch', 'customerId', 'position', customer.user.email, String(pickup.lat)]) {
    assert.ok(!JSON.stringify(requests).includes(value), value);
  }
  rejectsCommand(await claim(drivers[0], ride, requests[0].offer));
  assert.equal((await claim(drivers[1], requests[0])).status, 200);
});

test('expired offers move to the next eligible driver and never revive for the same pair', async (t) => {
  const { h, customer, drivers } = await setup(t);
  const ride = await requestRide(customer);
  for (const driver of drivers) await driver.online();
  const lists = await Promise.all(drivers.map(available));
  const firstIndex = lists.findIndex((list) => list.length === 1), nextIndex = 1 - firstIndex;
  assert.ok(firstIndex >= 0);
  const first = lists[firstIndex][0];
  assert.deepEqual(lists[nextIndex], []);
  h.advance(20_000);
  const next = (await available(drivers[nextIndex]))[0];
  assert.equal(next.id, ride.id);
  assert.notEqual(next.offer.id, first.offer.id);
  const late = await claim(drivers[firstIndex], first);
  assert.equal(late.status, 409); assert.equal(late.body.error.code, 'OFFER_UNAVAILABLE');
  h.advance(20_000);
  assert.deepEqual(await available(drivers[firstIndex]), []);
  assert.deepEqual(await available(drivers[nextIndex]), []);
  assert.equal((await customer.send(`/api/rides/${ride.id}`)).body.ride.status, 'requested');
});

test('declining is owner-only and idempotent, and releases the request to another driver', async (t) => {
  const { customer, drivers } = await setup(t);
  await requestRide(customer);
  for (const driver of drivers) await driver.online();
  const lists = await Promise.all(drivers.map(available));
  const index = lists.findIndex((list) => list.length === 1), otherIndex = 1 - index;
  const offered = lists[index][0], key = randomUUID();
  rejectsCommand(await decline(drivers[otherIndex], offered.offer));
  rejectsCommand(await decline(customer, offered.offer));
  assert.equal((await available(drivers[index]))[0].offer.id, offered.offer.id);
  const first = await decline(drivers[index], offered.offer, key);
  assert.equal(first.status, 200); assert.equal(first.body.declined, true); assert.equal(first.body.replayed, false);
  const again = await decline(drivers[index], offered.offer, key);
  assert.equal(again.status, 200); assert.equal(again.body.replayed, true);
  const next = (await available(drivers[otherIndex]))[0];
  assert.equal(next.id, offered.id);
  assert.deepEqual(await available(drivers[index]), []);
  const reused = await decline(drivers[index], { id: randomUUID() }, key);
  rejectsCommand(reused);
});

test('claims require a live offer and serialize concurrent attempts without choosing or booking a fare', async (t) => {
  const { h, customer, driver } = await setup(t, { count: 1 });
  const ride = await requestRide(customer); await driver.online();
  rejectsCommand(await claim(driver, ride));
  const offered = (await available(driver))[0];
  rejectsCommand(await claim(driver, { ...offered, version: offered.version + 1 }));
  const results = await Promise.all([claim(driver, offered), claim(driver, offered)]);
  assert.deepEqual(results.map((r) => r.status).sort(), [200, 409]);
  let matched = results.find((r) => r.status === 200).body.ride;
  assert.equal(matched.status, 'negotiating'); assert.equal(matched.negotiation.agreement, null);
  rejectsCommand(await customer.post(`/api/rides/${matched.id}/confirm`, { expectedVersion: matched.version }));
  assert.equal(h.db.prepare('SELECT count(*) AS n FROM fare_events WHERE ride_id = ?').get(ride.id).n, 0);
  matched = (await driver.post(`/api/rides/${matched.id}/offers`, { expectedVersion: matched.version, amountKobo: 470000 })).body.ride;
  rejectsCommand(await customer.post(`/api/rides/${matched.id}/confirm`, { expectedVersion: matched.version }));
  matched = (await customer.post(`/api/rides/${matched.id}/accept`, { expectedVersion: matched.version, offerId: matched.negotiation.currentOffer.id })).body.ride;
  assert.equal(matched.status, 'agreed');
  const confirmed = await customer.post(`/api/rides/${matched.id}/confirm`, { expectedVersion: matched.version });
  assert.equal(confirmed.status, 200); assert.equal(confirmed.body.ride.status, 'booked');
  assert.equal(confirmed.body.ride.trip.fareKobo, 470000);
});

test('going offline and returning cannot reuse an offer issued to an earlier availability session', async (t) => {
  const { customer, driver } = await setup(t, { count: 1 });
  await requestRide(customer); await driver.online();
  const offered = (await available(driver))[0];
  await driver.online();
  const result = await claim(driver, offered);
  assert.equal(result.status, 409); assert.equal(result.body.error.code, 'OFFER_UNAVAILABLE');
  assert.deepEqual(await available(driver), []);
});

test('map-provider I/O holds no database transaction and rechecks driver eligibility before offering', async (t) => {
  let entered, release;
  const started = new Promise((resolve) => { entered = resolve; });
  const gate = new Promise((resolve) => { release = resolve; });
  t.after(() => release());
  const mapProvider = provider(async (a, b) => {
    if (b.lat === pickup.lat) { entered(); await gate; }
    return 180;
  });
  const { h, customer, driver } = await setup(t, { count: 1, mapProvider });
  await routed(customer); const online = await driver.online({ mode: 'gps', lat: pickup.lat + 0.001, lng: pickup.lng });
  const listing = available(driver);
  await started;
  const offline = await driver.availability(`/api/availability/${online.id}/offline`);
  assert.equal(offline.status, 200, JSON.stringify(offline.body));
  release();
  assert.deepEqual(await listing, []);
  assert.equal(h.db.prepare("SELECT count(*) AS n FROM dispatch_offers WHERE status = 'pending'").get().n, 0);
});

test('logging out during pickup routing prevents the in-flight work response from returning private account data', async (t) => {
  let entered, release;
  const started = new Promise((resolve) => { entered = resolve; });
  const gate = new Promise((resolve) => { release = resolve; });
  t.after(() => release());
  const mapProvider = provider(async (a, b) => {
    if (b.lat === pickup.lat) { entered(); await gate; }
    return 180;
  });
  const { h, customer, driver } = await setup(t, { count: 1, mapProvider });
  await routed(customer); await driver.online({ mode: 'gps', lat: pickup.lat + 0.001, lng: pickup.lng });
  const listing = driver.send('/api/rides?mode=work');
  await started;
  assert.equal((await driver.post('/api/auth/logout', {})).status, 200);
  release();
  const result = await listing;
  assert.equal(result.status, 401, JSON.stringify(result.body));
  assert.equal(result.body.rides, undefined); assert.equal(result.body.available, undefined);
  assert.equal(h.db.prepare("SELECT count(*) AS n FROM dispatch_offers WHERE status = 'pending'").get().n, 0);
});

test('a failed pickup route is explicitly marked as a distance fallback', async (t) => {
  const mapProvider = provider((a, b) => {
    if (b.lat === pickup.lat) throw new Error('Fixture routing outage');
    return 300;
  });
  const { customer, driver } = await setup(t, { count: 1, mapProvider });
  const ride = await routed(customer); await driver.online({ mode: 'gps', lat: pickup.lat + 0.001, lng: pickup.lng });
  const offered = (await available(driver))[0];
  assert.equal(offered.id, ride.id);
  assert.equal(offered.offer.etaSource, 'distance_fallback');
  assert.equal(offered.offer.pickupEtaMinutes, null, 'a distance ranking heuristic must not appear as a road ETA');
  assert.equal((await claim(driver, offered)).status, 200);
});

test('batch matching waits for its collection window and lowers combined pickup time in a two-by-two assignment', async (t) => {
  const pickupA = pickup, pickupB = { ...pickup, lat: 9.085234, name: 'Another private pickup' };
  const firstLat = 9.082234, secondLat = 9.083234;
  const mapProvider = provider((a, b) => {
    if (![pickupA.lat, pickupB.lat].includes(b.lat)) return 300;
    if (a.lat === firstLat) return b.lat === pickupA.lat ? 120 : 180;
    return b.lat === pickupA.lat ? 240 : 720;
  });
  const { h, customer, drivers } = await setup(t, { mode: 'batch', mapProvider });
  const another = h.client(); await another.register('another-batch-rider');
  const rideA = await routed(customer, pickupA), rideB = await routed(another, pickupB);
  await drivers[0].online({ mode: 'gps', lat: firstLat, lng: pickup.lng });
  await drivers[1].online({ mode: 'gps', lat: secondLat, lng: pickup.lng });
  assert.deepEqual(await available(drivers[0]), []);
  assert.deepEqual(await available(drivers[1]), []);
  h.advance(2000);
  const [first, second] = await Promise.all(drivers.map(available));
  assert.equal(first.length, 1); assert.equal(second.length, 1);
  assert.equal(first[0].id, rideB.id); assert.equal(second[0].id, rideA.id);
  assert.equal(first[0].offer.pickupEtaMinutes + second[0].offer.pickupEtaMinutes, 7);
  assert.equal(h.db.prepare("SELECT count(*) AS n FROM dispatch_offers WHERE status = 'pending'").get().n, 2);
});

test('live offers survive an ordinary restart but not a sanitized backup', async (t) => {
  const { h, customer, driver } = await setup(t, { count: 1, persistent: true });
  await requestRide(customer); await driver.online();
  const offered = (await available(driver))[0];
  await h.restart();
  const restored = (await available(driver))[0];
  assert.equal(restored.offer.id, offered.offer.id);
  assert.equal(restored.offer.expiresAt, offered.offer.expiresAt);
  const folder = mkdtempSync(join(tmpdir(), 'dispatch-snapshot-'));
  t.after(() => rmSync(folder, { recursive: true, force: true }));
  const path = join(folder, 'saved.sqlite'); saveSnapshot(h.filename, path, { now: h.now });
  const db = openDatabase(path);
  try {
    assert.equal(db.prepare("SELECT count(*) AS n FROM dispatch_offers WHERE status = 'pending'").get().n, 0);
    assert.equal(db.prepare('SELECT count(*) AS n FROM driver_availability WHERE active = 1').get().n, 0);
  } finally { db.close(); }
  assert.equal((await claim(driver, restored)).status, 200, 'creating the backup leaves live matching unchanged');
});

test('offer deadlines never extend the rider request lifetime', async (t) => {
  const { h, customer, driver } = await setup(t, { count: 1 });
  const ride = await requestRide(customer); h.advance(295_000); await driver.online();
  const offered = (await available(driver))[0];
  assert.equal(offered.offer.expiresAt, ride.matching.expiresAt);
  h.advance(5000);
  rejectsCommand(await claim(driver, offered));
  assert.deepEqual(await available(driver), []);
  assert.equal((await customer.send(`/api/rides/${ride.id}`)).body.ride.status, 'expired');
});

test('dispatch metrics require admin access and expose aggregates without passenger, driver or location identifiers', async (t) => {
  const { h, customer, admin, driver } = await setup(t, { count: 1 });
  const ride = await routed(customer); await driver.online({ mode: 'gps', lat: pickup.lat, lng: pickup.lng });
  const offered = (await available(driver))[0];
  const path = '/api/admin/dispatch/metrics';
  assert.equal((await h.client().send(path)).status, 401);
  assert.equal((await customer.send(path)).status, 403);
  assert.equal((await driver.send(path)).status, 403);
  const result = await admin.send(path); assert.equal(result.status, 200, JSON.stringify(result.body));
  assert.equal(result.body.mode, 'sequential');
  assert.equal(result.body.offerTtlMs, 20_000);
  assert.equal(result.body.estimates.roadOffers, 1);
  const serialized = JSON.stringify(result.body);
  for (const value of [ride.id, offered.offer.id, customer.user.id, driver.user.id, customer.user.email, driver.user.email,
    String(pickup.lat), 'Private dispatch']) assert.ok(!serialized.includes(value), value);
});

test('native work shares sequential offers, decline ownership and explicit fare acceptance with the web', async (t) => {
  const { h, customer, drivers } = await setup(t);
  const rider = await phone(h, customer), phones = await Promise.all(drivers.map((driver) => phone(h, driver)));
  for (const driver of phones) await driver.online();
  const created = ok(await rider.send('/booking/requests', { pickupId: 'wuse-ii', destinationId: 'maitama' })).ride;
  const lists = await Promise.all(phones.map((driver) => driver.work()));
  for (const list of lists) assert.equal(list.settings.dispatchMode, 'sequential');
  const firstIndex = lists.findIndex((list) => list.available.length === 1), nextIndex = 1 - firstIndex;
  const offered = lists[firstIndex].available[0];
  assert.equal(offered.id, created.id); assert.equal(offered.offer.etaSource, 'sample');
  assert.equal(offered.offer.pickupEtaMinutes, null); assert.equal(offered.offer.expiresAt, h.now + 20_000);
  const path = `/work/offers/${offered.offer.id}/decline`, key = randomUUID();
  rejectsCommand(await phones[nextIndex].send(path, {}));
  assert.equal(parseDeclinedOffer(ok(await phones[firstIndex].send(path, {}, key))).replayed, false);
  assert.equal(parseDeclinedOffer(ok(await phones[firstIndex].send(path, {}, key))).replayed, true);
  const next = (await phones[nextIndex].work()).available[0];
  assert.equal(next.id, created.id);
  rejectsCommand(await phones[nextIndex].send(`/journeys/${next.id}/claim`, { expectedVersion: next.version }));
  let ride = parseJourney(ok(await phones[nextIndex].send(`/journeys/${next.id}/claim`, {
    expectedVersion: next.version, offerId: next.offer.id,
  }))).ride;
  assert.equal(ride.status, 'negotiating'); assert.equal(ride.fareKobo, null); assert.equal(ride.offer, null);
  assert.deepEqual((await phones[nextIndex].work()).available, []);
  const act = async (actor, action, extra = {}) => {
    ride = parseJourney(ok(await actor.send(`/journeys/${ride.id}/${action}`, { expectedVersion: ride.version, ...extra }))).ride;
  };
  rejectsCommand(await rider.send(`/journeys/${ride.id}/confirm`, { expectedVersion: ride.version }));
  await act(phones[nextIndex], 'propose', { amountKobo: 470001 });
  rejectsCommand(await rider.send(`/journeys/${ride.id}/confirm`, { expectedVersion: ride.version }));
  await act(rider, 'accept', { offerId: ride.offer.id });
  assert.equal(ride.status, 'agreed'); assert.equal(ride.fareKobo, 470001);
  await act(rider, 'confirm'); assert.equal(ride.status, 'booked'); assert.equal(ride.fareKobo, 470001);
  assert.equal((await customer.send(`/api/rides/${ride.id}`)).body.ride.trip.fareKobo, 470001);
});

test('an audit write failure rolls back offer acceptance, ride assignment, availability and the retry key together', async (t) => {
  const { h, customer, driver } = await setup(t, { count: 1 });
  const ride = await requestRide(customer); const online = await driver.online();
  const offered = (await available(driver))[0], key = randomUUID();
  const auditCount = h.db.prepare('SELECT count(*) AS n FROM audit_events').get().n;
  h.db.exec("CREATE TRIGGER fail_dispatch_claim BEFORE INSERT ON audit_events WHEN NEW.kind = 'ride.claimed' BEGIN SELECT RAISE(ABORT, 'dispatch fixture failure'); END");
  assert.equal((await claim(driver, offered, offered.offer, key)).status, 500);
  assert.equal(h.db.prepare('SELECT status FROM dispatch_offers WHERE id = ?').get(offered.offer.id).status, 'pending');
  assert.equal((await customer.send(`/api/rides/${ride.id}`)).body.ride.status, 'requested');
  const state = (await driver.send('/api/availability')).body.availability;
  assert.equal(state.id, online.id); assert.equal(state.online, true);
  assert.equal(h.db.prepare('SELECT count(*) AS n FROM audit_events').get().n, auditCount);
  assert.equal(h.db.prepare('SELECT count(*) AS n FROM idempotency WHERE key = ?').get(key).n, 0);
  h.db.exec('DROP TRIGGER fail_dispatch_claim');
  assert.equal((await claim(driver, offered, offered.offer, key)).status, 200);
  assert.equal((await claim(driver, offered, offered.offer, key)).body.replayed, true);
  assert.equal(h.db.prepare('SELECT status FROM dispatch_offers WHERE id = ?').get(offered.offer.id).status, 'accepted');
  assert.equal(h.db.prepare("SELECT count(*) AS n FROM audit_events WHERE kind = 'dispatch.accepted' AND subject_id = ?").get(offered.offer.id).n, 1);
});

test('cancelling an offered request revokes the invitation without exposing either party as an assigned participant', async (t) => {
  const { h, customer, driver } = await setup(t, { count: 1 });
  const ride = await routed(customer); await driver.online({ mode: 'gps', lat: pickup.lat + 0.001, lng: pickup.lng });
  const offered = (await available(driver))[0];
  assert.equal((await customer.send(`/api/rides/${ride.id}`)).body.ride.driver, null);
  assert.equal((await driver.send(`/api/rides/${ride.id}`)).status, 404);
  const cancelled = await customer.post(`/api/rides/${ride.id}/cancel`, { expectedVersion: ride.version, reason: 'plans_changed' });
  assert.equal(cancelled.status, 200); assert.equal(cancelled.body.ride.driver, null);
  assert.deepEqual(await available(driver), []);
  assert.equal(h.db.prepare('SELECT status FROM dispatch_offers WHERE id = ?').get(offered.offer.id).status, 'revoked');
  assert.equal((await driver.send(`/api/rides/${ride.id}`)).status, 404);
  rejectsCommand(await claim(driver, offered));
  const view = JSON.stringify((await driver.send('/api/rides?mode=work')).body);
  for (const value of [customer.user.id, customer.user.email, pickup.name, String(pickup.lat)]) assert.ok(!view.includes(value), value);
});

test('schema 26 migrates without changing an agreed fare, an existing booking or retry records', async (t) => {
  const { h, customer, drivers } = await setup(t, { mode: 'legacy', persistent: true });
  const second = h.client(); await second.register('migration-booked-rider');
  const riders = [customer, second], saved = [];
  for (let i = 0; i < riders.length; i += 1) {
    let ride = await requestRide(riders[i]); await drivers[i].online();
    ride = ok(await claim(drivers[i], ride)).ride;
    ride = ok(await drivers[i].post(`/api/rides/${ride.id}/offers`, { expectedVersion: ride.version, amountKobo: 470000 + i })).ride;
    ride = ok(await riders[i].post(`/api/rides/${ride.id}/accept`, {
      expectedVersion: ride.version, offerId: ride.negotiation.currentOffer.id,
    })).ride;
    if (i === 1) ride = ok(await riders[i].post(`/api/rides/${ride.id}/confirm`, { expectedVersion: ride.version })).ride;
    saved.push(ride);
  }
  const tables = ['users', 'rides', 'fare_events', 'ride_trips', 'idempotency', 'driver_availability'];
  const before = new Map(tables.map((table) => [table, h.db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all()]));
  removeDispatchFixtureTables(h.db); h.db.exec('PRAGMA user_version=26');
  await h.restart();
  for (const table of tables) assert.deepEqual(h.db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all(), before.get(table), table);
  for (const table of ['dispatch_offers', 'dispatch_commands', 'dispatch_journeys']) {
    assert.equal(h.db.prepare(`SELECT count(*) AS n FROM ${table}`).get().n, 0);
  }
  assert.deepEqual(h.db.prepare('PRAGMA foreign_key_check').all(), []);
  const agreed = ok(await customer.send(`/api/rides/${saved[0].id}`)).ride;
  assert.equal(agreed.status, 'agreed'); assert.equal(agreed.negotiation.agreement.amountKobo, 470000);
  const booked = ok(await second.send(`/api/rides/${saved[1].id}`)).ride;
  assert.equal(booked.status, 'booked'); assert.equal(booked.trip.fareKobo, 470001);
  assert.equal(ok(await customer.post(`/api/rides/${agreed.id}/confirm`, { expectedVersion: agreed.version })).ride.status, 'booked');
});
