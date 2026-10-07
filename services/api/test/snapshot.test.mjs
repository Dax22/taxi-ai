import { submitApplication, approveApplication, fixtureApi } from './driver-fixtures.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { DatabaseSync } from 'node:sqlite';
import { saveSnapshot } from '../src/infrastructure/database-snapshot.mjs';
import { openDatabase } from '../src/infrastructure/database.mjs';
import { createApplication } from '../src/application.mjs';
import { TEST_NOW, harness, participants, requestRide, claimRide, PASSWORD } from './helpers.mjs';

function folder(t) { const path = mkdtempSync(join(tmpdir(), 'taxi-snapshot-')); t.after(() => rmSync(path, { recursive: true, force: true })); return path; }

test('snapshots preserve parcel records but revoke recipient tracking grants only in the restored copy', async (t) => {
  const dir = folder(t), h = await harness(t, { persistent: true });
  const sender = h.client(), recipient = h.client();
  await sender.register('snapshot-parcel-sender'); await recipient.register('snapshot-parcel-recipient');
  const requested = await sender.post('/api/rides', { pickupId: 'wuse-ii', destinationId: 'maitama', vehicleCategory: 'standard',
    delivery: { description: 'Sealed parcel', weightKg: 2, recipientName: 'Recipient' } });
  assert.equal(requested.status, 201, JSON.stringify(requested.body));
  const rideId = requested.body.ride.id;
  h.db.prepare('INSERT INTO account_email_verifications VALUES (?,?,?)').run(recipient.user.id, recipient.user.email, h.now);
  const invitation = await sender.post(`/api/parcels/${rideId}/link`, { expectedLinkId: null, recipientEmail: recipient.user.email });
  assert.equal(invitation.status, 200, JSON.stringify(invitation.body));
  assert.equal((await recipient.post('/api/parcels/accept', { token: invitation.body.token })).status, 200);
  const source = h.db.prepare('SELECT * FROM parcel_tracking_links').get();
  const path = join(dir, 'parcel-backup.sqlite'); saveSnapshot(h.filename, path, { now: h.now });
  assert.deepEqual(h.db.prepare('SELECT * FROM parcel_tracking_links').get(), source);
  const copy = new DatabaseSync(path, { readOnly: true });
  try {
    const grant = copy.prepare('SELECT * FROM parcel_tracking_links').get();
    assert.equal(grant.active, 0); assert.equal(grant.token_hash, null); assert.equal(grant.reason, 'snapshot_reset');
    assert.equal(grant.version, source.version + 1);
    assert.equal(copy.prepare('SELECT count(*) AS n FROM delivery_orders WHERE ride_id=?').get(rideId).n, 1);
    assert.equal(copy.prepare('SELECT count(*) AS n FROM parcel_tracking_commands').get().n, 2);
    assert.deepEqual(copy.prepare('PRAGMA foreign_key_check').all(), []);
  } finally { copy.close(); }
});

