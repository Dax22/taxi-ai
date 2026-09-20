import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { TEST_NOW, harness, participants, requestRide, claimRide, PASSWORD } from './helpers.mjs';
import { createApplication } from '../src/application.mjs';
import { createTelemetry } from '../src/infrastructure/telemetry.mjs';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDatabase } from '../src/infrastructure/database.mjs';
import { saveSnapshot } from '../src/infrastructure/database-snapshot.mjs';
import { noteText } from '../src/modules/safety/domain.mjs';

async function step(who, ride, action, extra = {}) {
  const result = await who.post(`/api/rides/${ride.id}/${action}`, { expectedVersion: ride.version, ...extra });
  assert.equal(result.status, 200, JSON.stringify(result.body)); return result.body.ride;
}
async function booked(t, options = {}) {
  const h = await harness(t, options), actors = await participants(h);
  let ride = await claimRide(actors.driver, await requestRide(actors.customer));
  ride = await step(actors.driver, ride, 'offers', { amountKobo: 470000 });
  ride = await step(actors.customer, ride, 'accept', { offerId: ride.negotiation.currentOffer.id });
  ride = await step(actors.customer, ride, 'confirm'); return { h, ...actors, ride };
}
async function contact(who, suffix = '0') {
  const result = await who.post('/api/safety/contacts', { name: `Fictional friend ${suffix}`, phone: `+234800000000${suffix}` });
  assert.equal(result.status, 200, JSON.stringify(result.body)); return result.body.contact;
}
async function report(who, ride, ids = [], key = randomUUID()) {
  return who.post(`/api/safety/rides/${ride.id}/incidents`, { kind: 'need_help', note: 'Fictional test incident only.', contactIds: ids }, key);
}
const link = (who, ride, extra = {}, key = randomUUID()) => who.post(`/api/safety/rides/${ride.id}/links`, { minutes: 15, expectedShareId: null, ...extra }, key);
const viewLink = (h, token, extra = {}) => h.client().post('/api/trip-share/view', { token, ...extra });
const review = (admin, incident, decision) => admin.post(`/api/admin/safety/${incident.id}/review`, { expectedVersion: incident.version, decision, note: 'Test administrator recorded this action.' });
const simulate = (admin, notice, outcome, key = randomUUID()) => admin.post(`/api/admin/safety-notifications/${notice.id}/simulate`, { expectedVersion: notice.version, outcome }, key);

async function gps(h, driver, ride) {
  const headers = { 'X-Location-Client': randomUUID(), 'Idempotency-Key': randomUUID() };
  const start = await driver.send(`/api/rides/${ride.id}/location/start`, { method: 'POST', data: {}, headers });
  assert.equal(start.status, 200, JSON.stringify(start.body));
  const update = await driver.send(`/api/location-shares/${start.body.share.id}/position`, { method: 'POST', headers, data: {
    sequence: 1, lat: 9.087654, lng: 7.412345, accuracy: 12, capturedAt: TEST_NOW,
  } }); assert.equal(update.status, 200, JSON.stringify(update.body)); return start.body.share.id;
}

test('incident and review notes allow plain multiline text while bounding length and rejecting hidden controls', () => {
  assert.equal(noteText('First line\nSecond line\t<text>'), 'First line\nSecond line\t<text>');
  assert.equal(noteText('   '), '');
  for (const value of ['x'.repeat(501), 'bad\u0000text', 42]) assert.throws(() => noteText(value), { code: 'INVALID_INPUT' });
  assert.throws(() => noteText('four', true), { code: 'INVALID_INPUT' });
  assert.equal(noteText('Action taken\nTest record reviewed.', true), 'Action taken\nTest record reviewed.');
});

