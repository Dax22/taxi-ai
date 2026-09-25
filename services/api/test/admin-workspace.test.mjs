import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID, createHmac } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { harness, participants, requestRide, claimRide, bootstrapAdmin, PASSWORD } from './helpers.mjs';
import { openDatabase, SCHEMA_VERSION } from '../src/infrastructure/database.mjs';
import { removeAdminWorkspaceFixtureTables } from './migration-fixtures.mjs';
import { saveSnapshot } from '../src/infrastructure/database-snapshot.mjs';
import { createStaffFactor } from '../src/infrastructure/staff-factor.mjs';
import { createApplication } from '../src/application.mjs';
import { createApiRouter } from '../src/http/router.mjs';

const base = '/api/admin/console';
const must = (result, expected = 200) => {
  assert.equal(result.status, expected, JSON.stringify(result.body));
  return result.body;
};
const staffLogin = actor => actor.post(base + '/login', { email: actor.user.email, password: PASSWORD });
const membership = (h, actor) => h.db.prepare('SELECT * FROM staff_memberships WHERE user_id=?').get(actor.user.id);
const factorConfig = (required = false) => ({ required, factor: createStaffFactor({ key: '4b'.repeat(32), required }) });
// Independent RFC 6238 fixture implementation; no production verifier/code helper is used.
function authenticatorCode(secret, now) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  const bits = [...secret].map(character => alphabet.indexOf(character).toString(2).padStart(5, '0')).join('');
  const key = Buffer.from(bits.match(/.{8}/g).map(byte => parseInt(byte, 2)));
  const counter = Buffer.alloc(8); counter.writeBigUInt64BE(BigInt(Math.floor(now / 30000)));
  const digest = createHmac('sha1', key).update(counter).digest(), offset = digest.at(-1) & 15;
  return String((digest.readUInt32BE(offset) & 0x7fffffff) % 1000000).padStart(6, '0');
}

async function staffFixture(t, options = {}) {
  const h = await harness(t, options), actors = await participants(h);
  const people = { ...actors };
  for (const role of ['operations', 'support', 'safety', 'finance']) {
    const actor = h.client(); await actor.register(`workspace-${role}`);
    must(await actors.admin.post(base + '/staff/assign', {
      email: actor.user.email, role, expectedVersion: 0, reason: 'Fictional staff account for integration testing.',
    }));
    must(await staffLogin(actor)); people[role] = actor;
  }
  return { h, ...people };
}

async function nativeLogin(h, actor) {
  const response = await fetch(h.base + '/api/mobile/v1/auth/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: actor.user.email, password: PASSWORD, deviceName: 'Fictional staff isolation phone' }),
  });
  assert.equal(response.status, 200); return response.json();
}

async function step(actor, ride, action, data = {}) {
  return must(await actor.post(`/api/rides/${ride.id}/${action}`, { expectedVersion: ride.version, ...data })).ride;
}

async function booked(f) {
  let ride = await claimRide(f.driver, await requestRide(f.customer));
  ride = await step(f.driver, ride, 'offers', { amountKobo: 470000 });
  ride = await step(f.customer, ride, 'accept', { offerId: ride.negotiation.currentOffer.id });
  return step(f.customer, ride, 'confirm');
}

test('staff roles authorize only their browser workspaces and never promote customer accounts into legacy administrators', async t => {
  const f = await staffFixture(t);
  const permissions = new Map([
    ['/staff', ['admin']], ['/staff/audit', ['admin']], ['/operations', ['admin', 'operations']],
    ['/accounts', ['admin', 'support', 'safety']], ['/trips', ['admin', 'operations', 'support', 'safety']],
    ['/analytics', ['admin', 'finance']],
  ]);
  for (const [path, roles] of permissions) {
    assert.equal((await f.h.client().send(base + path)).status, 401, path);
    assert.equal((await f.customer.send(base + path)).status, 403, path);
    for (const role of ['admin', 'operations', 'support', 'safety', 'finance']) {
      const result = await f[role].send(base + path);
      assert.equal(result.status, roles.includes(role) ? 200 : 403, role + ' ' + path + ' ' + JSON.stringify(result.body));
    }
  }
  for (const role of ['operations', 'support', 'safety', 'finance']) {
    assert.equal(f.h.db.prepare('SELECT role FROM users WHERE id=?').get(f[role].user.id).role, 'customer');
    assert.equal(membership(f.h, f[role]).role, role);
    assert.equal((await f[role].send('/api/admin/drivers')).status, 403);
    assert.equal((await f[role].send('/api/admin/safety')).status, 403);
  }
  const native = await nativeLogin(f.h, f.support);
  const token = native.credentials.accessToken;
  assert.equal((await f.h.client().send(base + '/accounts', { headers: { Authorization: `Bearer ${token}` } })).status, 401);
  const nativeAttempt = await fetch(f.h.base + '/api/mobile/v1/admin/console/accounts', { headers: { Authorization: `Bearer ${token}` } });
  assert.equal(nativeAttempt.status, 404);
  assert.equal((await f.support.send(base + '/accounts', { headers: { Origin: 'https://untrusted.test' } })).status, 403);
  const mutate = { email: f.customer.user.email, role: 'owner', expectedVersion: 0, reason: 'Attempted privilege escalation.' };
  assert.equal((await f.support.post(base + '/staff/assign', mutate)).status, 403);
  assert.equal((await f.admin.post(base + '/staff/assign', mutate)).status, 409);
  assert.equal(f.h.db.prepare('SELECT role FROM users WHERE id=?').get(f.customer.user.id).role, 'customer');
});

