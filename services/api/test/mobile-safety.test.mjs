import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { harness, participants, requestRide, claimRide, PASSWORD, TEST_NOW } from './helpers.mjs';
import { parseSafetyContacts, parseTripSafety, parseSafetyMutation } from '../../../packages/shared/src/mobile-safety.mjs';
import { saveSnapshot } from '../src/infrastructure/database-snapshot.mjs';
import { openDatabase } from '../src/infrastructure/database.mjs';
const ok = (r) => { assert.equal(r.status, 200, JSON.stringify(r.body)); return r.body; };
async function send(h, path, { token, data, key = randomUUID(), headers = {} } = {}) {
  const response = await fetch(h.base + '/api/mobile/v1' + path, { method: data === undefined ? 'GET' : 'POST',
    headers: { 'Content-Type': 'application/json', 'Idempotency-Key': key, ...(token ? { Authorization: `Bearer ${token}` } : {}), ...headers },
    ...(data === undefined ? {} : { body: JSON.stringify(data) }) });
  return { status: response.status, body: await response.json() };
}
async function phone(h, actor) {
  let credentials = ok(await send(h, '/auth/login', { data: { email: actor.user.email, password: PASSWORD, deviceName: 'Safety fixture' } })).credentials;
  return { get credentials() { return credentials; }, send: (path, data, key) => send(h, path, { token: credentials.accessToken, data, key }),
    async refresh() { credentials = ok(await send(h, '/auth/refresh', { data: { refreshToken: credentials.refreshToken } })).credentials; } };
}
async function step(who, ride, action, extra = {}) {
  return ok(await who.post(`/api/rides/${ride.id}/${action}`, { expectedVersion: ride.version, ...extra })).ride;
}
async function booked(t, options = {}) {
  const h = await harness(t, options), actors = await participants(h);
  let ride = await claimRide(actors.driver, await requestRide(actors.customer));
  ride = await step(actors.driver, ride, 'offers', { amountKobo: 470000 });
  ride = await step(actors.customer, ride, 'accept', { offerId: ride.negotiation.currentOffer.id });
  ride = await step(actors.customer, ride, 'confirm');
  return { h, ...actors, ride, c: await phone(h, actors.customer), d: await phone(h, actors.driver) };
}
const add = async (p, number = '0') => parseSafetyMutation(ok(await p.send('/safety/contacts', { name: `Test friend ${number}`, phone: `+234800000000${number}` }))).contact;
const report = (p, ride, contacts = [], key) => p.send(`/safety/rides/${ride.id}/incidents`, { kind: 'need_help', note: 'Private test only.',
  contactIds: contacts.map((c) => c.id), contactVersions: Object.fromEntries(contacts.map((c) => [c.id, c.version])) }, key);
const link = (p, ride, expectedShareId = null, key) => p.send(`/safety/rides/${ride.id}/links`, { minutes: 15, expectedShareId }, key);
const view = (h, token) => h.client().post('/api/trip-share/view', { token });

test('native contacts reuse web records, allow versioned edits, and reject foreign, duplicate and stale changes', async (t) => {
  const h = await harness(t), { customer, driver } = await participants(h), c = await phone(h, customer), d = await phone(h, driver);
  const first = await add(c), second = await add(c, '1');
  assert.equal(parseSafetyContacts(ok(await c.send('/safety/contacts'))).contacts.length, 2);
  assert.ok(ok(await customer.send('/api/safety/contacts')).contacts.some((v) => v.id === first.id && v.phone === first.phone));
  assert.deepEqual(parseSafetyContacts(ok(await d.send('/safety/contacts'))).contacts, []);
  const editPath = `/safety/contacts/${first.id}/edit`, data = { name: 'Updated test friend', phone: '+2348000000002', expectedVersion: first.version }, key = randomUUID();
  assert.equal((await d.send(editPath, data)).status, 404);
  assert.equal((await c.send(editPath, { ...data, phone: second.phone })).body.error.code, 'CONTACT_EXISTS');
  const edited = parseSafetyMutation(ok(await c.send(editPath, data, key))).contact;
  assert.equal(edited.version, first.version + 1); assert.equal(edited.verified, false);
  assert.equal(ok(await c.send(editPath, data, key)).replayed, true);
  assert.equal((await c.send(editPath, data)).body.error.code, 'STALE_VERSION');
  assert.equal((await c.send(editPath, { ...data, name: 'Changed key' }, key)).body.error.code, 'KEY_REUSED');
  ok(await c.send(`/safety/contacts/${first.id}/remove`, { expectedVersion: edited.version }));
  assert.equal(h.db.prepare('SELECT name,phone FROM trusted_contacts WHERE id=?').get(first.id).phone, null);
  assert.equal(ok(await customer.send('/api/safety/contacts')).contacts.length, 1);
});