test('trusted contacts belong to one account, have bounded validated numbers and can be removed without leaking into profiles', async (t) => {
  const h = await harness(t), { customer, driver, admin } = await participants(h);
  for (const data of [{ name: 'x', phone: '+2348000000000' }, { name: 'Friend', phone: '08000000000' }, { name: 'Friend', phone: '+2348000000000', verified: true }]) {
    assert.equal((await customer.post('/api/safety/contacts', data)).status, 400);
  }
  const first = await contact(customer), second = await contact(customer, '1'); await contact(customer, '2');
  assert.equal((await customer.post('/api/safety/contacts', { name: 'Fourth', phone: '+2348000000003' })).body.error.code, 'CONTACT_LIMIT');
  assert.equal((await driver.send('/api/safety/contacts')).body.contacts.length, 0);
  assert.equal((await admin.send('/api/safety/contacts')).status, 403);
  assert.equal((await driver.post(`/api/safety/contacts/${first.id}/remove`, { expectedVersion: 0 })).status, 404);
  assert.equal((await customer.post(`/api/safety/contacts/${first.id}/remove`, { expectedVersion: '0' })).status, 400);
  assert.equal((await customer.post(`/api/safety/contacts/${first.id}/remove`, { expectedVersion: 0 })).status, 200);
  assert.equal(h.db.prepare('SELECT phone FROM trusted_contacts WHERE id=?').get(first.id).phone, null);
  assert.equal((await customer.send('/api/safety/contacts')).body.contacts.length, 2);
  assert.equal((await customer.post('/api/safety/contacts', { name: 'Duplicate', phone: second.phone })).body.error.code, 'CONTACT_EXISTS');
  assert.equal(JSON.stringify((await customer.send('/api/session')).body).includes(second.phone), false);
});

test('test SOS stores the driver/plate and timestamped last shared location while isolating the report from the other participant', async (t) => {
  const { h, customer, driver, admin, ride } = await booked(t, { persistent: true });
  const friend = await contact(customer); await gps(h, driver, ride);
  const key = randomUUID(), result = await report(customer, ride, [friend.id], key); assert.equal(result.status, 200);
  const incident = result.body.incident;
  assert.equal(incident.snapshot.driver.id, driver.user.id); assert.equal(incident.snapshot.driver.vehicle.plate, 'TEST-DRIVER');
  assert.equal(incident.snapshot.location.lat, 9.087654); assert.equal(incident.snapshot.location.source, 'driver_shared');
  assert.equal(incident.snapshot.location.capturedAt, TEST_NOW); assert.equal(incident.snapshot.location.stale, false);
  assert.equal(incident.notifications[0].status, 'queued'); assert.equal(incident.notifications[0].mode, 'simulation');
  assert.equal(incident.notifications[0].recipientPhone.includes(friend.phone), false);
  assert.equal((await report(customer, ride, [friend.id], key)).body.replayed, true);
  assert.equal((await report(customer, ride, [friend.id])).body.error.code, 'INCIDENT_OPEN');
  assert.equal((await driver.send(`/api/safety/incidents/${incident.id}`)).status, 404);
  assert.equal((await driver.send(`/api/safety/rides/${ride.id}`)).body.incidents.length, 0);
  assert.equal((await admin.send(`/api/safety/incidents/${incident.id}`)).body.incident.id, incident.id);
  const queue = (await admin.send('/api/admin/safety')).body;
  assert.equal(queue.incidents[0].id, incident.id); assert.equal(JSON.stringify(queue).includes('9.087654'), false);
  assert.equal((await customer.send('/api/admin/safety')).status, 403);
  const outsider = h.client(); await outsider.register('outsider');
  assert.equal((await outsider.send(`/api/safety/rides/${ride.id}`)).status, 404);
  assert.equal((await report(outsider, ride)).status, 404);
  await h.restart(); assert.deepEqual((await customer.send(`/api/safety/incidents/${incident.id}`)).body.incident, incident);
  assert.equal(h.db.prepare('SELECT count(*) AS n FROM safety_notifications').get().n, 1);
});

test('SOS needs a confirmed active trip, permits no contacts or GPS, and remains available if driving eligibility changes', async (t) => {
  const h = await harness(t), { customer, driver } = await participants(h);
  let ride = await requestRide(customer);
  assert.equal((await report(customer, ride)).body.error.code, 'SAFETY_UNAVAILABLE');
  ride = await claimRide(driver, ride); assert.equal((await report(customer, ride)).body.error.code, 'SAFETY_UNAVAILABLE');
  ride = await step(driver, ride, 'offers', { amountKobo: 470000 }); ride = await step(customer, ride, 'accept', { offerId: ride.negotiation.currentOffer.id });
  ride = await step(customer, ride, 'confirm');
  h.db.prepare("UPDATE drivers SET status='pending' WHERE user_id=?").run(driver.user.id);
  const result = await report(driver, ride); assert.equal(result.status, 200); assert.equal(result.body.incident.snapshot.location, null);
  assert.deepEqual(result.body.incident.notifications, []);
  ride = await step(customer, ride, 'cancel');
  assert.equal((await report(customer, ride)).body.error.code, 'SAFETY_UNAVAILABLE');
  assert.equal((await driver.send(`/api/safety/incidents/${result.body.incident.id}`)).body.incident.status, 'open', 'ending a trip never resolves a safety incident');
});

