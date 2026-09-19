import test from 'node:test';
import assert from 'node:assert/strict';
import { openDatabase, transaction, SCHEMA_VERSION } from '../src/infrastructure/database.mjs';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApplication } from '../src/application.mjs';
import { tokens } from '../src/infrastructure/tokens.mjs';
import { canonical } from '../src/modules/rides/domain.mjs';

// Compare every pre-existing column while allowing the schema-six additions.
function legacyRows(db, table) {
  return db.prepare(`SELECT * FROM ${table}`).all().map((row) => {
    if (table === 'rides') { delete row.request_expires_at; delete row.closed_reason; }
    return row;
  });
}

test('schema five gains availability and deadlines while preserving saved route, fare and session data', (t) => {
  const folder = mkdtempSync(join(tmpdir(), 'taxi-matching-upgrade-'));
  t.after(() => rmSync(folder, { recursive: true, force: true }));
  const filename = join(folder, 'existing.sqlite'), old = new DatabaseSync(filename);
  old.exec('PRAGMA foreign_keys = ON');
  for (const file of ['001_initial.sql', '002_chat.sql', '003_trip_lifecycle.sql', '004_voice_calls.sql', '005_locations.sql']) {
    old.exec(readFileSync(new URL(`../migrations/${file}`, import.meta.url), 'utf8'));
  }
  old.exec('PRAGMA user_version = 5');
  old.prepare(`INSERT INTO users (id, email, name, password_hash, role, created_at) VALUES ('customer', 'old@example.test', 'Old customer', 'fixture-hash', 'customer', 1000)`).run();
  old.prepare(`INSERT INTO rides (id, customer_id, pickup_id, destination_id, suggested_fare_kobo, created_at, updated_at)
    VALUES ('pending', 'customer', 'wuse-ii', 'maitama', 450000, 1000, 1000)`).run();
  old.prepare(`INSERT INTO location_quotes (id, customer_id, created_at, expires_at, route_json, ride_id)
    VALUES ('route', 'customer', 1000, 901000, '{"fixture":"existing-saved-route"}', 'pending')`).run();
  const names = old.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all().map((row) => row.name);
  const before = new Map(names.map((name) => [name, JSON.stringify(old.prepare(`SELECT * FROM ${name}`).all())]));
  old.close();
  const db = openDatabase(filename);
  try {
    assert.equal(db.prepare('PRAGMA user_version').get().user_version, 6);
    for (const name of names) assert.equal(JSON.stringify(legacyRows(db, name)), before.get(name), name);
    assert.equal(db.prepare('SELECT request_expires_at FROM rides').get().request_expires_at, 301000);
    assert.equal(db.prepare('SELECT count(*) AS n FROM driver_availability').get().n, 0, 'migration never makes drivers online');
    assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), []);
    createApplication({ db, clock: () => 301000 }).rides.sweep();
    assert.equal(db.prepare('SELECT closed_reason FROM rides').get().closed_reason, 'request_expired');
    assert.equal(db.prepare('SELECT count(*) AS n FROM fare_events').get().n, 0);
    assert.equal(db.prepare('SELECT route_json FROM location_quotes').get().route_json, '{"fixture":"existing-saved-route"}');
  } finally { db.close(); }
});

test('synchronous transactions reject async callbacks and roll back promise-returning work', (t) => {
  const db = openDatabase(':memory:');
  t.after(() => db.close());
  let invoked = false;
  assert.throws(() => transaction(db, async () => { invoked = true; }), /synchronous callbacks/);
  assert.equal(invoked, false, 'an async function must not start work outside the transaction');

  assert.throws(() => transaction(db, () => {
    db.prepare('INSERT INTO rate_limits (key, count, reset_at) VALUES (?, ?, ?)').run('probe', 1, 1000);
    return Promise.resolve();
  }), /cannot return promises/);
  assert.equal(db.prepare('SELECT count(*) AS count FROM rate_limits').get().count, 0);

  transaction(db, () => db.prepare('INSERT INTO rate_limits (key, count, reset_at) VALUES (?, ?, ?)').run('probe', 1, 1000));
  assert.equal(db.prepare('SELECT count(*) AS count FROM rate_limits').get().count, 1, 'rollback leaves the connection usable');
});

