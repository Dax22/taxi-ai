import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { harness, participants, requestRide, claimRide, bootstrapAdmin, PASSWORD } from './helpers.mjs';
import { openDatabase, SCHEMA_VERSION } from '../src/infrastructure/database.mjs';
import { createStaffFactor } from '../src/infrastructure/staff-factor.mjs';
import { removeAdminExpansionFixtureTables } from './migration-fixtures.mjs';

const base = '/api/admin/console';
const must = (result, expected = 200) => {
  assert.equal(result.status, expected, JSON.stringify(result.body));
  return result.body;
};
const login = actor => actor.post(base + '/login', { email: actor.user.email, password: PASSWORD });

async function fixture(t, roles = ['operations', 'support', 'safety', 'finance']) {
  const h = await harness(t), actors = await participants(h);
  const f = { h, ...actors };
  for (const role of roles) {
    const actor = h.client(); await actor.register('expansion-' + role);
    must(await f.admin.post(base + '/staff/assign', { email: actor.user.email, role,
      expectedVersion: 0, reason: 'Fictional staff assignment for integration testing.' }));
    must(await login(actor)); f[role] = actor;
  }
  return f;
}

async function step(actor, ride, action, data = {}) {
  return must(await actor.post(`/api/rides/${ride.id}/${action}`, { expectedVersion: ride.version, ...data })).ride;
}
async function complete(f, fare = 470001) {
  let ride = await claimRide(f.driver, await requestRide(f.customer));
  ride = await step(f.driver, ride, 'offers', { amountKobo: fare });
  ride = await step(f.customer, ride, 'accept', { offerId: ride.negotiation.currentOffer.id });
  ride = await step(f.customer, ride, 'confirm');
  const pickupPin = ride.trip.pickupPin;
  ride = await step(f.driver, ride, 'depart');
  ride = await step(f.driver, ride, 'arrive');
  ride = await step(f.driver, ride, 'start', { pickupPin });
  return step(f.driver, ride, 'complete');
}

// Additional history is inserted directly to exercise large totals and pagination
// without making setup consume unrelated HTTP rate limits.
function copyUnpaidTrip(f, source, amountKobo, completedAt = f.h.now) {
  const id = randomUUID(), db = f.h.db;
  db.prepare(`INSERT INTO rides (id,customer_id,driver_id,pickup_id,destination_id,suggested_fare_kobo,status,version,created_at,matched_at,updated_at)
    SELECT ?,customer_id,driver_id,pickup_id,destination_id,?,status,version,?,?,? FROM rides WHERE id=?`)
    .run(id, amountKobo, completedAt, completedAt, completedAt, source.id);
  db.prepare(`INSERT INTO ride_trips (ride_id,customer_id,driver_id,status,fare_kobo,booked_at,departed_at,arrived_at,started_at,completed_at)
    SELECT ?,customer_id,driver_id,status,?,booked_at,departed_at,arrived_at,started_at,? FROM ride_trips WHERE ride_id=?`)
    .run(id, amountKobo, completedAt, source.id);
  db.prepare(`INSERT INTO payments (ride_id,customer_id,driver_id,amount_kobo,completed_at,updated_at)
    SELECT ?,customer_id,driver_id,?,?,? FROM payments WHERE ride_id=?`).run(id, amountKobo, completedAt, completedAt, source.id);
  return id;
}