test('native reports retain server-owned evidence, replay once, and expose only the reporter and permitted test-review progress', async (t) => {
  const { h, customer, driver, admin, ride, c, d } = await booked(t, { persistent: true }), friend = await add(c);
  const key = randomUUID(), result = parseSafetyMutation(ok(await report(c, ride, [friend], key))), incident = result.incident;
  assert.equal(incident.vehiclePlate, 'TEST-DRIVER'); assert.equal(incident.location, null);
  assert.equal(incident.notifications[0].recipientPhone, '••••0000'); assert.equal(incident.notifications[0].status, 'queued');
  assert.equal(incident.notifications[0].mode, 'simulation');
  assert.equal(ok(await report(c, ride, [friend], key)).replayed, true);
  assert.equal((await report(c, ride)).body.error.code, 'INCIDENT_OPEN');
  assert.deepEqual(parseTripSafety(ok(await d.send(`/safety/rides/${ride.id}`))).incidents, []);
  assert.equal(ok(await customer.send(`/api/safety/incidents/${incident.id}`)).incident.snapshot.driver.id, driver.user.id);
  const adminIncident = ok(await admin.send(`/api/safety/incidents/${incident.id}`)).incident;
  ok(await admin.post(`/api/admin/safety/${incident.id}/review`, { expectedVersion: adminIncident.version, decision: 'acknowledge', note: 'Test record received.' }));
  const shown = parseTripSafety(ok(await c.send(`/safety/rides/${ride.id}`))).incidents[0];
  assert.equal(shown.status, 'acknowledged'); assert.equal(shown.events.at(-1).note, 'Test record received.');
  for (const secret of ['snapshot', 'actorId', 'reporterId', 'acknowledgedBy', 'sessionHash', 'nativeSessionId']) assert.equal(JSON.stringify(shown).includes(`"${secret}"`), false);
  await h.restart();
  assert.equal(parseTripSafety(ok(await c.send(`/safety/rides/${ride.id}`))).incidents[0].id, incident.id);
  assert.equal(h.db.prepare('SELECT count(*) AS n FROM safety_notifications').get().n, 1);
});

test('selected-contact versions prevent silently retargeted incidents; editing phones cancels old unsent test intentions without rewriting evidence', async (t) => {
  const { h, ride, c, admin } = await booked(t), friend = await add(c);
  const edited = parseSafetyMutation(ok(await c.send(`/safety/contacts/${friend.id}/edit`, { name: friend.name, phone: '+2348000000009', expectedVersion: friend.version }))).contact;
  assert.equal((await report(c, ride, [friend])).body.error.code, 'STALE_VERSION');
  assert.equal((await c.send(`/safety/rides/${ride.id}/incidents`, { kind: 'need_help', note: '', contactIds: [] })).status, 400);
  assert.equal(h.db.prepare('SELECT count(*) AS n FROM safety_incidents').get().n, 0);
  const incident = parseSafetyMutation(ok(await report(c, ride, [edited]))).incident;
  ok(await c.send(`/safety/contacts/${friend.id}/edit`, { name: 'Next test friend', phone: '+2348000000008', expectedVersion: edited.version }));
  const after = parseTripSafety(ok(await c.send(`/safety/rides/${ride.id}`))).incidents[0];
  assert.equal(after.notifications[0].status, 'cancelled'); assert.equal(after.notifications[0].recipientPhone, '••••0009');
  const notice = ok(await admin.send(`/api/safety/incidents/${incident.id}`)).incident.notifications[0];
  assert.equal((await admin.post(`/api/admin/safety-notifications/${notice.id}/simulate`, { expectedVersion: notice.version, outcome: 'retry' })).status, 409);
  assert.equal(h.db.prepare('SELECT recipient_phone FROM safety_notifications WHERE id=?').get(notice.id).recipient_phone, '+2348000000009');
});