test('staff membership updates reject stale versions, replay current authority and invalidate privileges immediately', async t => {
  const f = await staffFixture(t), initial = membership(f.h, f.support), key = randomUUID();
  const data = { email: f.support.user.email, role: 'finance', expectedVersion: initial.version, reason: 'Fictional transfer to finance.' };
  const changed = must(await f.admin.post(base + '/staff/assign', data, key));
  assert.equal(membership(f.h, f.support).role, 'finance');
  assert.ok([401, 403].includes((await f.support.send(base + '/accounts')).status));
  assert.equal(must(await f.admin.post(base + '/staff/assign', data, key)).replayed, true);
  assert.equal((await f.admin.post(base + '/staff/assign', { ...data, role: 'safety' }, key)).body.error.code, 'KEY_REUSED');
  assert.equal((await f.admin.post(base + '/staff/assign', { ...data, role: 'support' })).body.error.code, 'STALE_VERSION');
  must(await staffLogin(f.support));
  assert.equal((await f.support.send(base + '/accounts')).status, 403);
  assert.equal((await f.support.send(base + '/analytics')).status, 200);
  const latest = membership(f.h, f.support);
  must(await f.admin.post(base + '/staff/revoke', { userId: latest.user_id, expectedVersion: latest.version, reason: 'Fictional access ended.' }));
  assert.ok([401, 403].includes((await f.support.send(base + '/analytics')).status));
  assert.equal((await staffLogin(f.support)).status, 403);
  const oldGrant = must(await f.admin.post(base + '/staff/assign', data, key));
  assert.equal(oldGrant.replayed, true);
  assert.equal(membership(f.h, f.support).status, 'revoked', 'replaying an old grant must not restore it');
  const audit = JSON.stringify(must(await f.admin.send(base + '/staff/audit')));
  assert.ok(audit.includes('Fictional transfer to finance.'));
  assert.ok(!audit.includes(PASSWORD));
  assert.equal(changed.replayed, false);
});

test('operations queues have observation timestamps, bounded filters and no private GPS or ride control data', async t => {
  const f = await staffFixture(t), ride = await requestRide(f.customer);
  const result = must(await f.operations.send(base + '/operations?queue=waiting&limit=1'));
  assert.equal(result.asOf, f.h.now);
  assert.equal(result.countScope, 'all_regions');
  assert.equal(result.counts.waitingRequests, 1);
  assert.equal(result.matching.unit, 'offers');
  assert.equal(result.matching.until, f.h.now);
  assert.equal(result.matching.since, f.h.now - 24 * 60 * 60_000);
  assert.equal(result.queues.waiting.items.length, 1);
  const text = JSON.stringify(result);
  for (const privateField of ['pickupPin', 'position_json', 'customerName', 'email', 'password', 'latitude', 'longitude', 'contactIds']) {
    assert.ok(!text.includes(`"${privateField}"`), privateField);
  }
  assert.ok(!text.includes(f.customer.user.email));
  for (const query of ['limit=100000', 'queue=unknown', 'queue=waiting&queue=drivers', 'after=invalid', 'userId=' + f.customer.user.id]) {
    assert.equal((await f.operations.send(base + '/operations?' + query)).status, 400, query);
  }
  await step(f.customer, ride, 'cancel');
  assert.equal(must(await f.operations.send(base + '/operations?queue=waiting')).counts.waitingRequests, 0);
  assert.equal((await f.operations.post(`/api/rides/${ride.id}/cancel`, { expectedVersion: ride.version })).status, 404);
});