test('new reporting workspaces enforce real scoped memberships without granting legacy administrator access', async t => {
  const f = await fixture(t);
  for (const [path, allowed] of [
    ['/finance', ['admin', 'finance']], ['/compliance', ['admin', 'operations']], ['/demand', ['admin', 'operations']],
  ]) {
    assert.equal((await f.h.client().send(base + path)).status, 401, path);
    assert.equal((await f.customer.send(base + path)).status, 403, path);
    for (const role of ['admin', 'operations', 'support', 'safety', 'finance']) {
      const result = await f[role].send(base + path);
      assert.equal(result.status, allowed.includes(role) ? 200 : 403, role + path + JSON.stringify(result.body));
    }
  }
  for (const actor of [f.finance, f.operations]) {
    assert.equal(f.h.db.prepare('SELECT role FROM users WHERE id=?').get(actor.user.id).role, 'customer');
    assert.equal((await actor.send('/api/admin/payments')).status, 403);
    assert.equal((await actor.send('/api/admin/drivers')).status, 403);
  }
  const native = await fetch(f.h.base + '/api/mobile/v1/auth/login', { method: 'POST',
    headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: f.finance.user.email,
      password: PASSWORD, deviceName: 'Fictional reporting isolation phone' }) });
  assert.equal(native.status, 200);
  const { credentials } = await native.json();
  assert.equal((await f.h.client().send(base + '/finance', { headers: { Authorization: 'Bearer ' + credentials.accessToken } })).status, 401);
  assert.equal((await f.finance.send(base + '/finance', { headers: { Origin: 'https://untrusted.test' } })).status, 403);
});

test('finance totals use the complete completion-date cohort once per trip and reveal no customer or route data', async t => {
  const f = await fixture(t, ['finance']), ride = await complete(f), path = `/api/payments/rides/${ride.id}`;
  let payment = must(await f.customer.send(path)).payment;
  for (const outcome of ['failure', 'success']) {
    payment = must(await f.customer.post(path + '/start', { expectedVersion: payment.version })).payment;
    payment = must(await f.customer.post(path + `/attempts/${payment.attempt.id}/simulate`, { expectedVersion: payment.version, outcome })).payment;
  }
  const second = copyUnpaidTrip(f, ride, Number.MAX_SAFE_INTEGER);
  const third = copyUnpaidTrip(f, ride, Number.MAX_SAFE_INTEGER);
  const excluded = copyUnpaidTrip(f, ride, 600001, f.h.now - 2 * 86400000);
  const query = '?from=2026-01-01&to=2026-01-01&limit=1';
  const first = must(await f.finance.send(base + '/finance' + query));
  assert.equal(first.paymentMode, 'simulation'); assert.equal(first.provider, 'not_configured');
  assert.equal(first.scope.basis, 'payment_completed_at'); assert.equal(first.scope.timeZone, 'Africa/Lagos');
  assert.equal(first.summary.completedTrips, 3); assert.equal(first.summary.paidTrips, 1);
  assert.equal(first.summary.unpaidTrips, 2); assert.equal(first.summary.failedTrips, 0);
  assert.equal(first.summary.grossFareKobo, (2n * BigInt(Number.MAX_SAFE_INTEGER) + 470001n).toString());
  assert.equal(first.summary.simulatedPaidKobo, '470001');
  assert.equal(first.summary.outstandingKobo, (2n * BigInt(Number.MAX_SAFE_INTEGER)).toString());
  for (const field of ['feesKobo', 'commissionKobo', 'refundsKobo', 'payoutsKobo']) assert.equal(first.summary[field], null, field);
  for (const field of ['gateway', 'eatsPayments', 'fees', 'commission', 'refunds', 'payouts']) assert.equal(first.availability[field], false, field);
  const ids = [], pages = [];
  for (let page = first; ; page = must(await f.finance.send(base + '/finance' + query + '&before=' + encodeURIComponent(page.page.next)))) {
    pages.push(page); ids.push(...page.payments.map(item => item.rideId));
    assert.deepEqual(page.summary, first.summary, 'pagination cannot change the aggregate cohort');
    if (!page.page.next) break;
    assert.ok(ids.length < 5, 'pagination must terminate');
  }
  assert.deepEqual(new Set(ids), new Set([ride.id, second, third])); assert.ok(!ids.includes(excluded));
  const detail = must(await f.finance.send(base + '/finance/' + ride.id));
  assert.equal(detail.attempts.length, 2, 'the failed attempt remains history, not an extra fare');
  assert.equal(f.h.db.prepare('SELECT count(*) AS n FROM payment_receipts').get().n, 1);
  const serialized = JSON.stringify({ pages, detail });
  for (const forbidden of [f.customer.user.email, f.driver.user.email, f.customer.user.id, f.driver.user.id,
    'pickupPin', 'password_hash', 'pickup', 'destination', 'latitude', 'longitude', 'payload_json', 'recipientPhone']) {
    assert.ok(!serialized.includes(forbidden), forbidden);
  }
  assert.equal((await f.finance.post(base + '/finance/' + ride.id + '/refund', { amountKobo: 1 })).status, 404);
  for (const query of ['limit=51', 'status=live', 'from=2026-02-30', 'from=2025-01-01&to=2026-01-02',
    'from=2026-01-01&from=2025-01-01', 'before=invalid', 'customerId=' + f.customer.user.id]) {
    assert.equal((await f.finance.send(base + '/finance?' + query)).status, 400, query);
  }
});

