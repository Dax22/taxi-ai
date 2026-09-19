import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { DatabaseSync } from 'node:sqlite';
import { saveSnapshot } from '../src/infrastructure/database-snapshot.mjs';
import { openDatabase } from '../src/infrastructure/database.mjs';
import { createApplication } from '../src/application.mjs';
import { harness, participants, requestRide, claimRide, PASSWORD } from './helpers.mjs';

function folder(t) { const path = mkdtempSync(join(tmpdir(), 'taxi-snapshot-')); t.after(() => rmSync(path, { recursive: true, force: true })); return path; }

test('a live WAL snapshot preserves rides and chat, clears transient data only in the copy and restores into a new database', async (t) => {
  const dir = folder(t), h = await harness(t, { persistent: true });
  const { customer, driver } = await participants(h);
  let ride = await claimRide(driver, await requestRide(customer));
  ride = (await driver.post(`/api/rides/${ride.id}/offers`, { expectedVersion: ride.version, amountKobo: 470000 })).body.ride;
  ride = (await customer.post(`/api/rides/${ride.id}/accept`, { expectedVersion: ride.version, offerId: ride.negotiation.currentOffer.id })).body.ride;
  ride = (await customer.post(`/api/rides/${ride.id}/confirm`, { expectedVersion: ride.version })).body.ride;
  const pin = ride.trip.pickupPin;
  const chat = await customer.post(`/api/rides/${ride.id}/chat/messages`, { body: 'Keep this saved message.' });
  assert.equal(chat.status, 201, JSON.stringify(chat.body));
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
  const tables = h.db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all().map((r) => r.name);
  const sourceRows = new Map(tables.map((name) => [name, JSON.stringify(h.db.prepare(`SELECT * FROM ${name}`).all())]));
  const path = join(dir, 'backup.sqlite'); saveSnapshot(h.filename, path, { now: 12345 });
  assert.equal(statSync(path).mode & 0o777, 0o600);
  for (const name of tables) assert.equal(JSON.stringify(h.db.prepare(`SELECT * FROM ${name}`).all()), sourceRows.get(name), `source ${name}`);
  const copy = new DatabaseSync(path, { readOnly: true });
  try {
    for (const name of ['users', 'drivers', 'rides', 'ride_trips', 'ride_activity', 'fare_events', 'chat_messages', 'idempotency', 'audit_events']) {
      assert.equal(JSON.stringify(copy.prepare(`SELECT * FROM ${name}`).all()), sourceRows.get(name), name);
    }
    for (const name of ['sessions', 'voice_participants']) assert.equal(copy.prepare(`SELECT count(*) AS n FROM ${name}`).get().n, 0);
    const call = copy.prepare('SELECT * FROM voice_calls').get();
    assert.equal(call.status, 'ended'); assert.equal(call.reason, 'snapshot_reset'); assert.equal(call.offer_sdp, null); assert.equal(call.caller_session, '');
    const share = copy.prepare('SELECT * FROM location_shares').get();
    assert.equal(share.active, 0); assert.equal(share.position_json, null); assert.equal(share.client_hash, null);
    assert.deepEqual(copy.prepare('SELECT id FROM location_quotes').all().map((r) => r.id), ['used-quote']);
    assert.equal(copy.prepare('SELECT count(*) AS n FROM location_quote_commands').get().n, 1);
    assert.deepEqual(copy.prepare('PRAGMA foreign_key_check').all(), []);
  } finally { copy.close(); }
  assert.ok(!readFileSync(path).includes(Buffer.from('sdp-sensitive')));
  const restoredPath = join(dir, 'restored.sqlite'); saveSnapshot(path, restoredPath);
  const restored = openDatabase(restoredPath);
  try {
    assert.equal(restored.prepare('SELECT body FROM chat_messages').get().body, 'Keep this saved message.');
    assert.equal(restored.prepare('SELECT count(*) AS n FROM sessions').get().n, 0);
    const app = createApplication({ db: restored, clock: () => 1000000 });
    assert.equal(app.accounts.sessionFor(customer.cookie.split('=')[1]), null);
    const account = await app.accounts.login({ email: customer.user.email, password: PASSWORD });
    const saved = app.rides.get(account, ride.id);
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