test('native links survive access rotation and restart, store no raw secrets, and end when their creating device is revoked', async (t) => {
  const { h, ride, c, customer } = await booked(t, { persistent: true }), key = randomUUID();
  const created = parseSafetyMutation(ok(await link(c, ride, null, key))), token = created.token;
  assert.match(token, /^[a-f0-9]{64}$/);
  const stored = h.db.prepare('SELECT * FROM trip_share_links WHERE id=?').get(created.share.id);
  assert.equal(stored.session_hash, null); assert.equal(stored.native_session_id, c.credentials.sessionId);
  assert.notEqual(stored.token_hash, token); assert.equal(JSON.stringify(stored).includes(token), false);
  assert.equal(ok(await link(c, ride, null, key)).token, null);
  assert.equal(ok(await view(h, token)).trip.driver.vehicle.plate, 'TEST-DRIVER');
  const access = c.credentials.accessToken; await c.refresh(); assert.notEqual(c.credentials.accessToken, access);
  ok(await view(h, token)); await h.restart(); ok(await view(h, token));
  const second = await phone(h, customer);
  ok(await customer.post(`/api/account/devices/${c.credentials.sessionId}/revoke`));
  assert.equal((await c.send(`/safety/rides/${ride.id}`)).status, 401);
  assert.equal((await view(h, token)).status, 404);
  assert.equal(parseTripSafety(ok(await second.send(`/safety/rides/${ride.id}`))).share, null);
  const ended = h.db.prepare('SELECT * FROM trip_share_links WHERE id=?').get(created.share.id);
  assert.equal(ended.reason, 'session_ended'); assert.equal(ended.native_session_id, null); assert.equal(ended.token_hash, null);
});

test('web and native links replace each other only with the shown reference; explicit revocation, expiry and logout remove access', async (t) => {
  const { h, ride, c, customer } = await booked(t);
  const web = ok(await customer.post(`/api/safety/rides/${ride.id}/links`, { minutes: 15, expectedShareId: null }));
  assert.equal((await link(c, ride)).body.error.code, 'STALE_VERSION');
  const native = parseSafetyMutation(ok(await link(c, ride, web.share.id)));
  assert.equal((await view(h, web.token)).status, 404); ok(await view(h, native.token));
  ok(await c.send(`/safety/links/${native.share.id}/revoke`, { expectedVersion: native.share.version }));
  assert.equal((await view(h, native.token)).status, 404);
  const expiring = parseSafetyMutation(ok(await link(c, ride))); h.advance(15 * 60_000);
  assert.equal((await view(h, expiring.token)).status, 404);
  await c.refresh();
  const loggedOut = parseSafetyMutation(ok(await link(c, ride)));
  ok(await c.send('/auth/logout', { refreshToken: c.credentials.refreshToken }));
  assert.equal((await view(h, loggedOut.token)).status, 404);
});