test('foreign recipients, forged packet details, missing CSRF and duplicate contacts cannot create incidents', async (t) => {
  const { h, customer, driver, ride } = await booked(t), friend = await contact(driver);
  assert.equal((await report(customer, ride, [friend.id])).status, 404);
  assert.equal((await report(driver, ride, [friend.id, friend.id])).status, 400);
  for (const extra of [{ driverId: customer.user.id }, { location: { lat: 0, lng: 0 } }, { status: 'resolved' }, { kind: 'kidnap_confirmed' }, { note: '<script>\u0000' }]) {
    assert.equal((await customer.post(`/api/safety/rides/${ride.id}/incidents`, { kind: 'need_help', note: '', contactIds: [], ...extra })).status, 400);
  }
  assert.equal((await customer.send(`/api/safety/rides/${ride.id}/incidents`, { method: 'POST', data: { kind: 'need_help', note: '', contactIds: [] }, headers: { 'X-CSRF-Token': null } })).status, 403);
  assert.equal(h.db.prepare('SELECT count(*) AS n FROM safety_incidents').get().n, 0);
});

test('review and simulated notifications use exact versions, bounded retries and durable per-attempt history', async (t) => {
  const { customer, driver, admin, ride } = await booked(t), friend = await contact(customer);
  let incident = (await report(customer, ride, [friend.id])).body.incident, notice = incident.notifications[0];
  assert.equal((await review(customer, incident, 'acknowledge')).status, 403);
  assert.equal((await review(admin, incident, 'resolve')).body.error.code, 'INCIDENT_CLOSED');
  const old = incident; incident = (await review(admin, incident, 'acknowledge')).body.incident;
  assert.equal((await review(admin, old, 'acknowledge')).body.error.code, 'STALE_VERSION');
  assert.equal((await simulate(driver, notice, 'sent')).status, 403);
  assert.equal((await simulate(admin, notice, 'delivered')).body.error.code, 'NOTIFICATION_CLOSED');
  const sendKey = randomUUID(), queued = notice;
  notice = (await simulate(admin, queued, 'sent', sendKey)).body.incident.notifications[0];
  assert.equal(notice.attempts, 1); assert.equal(notice.status, 'sent');
  assert.equal((await simulate(admin, queued, 'sent', sendKey)).body.replayed, true);
  assert.equal((await simulate(admin, queued, 'failed', sendKey)).body.error.code, 'KEY_REUSED');
  notice = (await simulate(admin, notice, 'failed')).body.incident.notifications[0];
  notice = (await simulate(admin, notice, 'retry')).body.incident.notifications[0]; assert.equal(notice.status, 'queued');
  notice = (await simulate(admin, notice, 'sent')).body.incident.notifications[0];
  notice = (await simulate(admin, notice, 'delivered')).body.incident.notifications[0]; assert.equal(notice.attempts, 2);
  assert.deepEqual(notice.events.map((event) => event.status), ['queued', 'sent', 'failed', 'queued', 'sent', 'delivered']);
  assert.equal((await simulate(admin, notice, 'retry')).status, 409);
  incident = (await review(admin, incident, 'resolve')).body.incident; assert.equal(incident.status, 'resolved');
  assert.equal(incident.notifications[0].status, 'delivered');
  assert.equal((await admin.send('/api/admin/safety?status=open')).body.incidents.length, 0);
  assert.equal((await admin.send('/api/admin/safety?status=resolved')).body.incidents.length, 1);
});