test('compliance follow-ups are versioned internal records and cannot approve drivers or deliver reminders', async t => {
  const f = await fixture(t, ['operations', 'finance']), path = base + '/compliance/' + f.driver.user.id;
  const initial = must(await f.operations.send(path));
  assert.equal(initial.followUpMode, 'internal'); assert.equal(initial.driver.followUp.version, 0);
  const originalApplication = f.h.db.prepare('SELECT * FROM driver_applications WHERE driver_id=?').get(f.driver.user.id);
  const key = randomUUID(), data = { expectedVersion: 0, dueAt: f.h.now + 3600000,
    note: 'Fictional internal task: check the renewed insurance document.' };
  assert.equal((await f.finance.post(path + '/follow-up', data)).status, 403);
  const changed = must(await f.operations.post(path + '/follow-up', data, key));
  assert.equal(changed.driver.followUp.status, 'open'); assert.equal(changed.driver.followUp.version, 1);
  assert.equal(changed.followUpMode, 'internal');
  assert.equal(must(await f.operations.post(path + '/follow-up', data, key)).replayed, true);
  assert.equal((await f.operations.post(path + '/follow-up', { ...data, note: 'A changed retry must not overwrite history.' }, key)).body.error.code, 'KEY_REUSED');
  assert.equal((await f.operations.post(path + '/follow-up', data)).body.error.code, 'STALE_VERSION');
  for (const headers of [{ Origin: 'https://untrusted.test' }, { 'X-CSRF-Token': null }]) {
    assert.equal((await f.operations.send(path + '/complete', { method: 'POST', data: { expectedVersion: 1, note: 'Fictional completion.' },
      headers: { 'Idempotency-Key': randomUUID(), ...headers } })).status, 403);
  }
  f.h.advance(3600001);
  const overdue = must(await f.operations.send(base + '/compliance?followUp=overdue'));
  assert.equal(overdue.summary.overdueFollowUps, 1);
  assert.equal(overdue.drivers[0].id, f.driver.user.id);
  const done = must(await f.operations.post(path + '/complete', { expectedVersion: 1, note: 'The follow-up has been checked; no message was sent.' }));
  assert.equal(done.driver.followUp.status, 'done'); assert.equal(done.driver.followUp.version, 2);
  assert.equal(done.events.length, 2);
  assert.equal(f.h.db.prepare('SELECT count(*) AS n FROM admin_compliance_commands').get().n, 2);
  assert.deepEqual(f.h.db.prepare('SELECT * FROM driver_applications WHERE driver_id=?').get(f.driver.user.id), originalApplication);
  assert.equal((await f.operations.post(`/api/admin/drivers/${f.driver.user.id}/review`, {})).status, 403);
  const document = f.h.db.prepare('SELECT id FROM driver_documents WHERE driver_id=?').get(f.driver.user.id);
  assert.equal((await f.operations.send('/api/driver-documents/' + document.id)).status, 404);
  assert.throws(() => removeAdminExpansionFixtureTables(f.h.db), /Cannot downgrade a populated/);
  assert.equal(f.h.db.prepare('SELECT count(*) AS n FROM admin_compliance_events').get().n, 2);
});