test('cookie-only, foreign participants, forged incident fields and native staff/simulator routes cannot access safety records', async (t) => {
  const { h, ride, c, d, customer, admin } = await booked(t), outsider = h.client(); await outsider.register('safety-outsider');
  const o = await phone(h, outsider), foreign = await add(d);
  assert.equal((await send(h, '/safety/contacts', { headers: { Cookie: customer.cookie } })).status, 401);
  assert.equal((await send(h, '/safety/contacts', { token: c.credentials.accessToken, headers: { Origin: h.base } })).status, 403);
  assert.equal((await send(h, '/auth/login', { data: { email: admin.user.email, password: PASSWORD, deviceName: 'Forbidden staff' } })).status, 403);
  assert.equal((await o.send(`/safety/rides/${ride.id}`)).status, 404);
  assert.equal((await report(o, ride)).status, 404); assert.equal((await report(c, ride, [foreign])).status, 404);
  const data = { kind: 'need_help', note: '', contactIds: [], contactVersions: {} };
  for (const extra of [{ status: 'resolved' }, { driverId: customer.user.id }, { location: { lat: 0, lng: 0 } }, { nativeSessionId: d.credentials.sessionId }]) {
    assert.equal((await c.send(`/safety/rides/${ride.id}/incidents`, { ...data, ...extra })).status, 400);
  }
  for (const path of [`/safety/incidents/${ride.id}/review`, `/safety/notifications/${ride.id}/simulate`]) assert.equal((await c.send(path, {})).status, 404);
  assert.equal(h.db.prepare('SELECT count(*) AS n FROM safety_incidents').get().n, 0);
});

test('native safety writes roll back together and sanitized snapshots retain incidents but revoke native and web links', async (t) => {
  const { h, ride, c, customer, d } = await booked(t, { persistent: true }), friend = await add(c), key = randomUUID();
  h.db.exec("CREATE TRIGGER fail_native_safety BEFORE INSERT ON safety_commands BEGIN SELECT RAISE(ABORT,'fixture failure'); END");
  assert.equal((await report(c, ride, [friend], key)).status, 500);
  assert.equal(h.db.prepare('SELECT count(*) AS n FROM safety_incidents').get().n, 0);
  assert.equal(h.db.prepare('SELECT count(*) AS n FROM safety_notifications').get().n, 0);
  h.db.exec('DROP TRIGGER fail_native_safety');
  const incident = parseSafetyMutation(ok(await report(c, ride, [friend], key))).incident;
  const native = parseSafetyMutation(ok(await link(d, ride)));
  ok(await customer.post(`/api/safety/rides/${ride.id}/links`, { minutes: 15, expectedShareId: null }));
  const folder = mkdtempSync(join(tmpdir(), 'taxi-native-snapshot-')); t.after(() => rmSync(folder, { recursive: true, force: true }));
  const path = join(folder, 'snapshot.sqlite'); saveSnapshot(h.filename, path, { now: TEST_NOW });
  const copy = openDatabase(path);
  try {
    assert.equal(copy.prepare('SELECT count(*) AS n FROM safety_incidents WHERE id=?').get(incident.id).n, 1);
    assert.equal(copy.prepare('SELECT count(*) AS n FROM trusted_contacts').get().n, 1);
    assert.equal(copy.prepare('SELECT count(*) AS n FROM device_sessions').get().n, 0);
    for (const row of copy.prepare('SELECT * FROM trip_share_links').all()) {
      assert.equal(row.active, 0); assert.equal(row.token_hash, null); assert.equal(row.session_hash, null); assert.equal(row.native_session_id, null);
    }
    assert.deepEqual(copy.prepare('PRAGMA foreign_key_check').all(), []);
  } finally { copy.close(); }
  ok(await view(h, native.token));
});

test('trip closure invalidates native sharing without closing an unresolved safety report or requiring current driver approval', async (t) => {
  const { h, ride, c, d, driver, customer } = await booked(t);
  h.db.prepare("UPDATE drivers SET status='pending' WHERE user_id=?").run(driver.user.id);
  const incident = parseSafetyMutation(ok(await report(d, ride))).incident;
  const created = parseSafetyMutation(ok(await link(c, ride)));
  await step(customer, ride, 'cancel');
  assert.equal((await view(h, created.token)).status, 404);
  const after = parseTripSafety(ok(await d.send(`/safety/rides/${ride.id}`)));
  assert.equal(after.canRaise, false); assert.equal(after.incidents[0].id, incident.id); assert.equal(after.incidents[0].status, 'open');
});