test('removing contacts or closing a case cancels unsent test alerts while preserving the original incident evidence', async (t) => {
  const { customer, admin, ride } = await booked(t), a = await contact(customer), b = await contact(customer, '1');
  let incident = (await report(customer, ride, [a.id, b.id])).body.incident;
  await customer.post(`/api/safety/contacts/${a.id}/remove`, { expectedVersion: a.version });
  incident = (await customer.send(`/api/safety/incidents/${incident.id}`)).body.incident;
  assert.equal(incident.notifications.find((n) => n.recipientName === a.name).status, 'cancelled');
  incident = (await review(admin, incident, 'acknowledge')).body.incident;
  incident = (await review(admin, incident, 'resolve')).body.incident;
  assert.ok(incident.notifications.every((n) => n.status === 'cancelled')); assert.equal(incident.snapshot.driver.vehicle.plate, 'TEST-DRIVER');
  assert.equal((await simulate(admin, incident.notifications[0], 'sent')).status, 409);
});

test('failed incident persistence rolls back its queue and audit; concurrent reports save one open case', async (t) => {
  const { h, customer, ride } = await booked(t), friend = await contact(customer), key = randomUUID();
  const before = h.db.prepare('SELECT count(*) AS n FROM audit_events').get().n;
  h.db.exec("CREATE TRIGGER fail_safety_command BEFORE INSERT ON safety_commands BEGIN SELECT RAISE(ABORT,'test failure'); END");
  assert.equal((await report(customer, ride, [friend.id], key)).status, 500);
  for (const table of ['safety_incidents', 'safety_notifications', 'safety_incident_events', 'safety_notification_events']) assert.equal(h.db.prepare(`SELECT count(*) AS n FROM ${table}`).get().n, 0, table);
  assert.equal(h.db.prepare('SELECT count(*) AS n FROM audit_events').get().n, before);
  h.db.exec('DROP TRIGGER fail_safety_command');
  const results = await Promise.all([report(customer, ride, [friend.id], key), report(customer, ride, [friend.id])]);
  assert.deepEqual(results.map((r) => r.status).sort(), [200, 409]);
  assert.equal(h.db.prepare('SELECT count(*) AS n FROM safety_notifications').get().n, 1);
});

test('private links use one-time server secrets, hashed storage and minimal projections without incident/contact/fare/PIN data', async (t) => {
  const lines = [], { h, customer, driver, admin, ride } = await booked(t, { telemetry: createTelemetry({ write: (line) => lines.push(line) }) });
  const friend = await contact(customer); await gps(h, driver, ride); await report(customer, ride, [friend.id]);
  const key = randomUUID(), result = await link(customer, ride, {}, key); assert.equal(result.status, 200);
  const { share, token } = result.body; assert.match(token, /^[a-f0-9]{64}$/);
  assert.equal((await link(customer, ride, {}, key)).body.token, null, 'a lost secret cannot be recovered from retry storage');
  assert.equal((await driver.post(`/api/safety/links/${share.id}/revoke`, { expectedVersion: share.version })).status, 404);
  assert.equal((await admin.post(`/api/safety/links/${share.id}/revoke`, { expectedVersion: share.version })).status, 403);
  const read = await viewLink(h, token); assert.equal(read.status, 200); assert.equal(read.body.trip.location.lat, 9.087654);
  assert.deepEqual(Object.keys(read.body.trip).sort(), ['destination', 'driver', 'location', 'pickup', 'reference', 'status']);
  const text = JSON.stringify(read.body);
  for (const secret of [friend.phone, friend.name, ride.trip.pickupPin, 'Fictional test incident only.', customer.user.email]) assert.equal(text.includes(secret), false, secret);
  assert.equal(read.body.trip.driver.id, undefined); assert.equal(read.headers.get('cache-control'), 'no-store');
  for (const table of ['trip_share_links', 'safety_commands', 'audit_events']) assert.equal(JSON.stringify(h.db.prepare(`SELECT * FROM ${table}`).all()).includes(token), false, table);
  for (const secret of [token, friend.phone, '9.087654', 'Fictional test incident only.']) assert.equal(lines.join('\n').includes(secret), false, 'telemetry omits '+secret);
  assert.equal((await viewLink(h, '0'.repeat(64))).status, 404);
  assert.equal((await viewLink(h, token, { rideId: ride.id })).status, 400);
  assert.equal((await h.client().send('/api/trip-share/view', { method: 'POST', data: { token }, headers: { Origin: 'https://foreign.example' } })).status, 403);
  assert.equal((await h.client().send('/api/trip-share/view', { method: 'POST', rawBody: JSON.stringify({ token: 'a'.repeat(2000) }) })).status, 413);
  assert.equal((await h.client().send('/api/trip-share/view', { method: 'POST', data: { token }, headers: { 'Content-Type': 'text/plain' } })).status, 415);
});