test('a live WAL snapshot preserves rides and chat, clears transient data only in the copy and restores into a new database', async (t) => {
  const dir = folder(t), h = await harness(t, { persistent: true });
  const { customer, driver, admin } = await participants(h);
  let ride = await claimRide(driver, await requestRide(customer));
  ride = (await driver.post(`/api/rides/${ride.id}/offers`, { expectedVersion: ride.version, amountKobo: 470000 })).body.ride;
  ride = (await customer.post(`/api/rides/${ride.id}/accept`, { expectedVersion: ride.version, offerId: ride.negotiation.currentOffer.id })).body.ride;
  ride = (await customer.post(`/api/rides/${ride.id}/confirm`, { expectedVersion: ride.version })).body.ride;
  const pin = ride.trip.pickupPin;
  const chat = await customer.post(`/api/rides/${ride.id}/chat/messages`, { body: 'Keep this saved message.' });
  assert.equal(chat.status, 201, JSON.stringify(chat.body));
  const native = await fetch(h.base + '/api/mobile/v1/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: customer.user.email, password: PASSWORD, deviceName: 'Snapshot phone' }) });
  assert.equal(native.status, 200); await native.json();
  const spare = h.client(); await spare.register('spare-driver', 'driver');
  await submitApplication(fixtureApi(spare));
  await approveApplication(fixtureApi(admin), spare.user.id);
  const available = await spare.online({ mode: 'gps', lat: 9.087654, lng: 7.412345 });
  // Finish HTTP setup before inserting deliberately invalid transient fixtures.
  // No await is allowed between these inserts and the synchronous snapshot: the
  // maintenance worker would legitimately expire their dummy sessions otherwise.
  h.db.prepare(`INSERT INTO voice_calls (id, ride_id, caller_id, callee_id, status, mode, created_at, caller_session, caller_client, caller_seen_at, offer_sdp)
    VALUES ('call', ?, ?, ?, 'ringing', 'local', 1000, 'session-sensitive', 'window-sensitive', 1000, 'sdp-sensitive')`).run(ride.id, customer.user.id, driver.user.id);
  h.db.prepare("INSERT INTO voice_participants (user_id, call_id) VALUES (?, 'call')").run(customer.user.id);
  h.db.prepare(`INSERT INTO location_shares (id, ride_id, driver_id, active, session_hash, client_hash, started_at, seen_at, position_json)
    VALUES ('share', ?, ?, 1, 'session-sensitive', 'window-sensitive', 1000, 1000, '{"lat":9.08,"lng":7.4}')`).run(ride.id, driver.user.id);
  for (const [id, bound] of [['used-quote', ride.id], ['unused-quote', null]]) {
    h.db.prepare('INSERT INTO location_quotes (id, customer_id, created_at, expires_at, route_json, ride_id) VALUES (?, ?, 1000, 100000, ?, ?)')
      .run(id, customer.user.id, '{"fixture":"planned-route"}', bound);
    h.db.prepare('INSERT INTO location_quote_commands (actor_id, key, fingerprint, quote_id) VALUES (?, ?, ?, ?)')
      .run(customer.user.id, id + '-command', 'fixture', id);
  }
  h.db.prepare("INSERT INTO account_identities VALUES ('google','snapshot-subject',?,?)").run(customer.user.id, TEST_NOW);
  h.db.prepare(`INSERT INTO google_auth_attempts(state_hash,binding_hash,nonce,verifier,channel,intent,expires_at)
    VALUES ('snapshot-state','snapshot-binding','snapshot-nonce','private-pkce-verifier','web','login',?)`).run(TEST_NOW + 600_000);
  h.db.prepare('INSERT INTO account_email_verifications VALUES (?,?,?)').run(customer.user.id,customer.user.email,TEST_NOW);
  h.db.prepare("INSERT INTO account_email_tokens VALUES ('private-email-digest',?,'reset',?,'private-credential-binding',?)").run(customer.user.id,customer.user.email,TEST_NOW+600_000);
  h.db.prepare("INSERT INTO account_email_jobs(id,user_id,purpose,email,created_at,next_attempt_at) VALUES ('pending-email',?,'reset',?,?,?)").run(customer.user.id,customer.user.email,TEST_NOW,TEST_NOW);
  assert.equal(h.db.prepare("SELECT status FROM voice_calls WHERE id='call'").get().status, 'ringing');
  const tables = h.db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all().map((r) => r.name);
  const sourceRows = new Map(tables.map((name) => [name, JSON.stringify(h.db.prepare(`SELECT * FROM ${name}`).all())]));
  const path = join(dir, 'backup.sqlite'); saveSnapshot(h.filename, path, { now: 12345 });
  assert.equal(statSync(path).mode & 0o777, 0o600);
  for (const name of tables) assert.equal(JSON.stringify(h.db.prepare(`SELECT * FROM ${name}`).all()), sourceRows.get(name), `source ${name}`);
  const copy = new DatabaseSync(path, { readOnly: true });
  try {
    for (const name of ['users', 'drivers', 'rides', 'ride_trips', 'ride_activity', 'fare_events', 'chat_messages', 'idempotency', 'audit_events', 'driver_applications', 'driver_documents', 'driver_document_reads', 'driver_application_events', 'driver_application_commands']) {
      assert.equal(JSON.stringify(copy.prepare(`SELECT * FROM ${name}`).all()), sourceRows.get(name), name);
    }
    for (const name of ['sessions', 'device_sessions', 'device_refresh_tokens', 'voice_participants', 'google_auth_attempts', 'account_email_tokens', 'account_email_jobs']) assert.equal(copy.prepare(`SELECT count(*) AS n FROM ${name}`).get().n, 0);
    assert.equal(copy.prepare('SELECT verified_at FROM account_email_verifications').get().verified_at,TEST_NOW);
    assert.equal(copy.prepare('SELECT subject FROM account_identities').get().subject, 'snapshot-subject');
    const call = copy.prepare('SELECT * FROM voice_calls').get();
    assert.equal(call.status, 'ended'); assert.equal(call.reason, 'snapshot_reset'); assert.equal(call.offer_sdp, null); assert.equal(call.caller_session, '');
    const availability = copy.prepare('SELECT * FROM driver_availability WHERE id = ?').get(available.id);
    assert.equal(availability.active, 0); assert.equal(availability.reason, 'snapshot_reset');
    for (const key of ['position_json', 'session_hash', 'client_hash', 'area_id']) assert.equal(availability[key], null);
    const share = copy.prepare('SELECT * FROM location_shares').get();
    assert.equal(share.active, 0); assert.equal(share.position_json, null); assert.equal(share.client_hash, null);
    assert.deepEqual(copy.prepare('SELECT id FROM location_quotes').all().map((r) => r.id), ['used-quote']);
    assert.equal(copy.prepare('SELECT count(*) AS n FROM location_quote_commands').get().n, 1);
    assert.deepEqual(copy.prepare('PRAGMA foreign_key_check').all(), []);
  } finally { copy.close(); }
  assert.ok(!readFileSync(path).includes(Buffer.from('sdp-sensitive')));
  assert.ok(!readFileSync(path).includes(Buffer.from('private-pkce-verifier')));
  assert.ok(!readFileSync(path).includes(Buffer.from('private-email-digest')));
  assert.ok(!readFileSync(path).includes(Buffer.from('private-credential-binding')));
  assert.ok(!readFileSync(path).includes(Buffer.from('9.087654')));
  const restoredPath = join(dir, 'restored.sqlite'); saveSnapshot(path, restoredPath);
  const restored = openDatabase(restoredPath);
  try {
    assert.equal(restored.prepare('SELECT body FROM chat_messages').get().body, 'Keep this saved message.');
    assert.equal(restored.prepare('SELECT count(*) AS n FROM sessions').get().n, 0);
    const app = createApplication({ db: restored, clock: () => TEST_NOW });
    assert.equal((await app.accounts.sessionFor(customer.cookie.split('=')[1])), null);
    const account = await app.accounts.login({ email: customer.user.email, password: PASSWORD });
    const saved = (await app.rides.get(account, ride.id));
    assert.equal(saved.trip.pickupPin, pin); assert.equal(saved.negotiation.agreement.amountKobo, 470000);
  } finally { restored.close(); }
  assert.equal((await customer.post('/api/auth/login', { email: customer.user.email, password: PASSWORD })).status, 200);
});

test('snapshot commands refuse missing, old, corrupt or occupied files and never overwrite destinations or sidecars', (t) => {
  const dir = folder(t), path = join(dir, 'source.sqlite'), destination = join(dir, 'target.sqlite');
  assert.throws(() => saveSnapshot(join(dir, 'missing.sqlite'), destination));
  assert.ok(!readdirSync(dir).includes('missing.sqlite'));
  const db = openDatabase(path); db.close();
  assert.throws(() => saveSnapshot(path, path));
  writeFileSync(destination, 'must stay intact'); assert.throws(() => saveSnapshot(path, destination));
  assert.equal(readFileSync(destination, 'utf8'), 'must stay intact'); rmSync(destination);
  writeFileSync(destination + '-wal', 'sidecar'); assert.throws(() => saveSnapshot(path, destination));
  assert.equal(readFileSync(destination + '-wal', 'utf8'), 'sidecar'); rmSync(destination + '-wal');
  const invalid = join(dir, 'invalid.sqlite'); writeFileSync(invalid, 'not a database');
  assert.throws(() => saveSnapshot(invalid, destination));
  const outdated = new DatabaseSync(invalid + '.sqlite'); outdated.exec('PRAGMA user_version=4'); outdated.close();
  assert.throws(() => saveSnapshot(invalid + '.sqlite', destination), /schema/);
  assert.ok(!readdirSync(dir).some((name) => name.startsWith('.taxi-ai-snapshot-')));
  assert.ok(!readdirSync(dir).includes('target.sqlite'));
});