test('finance analytics expose aggregate measurements without sample trips, routes or account records', async t => {
  const f = await staffFixture(t), ride = await booked(f);
  const owner = must(await f.admin.send(base + '/analytics'));
  assert.ok(owner.recentTrips.some(row => row.id === ride.id));
  assert.ok(owner.routes.length > 0);
  const finance = must(await f.finance.send(base + '/analytics'));
  assert.equal(finance.summary.requests, 1);
  assert.deepEqual(finance.recentTrips, []); assert.deepEqual(finance.routes, []);
  const serialized = JSON.stringify(finance);
  assert.ok(!serialized.includes(ride.id));
  assert.ok(!serialized.includes(f.customer.user.id));
  assert.ok(!serialized.includes(f.customer.user.email));
  assert.equal((await f.finance.send(base + '/trips/' + ride.id)).status, 403);
});

test('revocation after the HTTP permission gate but before the write transaction cannot commit a staff grant', async t => {
  const h = await harness(t), admin = h.client(), target = h.client();
  await admin.register('write-boundary-owner'); await target.register('write-boundary-target');
  await bootstrapAdmin(h.db, admin.user.email);
  must(await admin.post('/api/auth/login', { email: admin.user.email, password: PASSWORD }));
  const application = createApplication({ db: h.db, clock: () => h.now });
  let revokedBetweenGateAndWrite = false;
  const access = { ...application.staffAccess, async authorize(...args) {
    const result = await application.staffAccess.authorize(...args);
    if (!revokedBetweenGateAndWrite) {
      h.db.prepare('DELETE FROM sessions WHERE user_id=?').run(admin.user.id);
      revokedBetweenGateAndWrite = true;
    }
    return result;
  } };
  const router = createApiRouter({ ...application, staffAccess: access });
  const data = { email: target.user.email, role: 'support', expectedVersion: 0, reason: 'A session revoked before mutation must fail.' };
  const request = Readable.from([Buffer.from(JSON.stringify(data))]);
  request.method = 'POST'; request.url = base + '/staff/assign';
  request.headers = { cookie: admin.cookie, origin: h.base, 'content-type': 'application/json', 'x-csrf-token': admin.csrf,
    'idempotency-key': randomUUID() };
  await assert.rejects(router({ request, response: {}, pathname: request.url, origin: h.base, clientAddress: '127.0.0.1' }), { code: 'UNAUTHENTICATED' });
  assert.equal(revokedBetweenGateAndWrite, true);
  assert.equal(h.db.prepare('SELECT count(*) AS n FROM staff_memberships WHERE user_id=?').get(target.user.id).n, 0);
  assert.equal(h.db.prepare('SELECT count(*) AS n FROM staff_commands').get().n, 0);
  await application.realtime.close();
});