test('compliance expiry follows the same Nigeria end-of-day eligibility boundary as driver onboarding', async t => {
  const f = await fixture(t, ['operations']);
  f.h.db.prepare("UPDATE driver_documents SET expires_on='2026-01-01' WHERE driver_id=? AND kind='insurance'").run(f.driver.user.id);
  const path = base + '/compliance/' + f.driver.user.id;
  let detail = must(await f.operations.send(path));
  assert.equal(detail.driver.eligibility.eligible, true);
  const deadline = Date.UTC(2026, 0, 1, 23);
  assert.equal(detail.driver.eligibility.validUntil, deadline);
  assert.equal(must(await f.operations.send(base + '/compliance?queue=expiring')).drivers.some(row => row.id === f.driver.user.id), true);
  f.h.advance(deadline - f.h.now);
  // A new login makes this check independent of browser-session duration.
  must(await login(f.operations));
  detail = must(await f.operations.send(path));
  assert.equal(detail.driver.eligibility.eligible, false);
  assert.ok(detail.driver.eligibility.expired.includes('insurance'));
  assert.equal(must(await f.operations.send(base + '/compliance?queue=expired')).drivers.some(row => row.id === f.driver.user.id), true);
});

test('demand is a request-date cohort, separates current supply and never publishes individual location data', async t => {
  const f = await fixture(t, ['operations']);
  const current = await requestRide(f.customer);
  const old = randomUUID(), expired = randomUUID(), cancelled = randomUUID();
  for (const [id, status, createdAt, expiresAt] of [
    [old, 'requested', f.h.now - 2 * 86400000, f.h.now + 60000],
    [expired, 'requested', f.h.now - 60000, f.h.now - 1],
    [cancelled, 'cancelled', f.h.now - 30000, f.h.now + 60000],
  ]) {
    const passenger = randomUUID();
    f.h.db.prepare('INSERT INTO users(id,email,name,password_hash,role,created_at) VALUES (?,?,?,?,?,?)')
      .run(passenger, passenger + '@example.test', 'Fictional historical passenger', 'non-login-fixture', 'customer', createdAt);
    f.h.db.prepare(`INSERT INTO rides(id,customer_id,pickup_id,destination_id,suggested_fare_kobo,status,created_at,updated_at,request_expires_at,dispatch_region)
      VALUES (?,?,?,?,?,?,?,?,?,?)`).run(id, passenger, 'wuse-ii', 'maitama', 450000, status, createdAt, createdAt, expiresAt, 'sample:wuse-ii');
  }
  const before = f.h.db.prepare('SELECT status FROM rides WHERE id=?').get(expired).status;
  const data = must(await f.operations.send(base + '/demand?from=2026-01-01&to=2026-01-01'));
  assert.equal(data.timezone, 'Africa/Lagos'); assert.equal(data.cohort.unit, 'requests');
  assert.equal(data.cohort.basis, 'request_created_at'); assert.equal(data.totals.requests, 3);
  assert.equal(data.totals.unserved, 1); assert.equal(data.totals.cancelled, 1); assert.equal(data.totals.open, 1);
  assert.equal(data.supply.scope, 'current'); assert.equal(data.supply.capturedAt, f.h.now);
  assert.equal(data.supply.availableDrivers, 1); assert.equal(data.supply.serviceFilterApplied, true);
  const sample = data.areas.items.find(row => row.region.key === 'sample:wuse-ii');
  assert.ok(sample); assert.equal(sample.region.kind, 'sample'); assert.equal(sample.availableDrivers, 1);
  assert.equal(f.h.db.prepare('SELECT status FROM rides WHERE id=?').get(expired).status, before, 'a report must not mutate expiry state');
  const serialized = JSON.stringify(data);
  for (const forbidden of [current.id, old, expired, cancelled, f.customer.user.id, f.driver.user.id,
    f.customer.user.email, f.driver.user.email, 'latitude', 'longitude', 'position_json', 'pickupPin']) {
    assert.ok(!serialized.includes(forbidden), forbidden);
  }
  const courier = must(await f.operations.send(base + '/demand?from=2026-01-01&to=2026-01-01&service=courier'));
  assert.equal(courier.totals.requests, 0); assert.equal(courier.supply.availableDrivers, 0);
  for (const query of ['from=2026-01-02', 'from=2025-01-01&to=2026-01-01', 'limit=51', 'service=eats', 'region=precise-private-address',
    'from=2026-01-01&from=2025-12-31', 'userId=' + f.customer.user.id]) {
    assert.equal((await f.operations.send(base + '/demand?' + query)).status, 400, query);
  }
});