test('link replacement, revocation, exact expiry, sign-out and trip completion all remove bearer access', async (t) => {
  const { h, customer, driver, ride: initial } = await booked(t); let ride = initial;
  let result = await link(customer, ride), oldToken = result.body.token, current = result.body.share;
  assert.equal((await link(customer, ride)).body.error.code, 'STALE_VERSION');
  result = await link(customer, ride, { expectedShareId: current.id }); current = result.body.share;
  assert.equal((await viewLink(h, oldToken)).status, 404);
  assert.equal((await customer.post(`/api/safety/links/${current.id}/revoke`, { expectedVersion: current.version })).status, 200);
  assert.equal((await viewLink(h, result.body.token)).status, 404);
  result = await link(customer, ride); h.advance(15 * 60_000 - 1); assert.equal((await viewLink(h, result.body.token)).status, 200);
  h.advance(1); assert.equal((await viewLink(h, result.body.token)).status, 404);
  result = await link(customer, ride); await customer.post('/api/auth/logout', {}); assert.equal((await viewLink(h, result.body.token)).status, 404);
  await customer.post('/api/auth/login', { email: customer.user.email, password: PASSWORD });
  result = await link(customer, ride);
  const pin = ride.trip.pickupPin; ride = await step(driver, ride, 'depart'); ride = await step(driver, ride, 'arrive');
  ride = await step(driver, ride, 'start', { pickupPin: pin }); ride = await step(driver, ride, 'complete');
  assert.equal((await viewLink(h, result.body.token)).status, 404);
  assert.equal(h.db.prepare('SELECT count(*) AS n FROM trip_share_links WHERE token_hash IS NOT NULL OR session_hash IS NOT NULL').get().n, 0);
});

test('stale or unavailable GPS is labelled accurately and incident snapshots remain fixed after location sharing stops', async (t) => {
  const { h, customer, driver, ride } = await booked(t), id = await gps(h, driver, ride);
  h.advance(30_000); const incident = (await report(customer, ride)).body.incident;
  assert.equal(incident.snapshot.location.stale, true); assert.equal(incident.snapshot.location.capturedAt, TEST_NOW);
  const result = await link(customer, ride); assert.equal((await viewLink(h, result.body.token)).body.trip.location.stale, true);
  const stop = await driver.send(`/api/location-shares/${id}/stop`, { method: 'POST', data: {}, headers: { 'X-Location-Client': randomUUID(), 'Idempotency-Key': randomUUID() } });
  assert.equal(stop.status, 200, JSON.stringify(stop.body));
  assert.equal((await viewLink(h, result.body.token)).body.trip.location, null);
  assert.equal((await customer.send(`/api/safety/incidents/${incident.id}`)).body.incident.snapshot.location.lat, 9.087654);
});

test('hosted mode exposes no simulator writes, retries are bounded, and shared-link reads are rate limited', async (t) => {
  const { h, customer, admin, ride } = await booked(t), friend = await contact(customer);
  let incident = (await report(customer, ride, [friend.id])).body.incident, notice = incident.notifications[0];
  const hosted = createApplication({ db: h.db, allowSimulation: false, clock: () => TEST_NOW });
  assert.equal(hosted.safety.get(admin.user.id, incident.id).settings.canSimulate, false);
  assert.throws(() => hosted.safety.command({ userId: admin.user.id, action: 'notification.simulate', id: notice.id, key: randomUUID(), data: { expectedVersion: notice.version, outcome: 'sent' } }), { code: 'FORBIDDEN' });
  const simulationKey = randomUUID(), simulationData = { expectedVersion: notice.version, outcome: 'failed' };
  notice = (await simulate(admin, notice, 'failed', simulationKey)).body.incident.notifications[0];
  assert.throws(() => hosted.safety.command({ userId: admin.user.id, action: 'notification.simulate', id: notice.id, key: simulationKey, data: simulationData }), { code: 'FORBIDDEN' });
  notice = (await simulate(admin, notice, 'retry')).body.incident.notifications[0];
  for (let n = 1; n < 3; n++) {
    notice = (await simulate(admin, notice, 'failed')).body.incident.notifications[0];
    if (n < 2) notice = (await simulate(admin, notice, 'retry')).body.incident.notifications[0];
  }
  assert.equal(notice.attempts, 3); assert.equal((await simulate(admin, notice, 'retry')).status, 409);
  for (let n = 0; n < 30; n++) assert.equal((await viewLink(h, 'f'.repeat(64))).status, 404);
  assert.equal((await viewLink(h, 'f'.repeat(64))).status, 429);
});