test('support cases keep versioned assignment and note history without allowing safety evidence access', async t => {
  const f = await staffFixture(t), ride = await booked(f), createKey = randomUUID();
  const data = { category: 'support', rideId: ride.id, subject: 'Fictional pickup assistance',
    description: 'Customer asked for assistance understanding the pickup process.', priority: 'normal' };
  let item = must(await f.support.post(base + '/cases', data, createKey), 201).case;
  const path = base + '/cases/' + item.id;
  assert.equal(item.status, 'open'); assert.equal(item.version, 0);
  assert.equal(must(await f.support.post(base + '/cases', data, createKey), 201).case.id, item.id);
  assert.equal(f.h.db.prepare('SELECT count(*) AS n FROM admin_cases WHERE category=?').get('support').n, 1);
  assert.equal((await f.operations.send(path)).status, 403);
  assert.equal((await f.safety.send(path)).status, 404);
  assert.equal((await f.support.post(base + '/cases', { ...data, category: 'safety' })).status, 403);
  assert.equal((await f.support.send(base + '/cases?category=safety')).status, 403);
  assert.equal((await f.support.post(path + '/assign', { expectedVersion: item.version, assigneeId: f.finance.user.id, reason: 'Wrong category staff.' })).status, 400);
  item = must(await f.support.post(path + '/assign', { expectedVersion: item.version, assigneeId: f.support.user.id, reason: 'Taking this support case.' })).case;
  assert.equal(item.assignedTo.id, f.support.user.id);
  const note = { expectedVersion: item.version, body: 'Fictional support note with <plain markup> preserved.' }, key = randomUUID();
  item = must(await f.support.post(path + '/note', note, key)).case;
  assert.equal(must(await f.support.post(path + '/note', note, key)).replayed, true);
  assert.equal((await f.support.post(path + '/note', { ...note, body: 'A different note.' }, key)).body.error.code, 'KEY_REUSED');
  assert.equal((await f.support.post(path + '/status', { expectedVersion: note.expectedVersion, status: 'in_progress', reason: 'Outdated case version.' })).body.error.code, 'STALE_VERSION');
  const detail = must(await f.support.send(path));
  assert.equal(detail.events.filter(event => event.action === 'note').length, 1);
  const serialized = JSON.stringify(detail);
  for (const key of ['pickupPin', 'position_json', 'snapshot', 'contactIds', 'recipientPhone', 'password_hash', 'chat']) {
    assert.ok(!serialized.includes(`"${key}"`), key);
  }
  assert.equal(detail.case.incident, null);
  const responseDueAt = detail.case.responseDueAt;
  f.h.advance(5000);
  item = must(await f.support.post(path + '/status', { expectedVersion: item.version, status: 'in_progress', reason: 'Support is reviewing this request.' })).case;
  assert.equal(item.firstRespondedAt, f.h.now);
  item = must(await f.support.post(path + '/status', { expectedVersion: item.version, status: 'resolved', reason: 'Customer confirmed the question is answered.' })).case;
  assert.equal(item.resolvedAt, f.h.now);
  assert.equal((await f.support.post(path + '/status', { expectedVersion: item.version, status: 'waiting', reason: 'Cannot bypass reopening.' })).status, 400);
  f.h.advance(5000);
  item = must(await f.support.post(path + '/status', { expectedVersion: item.version, status: 'open', reason: 'Customer supplied new information.' })).case;
  assert.equal(item.firstRespondedAt, null); assert.equal(item.resolvedAt, null);
  assert.ok(item.responseDueAt > responseDueAt);
});

test('saved SOS creates a restricted case and status changes stay synchronized with the original incident', async t => {
  const f = await staffFixture(t), ride = await booked(f);
  const incident = must(await f.customer.post(`/api/safety/rides/${ride.id}/incidents`, {
    kind: 'need_help', note: 'Fictional safety report for HTTP integration testing.', contactIds: [],
  })).incident;
  let item = must(await f.safety.send(base + '/cases?category=safety')).cases.find(row => row.incidentId === incident.id);
  assert.ok(item, 'a saved incident should appear once in the safety queue');
  const path = base + '/cases/' + item.id;
  assert.equal((await f.support.send(path)).status, 404);
  assert.equal((await f.support.send(`/api/safety/incidents/${incident.id}`)).status, 404);
  assert.equal(must(await f.support.send(base + '/cases')).cases.some(row => row.id === item.id), false);
  assert.equal((await f.support.post(path + '/note', { expectedVersion: item.version, body: 'Forbidden case note.' })).status, 404);
  const visible = must(await f.safety.send(path));
  assert.equal(visible.case.incident.id, incident.id);
  assert.equal(JSON.stringify(visible).includes('pickupPin'), false);
  assert.equal(JSON.stringify(visible).includes('recipientPhone'), false);
  item = must(await f.safety.post(path + '/status', { expectedVersion: item.version, status: 'in_progress', reason: 'Safety specialist acknowledged the case.' })).case;
  assert.equal(must(await f.customer.send(`/api/safety/incidents/${incident.id}`)).incident.status, 'acknowledged');
  item = must(await f.safety.post(path + '/status', { expectedVersion: item.version, status: 'resolved', reason: 'Fictional incident resolution was reviewed.' })).case;
  assert.equal(must(await f.customer.send(`/api/safety/incidents/${incident.id}`)).incident.status, 'resolved');
  item = must(await f.safety.post(path + '/status', { expectedVersion: item.version, status: 'open', reason: 'New safety information requires review.' })).case;
  let source = must(await f.customer.send(`/api/safety/incidents/${incident.id}`)).incident;
  assert.equal(source.status, 'open');
  source = must(await f.admin.post(`/api/admin/safety/${incident.id}/review`, { expectedVersion: source.version, decision: 'acknowledge', note: 'Legacy review interface remains synchronized.' })).incident;
  const refreshed = must(await f.safety.send(path)).case;
  assert.equal(refreshed.status, 'in_progress');
  assert.ok(refreshed.version > item.version);
  assert.equal((await f.safety.post(path + '/status', { expectedVersion: item.version, status: 'resolved', reason: 'Old case view after another review.' })).body.error.code, 'STALE_VERSION');
  assert.equal(f.h.db.prepare('SELECT count(*) AS n FROM admin_cases WHERE incident_id=?').get(incident.id).n, 1);
  assert.equal(source.status, 'acknowledged');
});

