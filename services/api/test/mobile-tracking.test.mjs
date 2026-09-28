import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { harness, participants, requestRide, claimRide, PASSWORD } from './helpers.mjs';

const ok = (result) => { assert.equal(result.status, 200, JSON.stringify(result.body)); return result.body; };
async function native(h, path, token, data, key = randomUUID()) {
  const response = await fetch(h.base + '/api/mobile/v1' + path, { method: data === undefined ? 'GET' : 'POST',
    headers: { 'Content-Type': 'application/json', 'Idempotency-Key': key, ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    ...(data === undefined ? {} : { body: JSON.stringify(data) }) });
  return { status: response.status, body: await response.json() };
}
const phone = async (h, actor) => ok(await native(h, '/auth/login', null,
  { email: actor.user.email, password: PASSWORD, deviceName: 'Tracking fixture' })).credentials;
function device(h, credentials, clientId = randomUUID()) {
  return { credentials, clientId, send(path, data, key) {
    return native(h, `/tracking${path}?clientId=${clientId}`, this.credentials.accessToken, data, key);
  } };
}
const position = (h, extra = {}) => ({ sequence: 1, lat: 9.0765, lng: 7.3986, accuracy: 12, capturedAt: h.now, ...extra });
async function change(actor, ride, action, extra = {}, key) {
  return ok(await actor.post(`/api/rides/${ride.id}/${action}`, { expectedVersion: ride.version, ...extra }, key)).ride;
}
async function confirm(customer, driver, ride) {
  ride = await change(driver, ride, 'offers', { amountKobo: 470000 });
  ride = await change(customer, ride, 'accept', { offerId: ride.negotiation.currentOffer.id });
  return change(customer, ride, 'confirm');
}
async function setup(t, { booked = true, persistent = false } = {}) {
  const h = await harness(t, { persistent }), actors = await participants(h, 2);
  let ride = await claimRide(actors.driver, await requestRide(actors.customer));
  if (booked) ride = await confirm(actors.customer, actors.driver, ride);
  const driverPhone = device(h, await phone(h, actors.driver)), customerPhone = device(h, await phone(h, actors.customer));
  return { h, ...actors, ride, driverPhone, customerPhone };
}
function cleared(h, shareId) {
  const row = h.db.prepare('SELECT active, position_json, session_hash, client_hash FROM location_shares WHERE id = ?').get(shareId);
  assert.equal(row.active, 0);
  assert.deepEqual([row.position_json, row.session_hash, row.client_hash], [null, null, null]);
}

test('native tracking is private, explicitly enabled by the assigned approved driver, and validates native clients', async (t) => {
  const { h, customer, driver, drivers, ride: offered, driverPhone: d, customerPhone: c } = await setup(t, { booked: false });
  const route = `/rides/${offered.id}`;
  assert.equal(ok(await d.send(route)).canShare, false);
  assert.equal((await d.send(`${route}/start`, {})).body.error.code, 'LOCATION_CLOSED');
  await confirm(customer, driver, offered);
  const before = ok(await d.send(route));
  assert.equal(before.rideId, offered.id); assert.equal(before.isDriver, true); assert.equal(before.canShare, true); assert.equal(before.share, null);
  const read = ok(await c.send(route)); assert.equal(read.isDriver, false); assert.equal(read.canShare, false);
  assert.equal((await c.send(`${route}/start`, {})).status, 403);
  const stranger = device(h, await phone(h, drivers[1]));
  assert.equal((await stranger.send(route)).status, 404);
  assert.equal((await stranger.send(`${route}/start`, {})).status, 404);
  assert.equal((await native(h, `/tracking${route}?clientId=${d.clientId}`)).status, 401);
  for (const query of ['', '?clientId=', '?clientId=invalid']) {
    assert.equal((await native(h, `/tracking${route}${query}`, d.credentials.accessToken)).body.error.code, 'INVALID_LOCATION_CLIENT');
  }
  assert.equal((await d.send(`${route}/start`, { nativeSessionId: c.credentials.sessionId })).status, 400);
  const share = ok(await d.send(`${route}/start`, {})).share;
  for (const action of ['stop', 'position']) {
    assert.equal((await c.send(`/shares/${share.id}/${action}`, action === 'position' ? position(h) : {})).status, 403);
  }
  assert.deepEqual(Object.keys(share).sort(), ['active', 'id', 'owned', 'position', 'rideId', 'sequence', 'stale', 'startedAt', 'updatedAt']);
  h.db.prepare("UPDATE drivers SET status = 'rejected' WHERE user_id = ?").run(driver.user.id);
  const rejected = ok(await d.send(route));
  assert.equal(rejected.isDriver, true); assert.equal(rejected.canShare, false); assert.equal(rejected.share, null);
  assert.equal((await d.send(`${route}/start`, {})).body.error.code, 'DRIVER_NOT_APPROVED');
  cleared(h, share.id);
});

test('native shares survive access rotation and expiry while client and device families isolate publishing', async (t) => {
  const { h, driver, ride, driverPhone: d, customerPhone: c } = await setup(t);
  const startPath = `/rides/${ride.id}/start`, key = randomUUID(), share = ok(await d.send(startPath, {}, key)).share;
  assert.equal(share.owned, true); assert.equal(ok(await d.send(startPath, {}, key)).replayed, true);
  assert.equal(h.db.prepare('SELECT session_hash FROM location_shares WHERE id = ?').get(share.id).session_hash, `native:${d.credentials.sessionId}`);
  ok(await d.send(`/shares/${share.id}/position`, position(h)));
  const oldAccess = d.credentials.accessToken;
  d.credentials = ok(await native(h, '/auth/refresh', null, { refreshToken: d.credentials.refreshToken })).credentials;
  assert.equal((await native(h, `/tracking/rides/${ride.id}?clientId=${d.clientId}`, oldAccess)).status, 401);
  assert.equal(ok(await d.send(`/rides/${ride.id}`)).share.owned, true);
  assert.equal(ok(await native(h, '/booking', d.credentials.accessToken)).apiVersion, 1);
  const otherClient = device(h, d.credentials), otherPhone = device(h, await phone(h, driver), d.clientId);
  for (const other of [otherClient, otherPhone]) {
    assert.equal(ok(await other.send(`/rides/${ride.id}`)).share.owned, false);
    assert.equal((await other.send(`/shares/${share.id}/position`, position(h, { sequence: 2 }))).body.error.code, 'LOCATION_WINDOW');
    assert.equal((await other.send(startPath, {})).body.error.code, 'LOCATION_BUSY');
  }
  h.db.prepare('UPDATE device_sessions SET access_expires_at = ? WHERE id = ?').run(h.now + 5000, d.credentials.sessionId);
  h.advance(5000);
  assert.equal((await d.send(`/rides/${ride.id}`)).status, 401);
  assert.equal(ok(await c.send(`/rides/${ride.id}`)).share.active, true);
  d.credentials = ok(await native(h, '/auth/refresh', null, { refreshToken: d.credentials.refreshToken })).credentials;
  ok(await d.send(`/shares/${share.id}/position`, position(h, { sequence: 2 })));
  const stopKey = randomUUID();
  assert.equal(ok(await otherPhone.send(`/shares/${share.id}/stop`, {}, stopKey)).share.active, false);
  assert.equal(ok(await otherPhone.send(`/shares/${share.id}/stop`, {}, stopKey)).replayed, true);
  assert.equal(ok(await c.send(`/rides/${ride.id}`)).share, null);
  cleared(h, share.id);
});

test('native GPS rejects invalid and late points, keeps sequence order through restart, and expires its lease', async (t) => {
  const { h, ride, driverPhone: d, customerPhone: c } = await setup(t, { persistent: true });
  const share = ok(await d.send(`/rides/${ride.id}/start`, {})).share, path = `/shares/${share.id}/position`;
  for (const invalid of [{ accuracy: 201 }, { capturedAt: h.now - 30_000 }, { capturedAt: h.now + 5001 },
    { lat: 41 }, { sequence: 0 }, { sequence: '1' }, { extra: true }]) {
    assert.equal((await d.send(path, position(h, invalid))).status, 400);
  }
  ok(await d.send(path, position(h, { sequence: 2 })));
  assert.equal(ok(await d.send(path, position(h, { sequence: 1, lng: 7.42 }))).replayed, true);
  assert.equal((await d.send(path, position(h, { sequence: 2, lng: 7.42 }))).body.error.code, 'STALE_LOCATION');
  assert.equal((await d.send(path, position(h, { sequence: 3, capturedAt: h.now - 1 }))).body.error.code, 'STALE_LOCATION');
  await h.restart(); h.advance(29_999);
  const read = ok(await c.send(`/rides/${ride.id}`)).share;
  assert.equal(read.position.lng, 7.3986); assert.equal(read.stale, false); assert.equal(read.owned, false);
  h.advance(1); assert.equal(ok(await c.send(`/rides/${ride.id}`)).share.stale, true);
  h.advance(30_000); assert.equal(ok(await c.send(`/rides/${ride.id}`)).share, null);
  assert.equal((await d.send(path, position(h, { sequence: 3 }))).body.error.code, 'LOCATION_CLOSED');
  cleared(h, share.id);
});

test('native sign-out, revocation, refresh reuse and family expiry invalidate shared GPS', async (t) => {
  const { h, driver, ride, customerPhone: c } = await setup(t);
  for (const end of ['logout', 'revoke', 'refresh-reuse', 'family-expiry']) {
    const d = device(h, await phone(h, driver));
    const share = ok(await d.send(`/rides/${ride.id}/start`, {})).share;
    ok(await d.send(`/shares/${share.id}/position`, position(h)));
    if (end === 'logout') ok(await native(h, '/auth/logout', null, { refreshToken: d.credentials.refreshToken }));
    if (end === 'revoke') ok(await native(h, `/devices/${d.credentials.sessionId}/revoke`, d.credentials.accessToken, {}));
    if (end === 'refresh-reuse') {
      ok(await native(h, '/auth/refresh', null, { refreshToken: d.credentials.refreshToken }));
      assert.equal((await native(h, '/auth/refresh', null, { refreshToken: d.credentials.refreshToken })).status, 401);
    }
    if (end === 'family-expiry') {
      h.db.prepare('UPDATE device_sessions SET idle_expires_at = ? WHERE id = ?').run(h.now + 5000, d.credentials.sessionId);
      h.advance(5000);
    }
    assert.equal(ok(await c.send(`/rides/${ride.id}`)).share, null, end);
    assert.equal((await d.send(`/shares/${share.id}/position`, position(h, { sequence: 2 }))).status, 401);
    cleared(h, share.id);
  }
});

test('native GPS populates trip links and incident snapshots; cancellation clears it atomically without revival', async (t) => {
  const { h, customer, ride, driverPhone: d, customerPhone: c } = await setup(t);
  const startPath = `/rides/${ride.id}/start`, startKey = randomUUID(), share = ok(await d.send(startPath, {}, startKey)).share;
  ok(await d.send(`/shares/${share.id}/position`, position(h)));
  const safety = ok(await native(h, `/safety/rides/${ride.id}`, c.credentials.accessToken));
  assert.equal(safety.location.source, 'driver_shared'); assert.equal(safety.location.stale, false);
  const link = ok(await native(h, `/safety/rides/${ride.id}/links`, c.credentials.accessToken, { minutes: 15, expectedShareId: null }));
  const view = () => h.client().post('/api/trip-share/view', { token: link.token });
  assert.equal(ok(await view()).trip.location.lat, 9.0765);
  const incident = ok(await native(h, `/safety/rides/${ride.id}/incidents`, c.credentials.accessToken,
    { kind: 'need_help', note: 'Tracking fixture', contactIds: [] })).incident;
  assert.equal(ok(await customer.send(`/api/safety/incidents/${incident.id}`)).incident.snapshot.location.lat, 9.0765);
  h.db.exec("CREATE TRIGGER fail_trip_location BEFORE INSERT ON idempotency BEGIN SELECT RAISE(ABORT, 'fault'); END");
  const cancelKey = randomUUID();
  assert.equal((await customer.post(`/api/rides/${ride.id}/cancel`, { expectedVersion: ride.version }, cancelKey)).status, 500);
  assert.equal(ok(await c.send(`/rides/${ride.id}`)).share.active, true);
  h.db.exec('DROP TRIGGER fail_trip_location');
  await change(customer, ride, 'cancel', {}, cancelKey);
  assert.equal(ok(await c.send(`/rides/${ride.id}`)).share, null);
  assert.equal(ok(await d.send(`/rides/${ride.id}`)).canShare, false);
  const replay = ok(await d.send(startPath, {}, startKey));
  assert.equal(replay.replayed, true); assert.equal(replay.share.active, false); assert.equal(replay.share.position, null);
  assert.equal((await d.send(`/shares/${share.id}/position`, position(h, { sequence: 2 }))).body.error.code, 'LOCATION_CLOSED');
  assert.equal((await view()).status, 404); cleared(h, share.id);
});

test('native tracking coexists with explicit browser controls and ends at trip completion', async (t) => {
  const { h, driver, ride: booked, driverPhone: d, customerPhone: c } = await setup(t);
  let ride = booked;
  const first = ok(await d.send(`/rides/${ride.id}/start`, {})).share;
  const headers = { 'X-Location-Client': randomUUID() };
  const web = (path, data = {}) => driver.send(path, { method: 'POST', data, headers: { ...headers, 'Idempotency-Key': randomUUID() } });
  assert.equal((await web(`/api/location-shares/${first.id}/position`, position(h))).body.error.code, 'LOCATION_WINDOW');
  ok(await web(`/api/location-shares/${first.id}/stop`));
  const shared = ok(await web(`/api/rides/${ride.id}/location/start`)).share;
  assert.equal(ok(await d.send(`/rides/${ride.id}`)).share.owned, false);
  ok(await d.send(`/shares/${shared.id}/stop`, {}));
  const last = ok(await d.send(`/rides/${ride.id}/start`, {})).share;
  ok(await d.send(`/shares/${last.id}/position`, position(h)));
  const pickupPin = ride.trip.pickupPin;
  for (const action of ['depart', 'arrive', 'start', 'complete']) {
    ride = await change(driver, ride, action, action === 'start' ? { pickupPin } : {});
    assert.equal(Boolean(ok(await c.send(`/rides/${ride.id}`)).share?.active), action !== 'complete');
  }
  cleared(h, last.id);
});