test('administrator pagination handles tied timestamps, filters and reporter limits without exposing private details in the queue', async (t) => {
  const { h, customer, driver, admin, ride } = await booked(t);
  const app = createApplication({ db: h.db, allowSimulation: true, clock: () => TEST_NOW });
  const ids = [];
  for (let n = 0; n < 21; n++) {
    let record = app.safety.command({ userId: n < 20 ? customer.user.id : driver.user.id, action: 'incident.create', id: ride.id,
      key: randomUUID(), data: { kind: 'need_help', note: 'Private pagination fixture', contactIds: [] } }).incident;
    ids.push(record.id);
    if (n < 20) for (const decision of ['acknowledge', 'resolve']) record = app.safety.command({ userId: admin.user.id, action: 'incident.review', id: record.id,
      key: randomUUID(), data: { expectedVersion: record.version, decision, note: 'Administrator test review' } }).incident;
  }
  const first = (await admin.send('/api/admin/safety?status=all')).body;
  assert.equal(first.incidents.length, 20); assert.ok(first.nextBefore);
  const second = (await admin.send(`/api/admin/safety?status=all&before=${first.nextBefore}`)).body;
  assert.equal(second.incidents.length, 1); assert.equal(second.nextBefore, null);
  assert.deepEqual([...first.incidents, ...second.incidents].map((item) => item.id).sort(), ids.sort());
  assert.equal((await admin.send('/api/admin/safety')).body.incidents.length, 1);
  assert.equal((await admin.send('/api/admin/safety?status=resolved')).body.incidents.length, 20);
  assert.equal(JSON.stringify(first).includes('Private pagination fixture'), false);
  assert.equal((await admin.send('/api/admin/safety?status=invalid')).status, 400);
  assert.equal((await admin.send(`/api/admin/safety?before=${randomUUID()}`)).status, 400);
  assert.equal((await report(customer, ride)).body.error.code, 'INCIDENT_LIMIT');
});

test('backup and restore retain private incident evidence and contacts but cannot revive shared-trip access', async (t) => {
  const { h, customer, driver, ride } = await booked(t, { persistent: true });
  const friend = await contact(customer); await gps(h, driver, ride);
  const record = (await report(customer, ride, [friend.id])).body.incident;
  const shared = (await link(customer, ride)).body;
  const folder = mkdtempSync(join(tmpdir(), 'taxi-safety-copy-')); t.after(() => rmSync(folder, { recursive: true, force: true }));
  const backupPath = join(folder, 'backup.sqlite'), restoredPath = join(folder, 'restored.sqlite');
  saveSnapshot(h.filename, backupPath, { now: (TEST_NOW + 100) }); saveSnapshot(backupPath, restoredPath, { now: (TEST_NOW + 200) });
  assert.equal((await viewLink(h, shared.token)).status, 200, 'the live source is unchanged');
  const restored = openDatabase(restoredPath);
  try {
    const app = createApplication({ db: restored, clock: () => (TEST_NOW + 200) });
    assert.deepEqual(JSON.parse(JSON.stringify(app.safety.get(customer.user.id, record.id).incident)), record);
    assert.equal(app.safety.contacts(customer.user.id).contacts[0].phone, friend.phone);
    assert.throws(() => app.safety.sharedTrip({ token: shared.token }), { code: 'NOT_FOUND' });
    const row = restored.prepare('SELECT * FROM trip_share_links WHERE id=?').get(shared.share.id);
    assert.equal(row.token_hash, null); assert.equal(row.session_hash, null); assert.equal(row.reason, 'snapshot_reset');
    assert.equal(restored.prepare('SELECT count(*) AS n FROM sessions').get().n, 0);
    const bytes = readFileSync(restoredPath); assert.equal(bytes.includes(Buffer.from(shared.token)), false);
    assert.equal(bytes.includes(Buffer.from('9.087654')), true, 'incident locations are retained evidence, not anonymised');
  } finally { restored.close(); }
});