test('enrolled administrators cannot bypass authenticator verification through ordinary login or legacy administrative URLs', async t => {
  const f = await staffFixture(t, { staffMfa: factorConfig() }), ride = await booked(f);
  const incident = must(await f.customer.post(`/api/safety/rides/${ride.id}/incidents`, {
    kind: 'need_help', note: 'Fictional MFA authorization test incident.', contactIds: [],
  })).incident;
  const setup = must(await f.admin.post(base + '/staff/mfa/enroll', { password: PASSWORD })).setup;
  assert.equal(setup.expiresAt, f.h.now + 10 * 60000);
  assert.ok(setup.uri.startsWith('otpauth://totp/'));
  const storedPending = f.h.db.prepare('SELECT * FROM staff_mfa_pending').get();
  assert.ok(!JSON.stringify(storedPending).includes(setup.secret));
  const confirmed = must(await f.admin.post(base + '/staff/mfa/confirm', { code: authenticatorCode(setup.secret, f.h.now) }));
  assert.equal(confirmed.staff.mfa.enrolled, true);
  assert.equal(confirmed.staff.mfa.needsVerification, false);
  assert.equal((await f.admin.send(base + '/operations')).status, 200);
  const ordinary = f.h.client();
  must(await ordinary.post('/api/auth/login', { email: f.admin.user.email, password: PASSWORD }));
  for (const path of [base + '/accounts', base + '/operations', base + '/staff', base + '/cases', '/api/admin/drivers', '/api/admin/safety', `/api/safety/incidents/${incident.id}`]) {
    const denied = await ordinary.send(path);
    assert.equal(denied.status, 403, path + ' ' + JSON.stringify(denied.body));
    assert.equal(denied.body.error.code, 'MFA_REQUIRED', path);
  }
  const writeAttempt = await ordinary.post(`/api/admin/safety/${incident.id}/review`, {
    expectedVersion: incident.version, decision: 'acknowledge', note: 'Attempt through ordinary login.' });
  assert.equal(writeAttempt.body.error.code, 'MFA_REQUIRED');
  assert.equal((await ordinary.post(base + '/staff/mfa/verify', { code: authenticatorCode(setup.secret, f.h.now) })).body.error.code, 'INVALID_MFA_CODE');
  f.h.advance(30000);
  must(await ordinary.post(base + '/staff/mfa/verify', { code: authenticatorCode(setup.secret, f.h.now) }));
  assert.equal((await ordinary.send(base + '/operations')).status, 200);
  f.h.advance(15 * 60000);
  assert.equal((await ordinary.send(base + '/operations')).body.error.code, 'MFA_REQUIRED');
  assert.equal((await ordinary.send(`/api/safety/incidents/${incident.id}`)).body.error.code, 'MFA_REQUIRED');
  const persisted = JSON.stringify(f.h.db.prepare('SELECT * FROM staff_mfa').all()) + JSON.stringify(f.h.db.prepare('SELECT * FROM staff_access_audit').all());
  assert.ok(!persisted.includes(setup.secret)); assert.ok(!persisted.includes(PASSWORD));
});

test('required MFA permits setup before workspace access and a different browser cannot confirm another session setup', async t => {
  const h = await harness(t, { staffMfa: factorConfig(true) }), admin = h.client();
  await admin.register('required-factor-owner'); await bootstrapAdmin(h.db, admin.user.email);
  must(await admin.post('/api/auth/login', { email: admin.user.email, password: PASSWORD }));
  assert.equal((await admin.send(base + '/operations')).body.error.code, 'MFA_SETUP_REQUIRED');
  const state = must(await admin.send(base + '/session'));
  assert.equal(state.staff.mfa.required, true); assert.equal(state.staff.mfa.enrolled, false);
  assert.equal((await admin.post(base + '/staff/mfa/enroll', { password: 'Incorrect fictional password 123' })).status, 401);
  const setup = must(await admin.post(base + '/staff/mfa/enroll', { password: PASSWORD })).setup;
  const other = h.client(); must(await other.post(base + '/login', { email: admin.user.email, password: PASSWORD }));
  assert.equal((await other.post(base + '/staff/mfa/confirm', { code: authenticatorCode(setup.secret, h.now) })).body.error.code, 'MFA_SETUP_EXPIRED');
  must(await admin.post(base + '/staff/mfa/confirm', { code: authenticatorCode(setup.secret, h.now) }));
  assert.equal((await admin.send(base + '/operations')).status, 200);
  assert.equal((await other.send(base + '/operations')).body.error.code, 'MFA_REQUIRED');
});