test('ordered migrations preserve a version-one database, including existing accounts, sessions and rides', (t) => {
  const folder = mkdtempSync(join(tmpdir(), 'taxi-ai-migration-'));
  t.after(() => rmSync(folder, { recursive: true, force: true }));
  const filename = join(folder, 'existing.sqlite');
  const old = new DatabaseSync(filename);
  old.exec(readFileSync(new URL('../migrations/001_initial.sql', import.meta.url), 'utf8'));
  old.exec('PRAGMA user_version = 1');
  old.prepare('INSERT INTO users (id, email, name, password_hash, role, created_at) VALUES (?, ?, ?, ?, ?, ?)')
    .run('existing-user', 'existing@example.test', 'Existing customer', 'test-only-hash', 'customer', 1000);
  old.prepare('INSERT INTO sessions (token_hash, user_id, csrf_token, expires_at) VALUES (?, ?, ?, ?)')
    .run(tokens.digest('existing-token'), 'existing-user', 'existing-csrf', 9999999);
  old.prepare('INSERT INTO rides (id, customer_id, pickup_id, destination_id, suggested_fare_kobo, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run('existing-ride', 'existing-user', 'wuse-ii', 'maitama', 450000, 1000, 1000);
  const snapshot = ['users', 'sessions', 'rides'].map((table) => JSON.stringify(old.prepare(`SELECT * FROM ${table}`).all()));
  old.close();
  const upgraded = openDatabase(filename);
  try {
    assert.equal(upgraded.prepare('PRAGMA user_version').get().user_version, SCHEMA_VERSION);
    for (const [index, table] of ['users', 'sessions', 'rides'].entries()) {
      assert.equal(JSON.stringify(legacyRows(upgraded, table)), snapshot[index]);
    }
    assert.equal(upgraded.prepare('SELECT count(*) AS count FROM chat_messages').get().count, 0);
    const app = createApplication({ db: upgraded, clock: () => 2000 });
    const session = app.accounts.sessionFor('existing-token');
    assert.equal(session.user.name, 'Existing customer');
    assert.equal(app.rides.get(session.user, 'existing-ride').suggestedFareKobo, 450000);
  } finally { upgraded.close(); }
  const reopened = openDatabase(filename);
  assert.equal(reopened.prepare('PRAGMA user_version').get().user_version, SCHEMA_VERSION);
  reopened.close();
});

test('schema two upgrades without changing fares, chat, read markers, reports, sessions or saved retry commands', (t) => {
  const folder = mkdtempSync(join(tmpdir(), 'taxi-ai-trip-upgrade-'));
  t.after(() => rmSync(folder, { recursive: true, force: true }));
  const filename = join(folder, 'existing.sqlite');
  const old = new DatabaseSync(filename);
  old.exec('PRAGMA foreign_keys = ON');
  for (const file of ['001_initial.sql', '002_chat.sql']) old.exec(readFileSync(new URL(`../migrations/${file}`, import.meta.url), 'utf8'));
  old.exec('PRAGMA user_version = 2');
  const customerId = tokens.id(), driverId = tokens.id(), rideId = tokens.id(), messageId = tokens.id();
  for (const [id, name, role] of [[customerId, 'Customer', 'customer'], [driverId, 'Driver', 'driver']]) {
    old.prepare('INSERT INTO users (id, email, name, password_hash, role, created_at) VALUES (?, ?, ?, ?, ?, ?)')
      .run(id, `${name}@example.test`, name, 'test-hash', role, 1000);
  }
  old.prepare("INSERT INTO drivers (user_id, status, vehicle_model, vehicle_plate) VALUES (?, 'approved', 'Test car', 'TEST-01')").run(driverId);
  old.prepare('INSERT INTO sessions (token_hash, user_id, csrf_token, expires_at) VALUES (?, ?, ?, ?)')
    .run(tokens.digest('old-session'), customerId, 'existing-csrf', 9999999);
  old.prepare(`INSERT INTO rides (id, customer_id, driver_id, pickup_id, destination_id, suggested_fare_kobo,
    status, version, created_at, matched_at, updated_at) VALUES (?, ?, ?, 'wuse-ii', 'maitama', 450000, 'agreed', 3, 1000, 1100, 1300)`)
    .run(rideId, customerId, driverId);
  const offerId = `${rideId}:offer:1`;
  for (const [version, type, payload] of [
    [1, 'propose', { actorId: driverId, expectedVersion: 0, amountKobo: 470000, channel: 'in_app', validForMs: 120000, now: 1200 }],
    [2, 'accept', { actorId: customerId, expectedVersion: 1, offerId, now: 1300 }],
  ]) old.prepare('INSERT INTO fare_events (ride_id, version, type, payload) VALUES (?, ?, ?, ?)').run(rideId, version, type, JSON.stringify(payload));
  const data = { expectedVersion: 2, offerId };
  old.prepare('INSERT INTO idempotency (actor_id, key, fingerprint, ride_id) VALUES (?, ?, ?, ?)')
    .run(customerId, 'existing-retry-key', tokens.digest(canonical({ action: 'accept', id: rideId, data })), rideId);
  old.prepare('INSERT INTO chat_messages (id, ride_id, sequence, sender_id, body, created_at) VALUES (?, ?, 1, ?, ?, 1400)')
    .run(messageId, rideId, driverId, 'Existing message');
  old.prepare('INSERT INTO chat_reads (ride_id, user_id, through_sequence, updated_at) VALUES (?, ?, 1, 1500)').run(rideId, customerId);
  old.prepare('INSERT INTO chat_commands (actor_id, key, fingerprint, message_id) VALUES (?, ?, ?, ?)')
    .run(driverId, 'existing-chat-key', tokens.digest(JSON.stringify([rideId, 'Existing message'])), messageId);
  old.prepare('INSERT INTO chat_reports (id, message_id, reporter_id, reason, created_at) VALUES (?, ?, ?, ?, 1600)')
    .run(tokens.id(), messageId, customerId, 'other');
  const tables = ['users', 'drivers', 'sessions', 'rides', 'fare_events', 'chat_messages', 'chat_reads', 'chat_commands', 'chat_reports'];
  const snapshots = new Map(tables.map((table) => [table, JSON.stringify(old.prepare(`SELECT * FROM ${table}`).all())]));
  old.close();
  const upgraded = openDatabase(filename);
  try {
    assert.equal(upgraded.prepare('PRAGMA user_version').get().user_version, SCHEMA_VERSION);
    for (const table of tables) assert.equal(JSON.stringify(legacyRows(upgraded, table)), snapshots.get(table), table);
    assert.deepEqual(upgraded.prepare('PRAGMA foreign_key_check').all(), []);
    const app = createApplication({ db: upgraded, clock: () => 2000 });
    const user = app.accounts.sessionFor('old-session').user;
    const before = app.rides.get(user, rideId);
    assert.equal(before.status, 'agreed'); assert.equal(before.trip, null, 'migration must not silently book old agreements');
    assert.equal(before.negotiation.agreement.amountKobo, 470000);
    assert.equal(app.rides.mutate({ userId: customerId, key: 'existing-retry-key', action: 'accept', id: rideId, data }).replayed, true);
    assert.equal(app.chat.thread(customerId, rideId).messages[0].body, 'Existing message');
    assert.equal(app.chat.thread(customerId, rideId).unread, 0);
    assert.equal(app.chat.send({ userId: driverId, rideId, key: 'existing-chat-key', data: { body: 'Existing message' } }).replayed, true);
    const confirmed = app.rides.mutate({ userId: customerId, key: 'confirm-old-agreement', action: 'confirm', id: rideId, data: { expectedVersion: before.version } });
    assert.equal(confirmed.ride.status, 'booked');
    assert.deepEqual(confirmed.ride.negotiation.agreement, before.negotiation.agreement);
  } finally { upgraded.close(); }
});

test('schema three gains calling without rewriting pickup PINs, trip activity or failed-PIN retry records', (t) => {
  const folder = mkdtempSync(join(tmpdir(), 'taxi-ai-voice-upgrade-'));
  t.after(() => rmSync(folder, { recursive: true, force: true }));
  const filename = join(folder, 'existing.sqlite'), old = new DatabaseSync(filename);
  old.exec('PRAGMA foreign_keys = ON');
  for (const file of ['001_initial.sql', '002_chat.sql', '003_trip_lifecycle.sql']) old.exec(readFileSync(new URL(`../migrations/${file}`, import.meta.url), 'utf8'));
  old.exec('PRAGMA user_version = 3');
  for (const role of ['customer', 'driver']) old.prepare('INSERT INTO users (id, email, name, password_hash, role, created_at) VALUES (?, ?, ?, ?, ?, ?)')
    .run(role, `${role}@example.test`, role, 'test-only-hash', role, 1000);
  old.prepare(`INSERT INTO rides (id, customer_id, driver_id, pickup_id, destination_id, suggested_fare_kobo, status, version, created_at, matched_at, updated_at)
    VALUES ('ride', 'customer', 'driver', 'wuse-ii', 'maitama', 450000, 'agreed', 6, 1000, 1100, 1600)`).run();
  old.prepare(`INSERT INTO ride_trips (ride_id, customer_id, driver_id, status, fare_kobo, booked_at, departed_at, arrived_at, pickup_pin, pin_failures, pin_blocked_until)
    VALUES ('ride', 'customer', 'driver', 'arrived', 470000, 1400, 1500, 1600, '001234', 5, 62000)`).run();
  for (const [type, time] of [['booked', 1400], ['on_way', 1500], ['arrived', 1600]]) old.prepare('INSERT INTO ride_activity (ride_id, actor_id, type, created_at) VALUES (?, ?, ?, ?)')
    .run('ride', type === 'booked' ? 'customer' : 'driver', type, time);
  old.prepare(`INSERT INTO idempotency (actor_id, key, fingerprint, ride_id, error_code) VALUES ('driver', 'existing-failed-pin-key', 'test-fingerprint', 'ride', 'INVALID_PICKUP_PIN')`).run();
  const tables = old.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all().map((row) => row.name);
  const snapshots = new Map(tables.map((name) => [name, JSON.stringify(old.prepare(`SELECT * FROM ${name}`).all())]));
  old.close();
  const upgraded = openDatabase(filename);
  try {
    assert.equal(upgraded.prepare('PRAGMA user_version').get().user_version, SCHEMA_VERSION);
    for (const name of tables) assert.equal(JSON.stringify(legacyRows(upgraded, name)), snapshots.get(name), name);
    for (const name of ['voice_calls', 'voice_participants', 'voice_commands']) assert.equal(upgraded.prepare(`SELECT count(*) AS n FROM ${name}`).get().n, 0);
    assert.deepEqual(upgraded.prepare('PRAGMA foreign_key_check').all(), []);
  } finally { upgraded.close(); }
});

test('schema four gains locations without altering active calls, ownership, signaling or saved commands', (t) => {
  const folder = mkdtempSync(join(tmpdir(), 'taxi-ai-location-upgrade-'));
  t.after(() => rmSync(folder, { recursive: true, force: true }));
  const filename = join(folder, 'existing.sqlite'), old = new DatabaseSync(filename);
  old.exec('PRAGMA foreign_keys = ON');
  for (const file of ['001_initial.sql', '002_chat.sql', '003_trip_lifecycle.sql', '004_voice_calls.sql']) {
    old.exec(readFileSync(new URL(`../migrations/${file}`, import.meta.url), 'utf8'));
  }
  old.exec('PRAGMA user_version = 4');
  for (const role of ['customer', 'driver']) {
    old.prepare('INSERT INTO users (id, email, name, password_hash, role, created_at) VALUES (?, ?, ?, ?, ?, ?)')
      .run(role, `${role}@example.test`, role, 'test-only-hash', role, 1000);
    old.prepare('INSERT INTO sessions (token_hash, user_id, csrf_token, expires_at) VALUES (?, ?, ?, ?)')
      .run(tokens.digest(role), role, `csrf-${role}`, 9999999);
  }
  old.prepare(`INSERT INTO rides (id, customer_id, driver_id, pickup_id, destination_id, suggested_fare_kobo, status, version, created_at, matched_at, updated_at)
    VALUES ('ride', 'customer', 'driver', 'wuse-ii', 'maitama', 450000, 'negotiating', 1, 1000, 1100, 1100)`).run();
  old.prepare(`INSERT INTO voice_calls (id, ride_id, caller_id, callee_id, status, mode, version, created_at, answered_at, connected_at,
    caller_session, callee_session, caller_client, callee_client, caller_seen_at, callee_seen_at, caller_connected, callee_connected, offer_sdp, answer_sdp)
    VALUES ('call', 'ride', 'customer', 'driver', 'connected', 'local', 3, 1200, 1300, 1400, ?, ?, 'window-one', 'window-two', 1500, 1500, 1, 1, 'test-offer', 'test-answer')`)
    .run(tokens.digest('customer'), tokens.digest('driver'));
  for (const role of ['customer', 'driver']) old.prepare("INSERT INTO voice_participants (user_id, call_id) VALUES (?, 'call')").run(role);
  old.prepare("INSERT INTO voice_commands (actor_id, key, fingerprint, call_id) VALUES ('customer', 'saved-call-command', 'test-fingerprint', 'call')").run();
  const tables = old.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all().map((row) => row.name);
  const snapshots = new Map(tables.map((name) => [name, JSON.stringify(old.prepare(`SELECT * FROM ${name}`).all())]));
  old.close();
  const upgraded = openDatabase(filename);
  try {
    assert.equal(upgraded.prepare('PRAGMA user_version').get().user_version, SCHEMA_VERSION);
    for (const name of tables) assert.equal(JSON.stringify(legacyRows(upgraded, name)), snapshots.get(name), name);
    for (const name of ['location_quotes', 'location_quote_commands', 'location_shares', 'location_share_commands']) {
      assert.equal(upgraded.prepare(`SELECT count(*) AS n FROM ${name}`).get().n, 0);
    }
    assert.deepEqual(upgraded.prepare('PRAGMA foreign_key_check').all(), []);
  } finally { upgraded.close(); }
});