test('role changes and required MFA protect all new reporting routes', async t => {
  const f = await fixture(t, ['finance', 'operations']);
  const financeVersion = f.h.db.prepare('SELECT version FROM staff_memberships WHERE user_id=?').get(f.finance.user.id).version;
  must(await f.admin.post(base + '/staff/assign', { email: f.finance.user.email, role: 'support', expectedVersion: financeVersion,
    reason: 'Fictional move out of the finance role.' }));
  assert.ok([401, 403].includes((await f.finance.send(base + '/finance')).status));
  must(await login(f.finance)); assert.equal((await f.finance.send(base + '/finance')).status, 403);
  const operationVersion = f.h.db.prepare('SELECT version FROM staff_memberships WHERE user_id=?').get(f.operations.user.id).version;
  must(await f.admin.post(base + '/staff/revoke', { userId: f.operations.user.id, expectedVersion: operationVersion,
    reason: 'Fictional operations assignment ended.' }));
  for (const path of ['/compliance', '/demand']) assert.ok([401, 403].includes((await f.operations.send(base + path)).status));
  const h = await harness(t, { staffMfa: { required: true, factor: createStaffFactor({ key: '1a'.repeat(32), required: true }) } });
  const admin = h.client(); await admin.register('mfa-expansion-owner'); await bootstrapAdmin(h.db, admin.user.email);
  must(await login(admin));
  for (const path of ['/finance', '/compliance', '/demand']) {
    const blocked = await admin.send(base + path);
    assert.equal(blocked.status, 403); assert.equal(blocked.body.error.code, 'MFA_SETUP_REQUIRED');
  }
});

test('schema 35 upgrades add compliance workflows without changing existing account or driver records', t => {
  const folder = mkdtempSync(join(tmpdir(), 'taxi-expansion-migration-')), path = join(folder, 'fixture.sqlite');
  t.after(() => rmSync(folder, { recursive: true, force: true }));
  let db = openDatabase(path);
  try {
    const id = randomUUID();
    db.prepare('INSERT INTO users(id,email,name,password_hash,role,created_at) VALUES (?,?,?,?,?,?)')
      .run(id, 'migration-driver@example.test', 'Fictional driver', 'non-login-fixture', 'driver', 1000);
    db.prepare("INSERT INTO drivers(user_id,vehicle_model,vehicle_plate,status) VALUES (?,? ,?,'pending')").run(id, 'Test car', 'TEST-MIGRATION');
    const users = db.prepare('SELECT * FROM users').all(), drivers = db.prepare('SELECT * FROM drivers').all();
    removeAdminExpansionFixtureTables(db); db.exec('PRAGMA user_version=35'); db.close(); db = openDatabase(path);
    assert.equal(db.prepare('PRAGMA user_version').get().user_version, SCHEMA_VERSION);
    assert.ok(SCHEMA_VERSION >= 36);
    assert.deepEqual(db.prepare('SELECT * FROM users').all(), users); assert.deepEqual(db.prepare('SELECT * FROM drivers').all(), drivers);
    for (const table of ['admin_compliance_followups', 'admin_compliance_events', 'admin_compliance_commands']) {
      assert.equal(db.prepare(`SELECT count(*) AS n FROM ${table}`).get().n, 0);
    }
  } finally { db.close(); }
});