test('restored snapshots preserve scoped staff membership and enrolled-factor policy while dropping temporary verification', async t => {
  const f = await staffFixture(t, { persistent: true, staffMfa: factorConfig() });
  const setup = must(await f.admin.post(base + '/staff/mfa/enroll', { password: PASSWORD })).setup;
  must(await f.admin.post(base + '/staff/mfa/confirm', { code: authenticatorCode(setup.secret, f.h.now) }));
  must(await f.support.post(base + '/staff/mfa/enroll', { password: PASSWORD }));
  const members = f.h.db.prepare('SELECT * FROM staff_memberships ORDER BY user_id').all();
  const factors = f.h.db.prepare('SELECT * FROM staff_mfa ORDER BY user_id').all();
  assert.equal(f.h.db.prepare('SELECT count(*) AS n FROM staff_stepups').get().n, 1);
  assert.equal(f.h.db.prepare('SELECT count(*) AS n FROM staff_mfa_pending').get().n, 1);
  const folder = mkdtempSync(join(tmpdir(), 'taxi-admin-restore-'));
  t.after(() => rmSync(folder, { recursive: true, force: true }));
  const target = join(folder, 'restored.sqlite'); saveSnapshot(f.h.filename, target, { now: f.h.now });
  assert.equal((await f.admin.send(base + '/operations')).status, 200, 'the source remains authenticated');
  const restored = openDatabase(target);
  try {
    assert.deepEqual(restored.prepare('SELECT * FROM staff_memberships ORDER BY user_id').all(), members);
    assert.deepEqual(restored.prepare('SELECT * FROM staff_mfa ORDER BY user_id').all(), factors);
    for (const table of ['staff_stepups', 'staff_mfa_pending', 'sessions', 'device_sessions']) {
      assert.equal(restored.prepare(`SELECT count(*) AS n FROM ${table}`).get().n, 0, table);
    }
    assert.deepEqual(restored.prepare('PRAGMA foreign_key_check').all(), []);
  } finally { restored.close(); }
});

test('schema thirty-two upgrades preserve domain records and derive owner membership only from existing administrators', t => {
  const folder = mkdtempSync(join(tmpdir(), 'taxi-admin-upgrade-'));
  t.after(() => rmSync(folder, { recursive: true, force: true }));
  const filename = join(folder, 'previous.sqlite'), initial = openDatabase(filename);
  initial.exec(`INSERT INTO users(id,email,name,password_hash,role,created_at) VALUES
    ('existing-owner','existing-owner@example.test','Existing owner','existing-hash','admin',1000),
    ('existing-customer','existing-customer@example.test','Existing customer','existing-hash','customer',1100);
    INSERT INTO sessions(token_hash,user_id,csrf_token,expires_at) VALUES
    ('retained-session','existing-customer','retained-csrf',9999999999999);`);
  removeAdminWorkspaceFixtureTables(initial); initial.exec('PRAGMA user_version=32');
  const users = initial.prepare('SELECT * FROM users ORDER BY id').all();
  const sessions = initial.prepare('SELECT * FROM sessions').all(); initial.close();
  for (let attempt = 0; attempt < 2; attempt++) {
    const db = openDatabase(filename);
    try {
      assert.ok(SCHEMA_VERSION >= 35);
      assert.equal(db.prepare('PRAGMA user_version').get().user_version, SCHEMA_VERSION);
      assert.deepEqual(db.prepare('SELECT * FROM users ORDER BY id').all(), users);
      assert.deepEqual(db.prepare('SELECT * FROM sessions').all(), sessions);
      const members = db.prepare('SELECT user_id,role,status,version FROM staff_memberships').all();
      assert.deepEqual(members.map(row => ({ ...row })), [{ user_id: 'existing-owner', role: 'owner', status: 'active', version: 1 }]);
      assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), []);
    } finally { db.close(); }
  }
});
