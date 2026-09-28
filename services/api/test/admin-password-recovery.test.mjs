import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { openDatabase } from '../src/infrastructure/database.mjs';
import { asAsyncDatabase } from '../src/infrastructure/async-database.mjs';
import { createApplication } from '../src/application.mjs';
import { createAudit } from '../src/infrastructure/audit.mjs';
import { createStaffFactor, totpCode } from '../src/infrastructure/staff-factor.mjs';
import { createAccountsRepository } from '../src/modules/accounts/repository.mjs';
import { createAccountsService } from '../src/modules/accounts/service.mjs';
import { PASSWORD, TEST_NOW, harness } from './helpers.mjs';
import { tokens } from '../src/infrastructure/tokens.mjs';

const NEW_PASSWORD = 'A different administrator password 456';
function fixture(t) {
  const db = openDatabase(':memory:'), mail = { enabled: true, async send() {}, close() {} };
  const app = createApplication({ db, clock: () => TEST_NOW, accountMail: mail, allowSimulation: true,
    staffMfa: { required: false, factor: createStaffFactor({ key: '12'.repeat(32) }) } });
  t.after(async () => { await app.accountEmail.stop(); db.close(); });
  const register = (email) => app.accounts.register({ name: 'Recovery Fixture', email, password: PASSWORD });
  const rows = (table) => db.prepare(`SELECT * FROM ${table}`).all();
  return { db, app, register, rows };
}
async function ownerFixture(t) {
  const f = fixture(t), owner = await f.register('owner@example.test');
  // These delivery intentions and native credentials predate operator bootstrap.
  await f.app.accountEmail.requestReset({ email: owner.email });
  await f.app.accountEmail.deliverPending();
  const device = await f.app.devices.login({ email: owner.email, password: PASSWORD, deviceName: 'Old phone' });
  await f.app.accounts.bootstrapAdmin(owner.email);
  // Exercise revocation of a residual native row, without granting customer access.
  f.db.prepare('UPDATE device_sessions SET revoked_at=NULL WHERE id=?').run(device.credentials.sessionId);
  f.db.prepare("INSERT INTO staff_memberships(user_id,role,status,version,updated_at) VALUES (?,'owner','active',1,?)").run(owner.id, TEST_NOW);
  const web = await f.app.accounts.issueSession(owner.id), second = await f.app.accounts.issueSession(owner.id);
  const setup = (await f.app.staffAccess.enroll({ userId: owner.id, sessionToken: web.token, data: { password: PASSWORD } })).setup;
  await f.app.staffAccess.confirm({ userId: owner.id, sessionToken: web.token, data: { code: totpCode(setup.secret, TEST_NOW) } });
  // A leftover setup is also session-bound and must be removed by the reset.
  f.db.prepare('INSERT INTO staff_mfa_pending(user_id,session_hash,secret_encrypted,expires_at) VALUES (?,?,?,?)')
    .run(owner.id, tokens.digest(second.token), 'fixture-abandoned-setup', TEST_NOW + 60_000);
  f.db.prepare("INSERT INTO account_email_jobs(id,user_id,purpose,email,created_at,next_attempt_at) VALUES (?,?,'changed',?,?,?)")
    .run(randomUUID(), owner.id, owner.email, TEST_NOW, TEST_NOW);
  return { ...f, owner, device, web, second };
}

test('local administrator recovery replaces the password and atomically revokes credentials while preserving MFA, authority and customer journeys', async (t) => {
  const f = await ownerFixture(t);
  const customer = await f.register('customer@example.test');
  const customerWeb = await f.app.accounts.issueSession(customer.id);
  const customerDevice = await f.app.devices.login({ email: customer.email, password: PASSWORD, deviceName: 'Customer phone' });
  const ride = (await f.app.rides.mutate({ userId: customer.id, action: 'create', id: null, key: randomUUID(),
    data: { pickupId: 'wuse-ii', destinationId: 'maitama' } })).ride;
  const oldProof = await f.app.accounts.login({ email: f.owner.email, password: PASSWORD });
  const membership = f.rows('staff_memberships'), mfa = f.rows('staff_mfa'), capabilities = f.rows('account_capabilities');
  const customerRow = f.db.prepare('SELECT * FROM users WHERE id=?').get(customer.id);
  assert.ok(f.rows('account_email_tokens').some(row => row.user_id === f.owner.id));
  assert.equal(f.rows('staff_stepups').length, 1);
  assert.equal(f.rows('staff_mfa_pending').length, 1);

  assert.deepEqual(await f.app.accounts.resetAdminPasswordLocally(' OWNER@example.test ', NEW_PASSWORD), { email: f.owner.email, reset: true });
  await assert.rejects(f.app.accounts.login({ email: f.owner.email, password: PASSWORD }), { code: 'INVALID_CREDENTIALS' });
  await assert.rejects(f.app.accounts.issueSession(f.owner.id, null, oldProof), { code: 'INVALID_CREDENTIALS' });
  await assert.rejects(f.app.devices.issue(f.owner.id, 'Late old login', oldProof), { code: 'INVALID_CREDENTIALS' });
  for (const session of [f.web, f.second]) assert.equal(await f.app.accounts.sessionFor(session.token), null);
  assert.equal(await f.app.devices.sessionFor(f.device.credentials.accessToken), null);
  await assert.rejects(f.app.devices.refresh({ refreshToken: f.device.credentials.refreshToken }), { code: 'UNAUTHENTICATED' });
  assert.equal(f.db.prepare('SELECT revoked_at FROM device_sessions WHERE id=?').get(f.device.credentials.sessionId).revoked_at, TEST_NOW);
  for (const table of ['account_email_tokens', 'account_email_jobs', 'staff_stepups', 'staff_mfa_pending']) {
    assert.equal(f.rows(table).filter(row => row.user_id === f.owner.id).length, 0, table);
  }
  assert.deepEqual(f.rows('staff_memberships'), membership);
  assert.deepEqual(f.rows('staff_mfa'), mfa);
  assert.deepEqual(f.rows('account_capabilities'), capabilities);
  assert.deepEqual(f.db.prepare('SELECT * FROM users WHERE id=?').get(customer.id), customerRow);
  assert.ok(await f.app.accounts.sessionFor(customerWeb.token));
  assert.ok(await f.app.devices.sessionFor(customerDevice.credentials.accessToken));
  assert.deepEqual(await f.app.rides.get(customer, ride.id), ride);
  const fresh = await f.app.accounts.login({ email: f.owner.email, password: NEW_PASSWORD });
  assert.equal(fresh.id, f.owner.id); assert.equal(fresh.role, 'admin');
  const freshWeb = await f.app.accounts.issueSession(fresh.id, null, fresh);
  await assert.rejects(f.app.staffAccess.authorize(fresh.id, 'staff.manage', { sessionToken: freshWeb.token }), { code: 'MFA_REQUIRED' });
  const audit = f.rows('audit_events').filter(row => row.kind === 'admin.password_reset_locally');
  assert.equal(audit.length, 1); assert.equal(audit[0].actor_id, f.owner.id); assert.equal(audit[0].subject_id, f.owner.id);
  assert.equal(JSON.stringify(audit).includes(NEW_PASSWORD), false);
});

test('local recovery cannot create, promote, enable passwords or restore revoked staff membership', async (t) => {
  const f = fixture(t), owner = await f.register('owner@example.test');
  await f.app.accounts.bootstrapAdmin(owner.email);
  const customer = await f.register('customer@example.test'), support = await f.register('support@example.test');
  await f.app.staffAccess.command({ userId: owner.id, action: 'assign', key: randomUUID(),
    data: { email: support.email, role: 'support', expectedVersion: 0, reason: 'Recovery test support membership' } });
  const google = await f.app.accounts.resolveGoogle({ subject: 'recovery-google', email: 'google@example.test', name: 'Google Fixture' });
  // Imported administrator with no password must not acquire one through recovery.
  f.db.prepare("UPDATE users SET role='admin' WHERE id=?").run(google.id);
  const beforeUsers = f.rows('users'), beforeMemberships = f.rows('staff_memberships'), beforeSettings = f.rows('account_password_settings');
  for (const email of ['missing@example.test', customer.email, support.email, google.email]) {
    await assert.rejects(f.app.accounts.resetAdminPasswordLocally(email, NEW_PASSWORD), { code: 'INVALID_ACCOUNT' });
  }
  assert.deepEqual(f.rows('users'), beforeUsers);
  assert.deepEqual(f.rows('staff_memberships'), beforeMemberships);
  assert.deepEqual(f.rows('account_password_settings'), beforeSettings);
  f.db.prepare("INSERT INTO staff_memberships(user_id,role,status,version,updated_at) VALUES (?,'owner','revoked',2,?)").run(owner.id, TEST_NOW);
  const revoked = f.rows('staff_memberships');
  await f.app.accounts.resetAdminPasswordLocally(owner.email, NEW_PASSWORD);
  assert.deepEqual(f.rows('staff_memberships'), revoked);
  await assert.rejects(f.app.staffAccess.describe(owner.id), { code: 'FORBIDDEN' });
});

test('local recovery enforces password bounds without mutation', async (t) => {
  const f = fixture(t), owner = await f.register('owner@example.test');
  await f.app.accounts.bootstrapAdmin(owner.email);
  const before = f.rows('users');
  for (const password of [null, 123, '', 'x'.repeat(11), 'x'.repeat(129)]) {
    await assert.rejects(f.app.accounts.resetAdminPasswordLocally(owner.email, password), { code: 'INVALID_PASSWORD' });
  }
  assert.deepEqual(f.rows('users'), before);
  for (const password of ['x'.repeat(12), 'y'.repeat(128)]) {
    await f.app.accounts.resetAdminPasswordLocally(owner.email, password);
    assert.equal((await f.app.accounts.login({ email: owner.email, password })).id, owner.id);
  }
});

test('a failed recovery audit rolls back password, sessions, MFA proofs and email cleanup together', async (t) => {
  const f = await ownerFixture(t);
  const tables = ['users', 'sessions', 'device_sessions', 'device_refresh_tokens', 'staff_memberships', 'staff_mfa',
    'staff_mfa_pending', 'staff_stepups', 'account_email_tokens', 'account_email_jobs', 'audit_events'];
  const before = Object.fromEntries(tables.map(table => [table, f.rows(table)]));
  f.db.exec("CREATE TRIGGER reject_admin_recovery BEFORE INSERT ON audit_events WHEN NEW.kind='admin.password_reset_locally' BEGIN SELECT RAISE(ABORT,'fixture audit failure'); END;");
  await assert.rejects(f.app.accounts.resetAdminPasswordLocally(f.owner.email, NEW_PASSWORD), /fixture audit failure/);
  for (const table of tables) assert.deepEqual(f.rows(table), before[table], table);
  assert.equal((await f.app.accounts.login({ email: f.owner.email, password: PASSWORD })).id, f.owner.id);
  await f.app.staffAccess.authorize(f.owner.id, 'staff.manage', { sessionToken: f.web.token });
});

test('administrator recovery rechecks the credential and role after asynchronous hashing', async (t) => {
  for (const change of ['password', 'role', 'enabled']) await t.test(change, async (t) => {
    const f = fixture(t), owner = await f.register('owner@example.test');
    await f.app.accounts.bootstrapAdmin(owner.email);
    const web = await f.app.accounts.issueSession(owner.id), db = asAsyncDatabase(f.db);
    let finish, entered; const hashing = new Promise(resolve => { entered = resolve; });
    const accounts = createAccountsService({ repository: createAccountsRepository(db),
      passwords: { hash: () => new Promise(resolve => { finish = resolve; entered(); }) },
      unitOfWork: run => db.transaction(run), audit: createAudit(db), clock: () => TEST_NOW });
    const pending = accounts.resetAdminPasswordLocally(owner.email, NEW_PASSWORD);
    await hashing;
    if (change === 'password') f.db.prepare('UPDATE users SET password_hash=? WHERE id=?').run('concurrent-new-credential', owner.id);
    if (change === 'role') f.db.prepare("UPDATE users SET role='customer' WHERE id=?").run(owner.id);
    if (change === 'enabled') f.db.prepare('INSERT INTO account_password_settings(user_id,enabled) VALUES (?,0)').run(owner.id);
    const before = f.rows('users'); finish('late-recovery-hash');
    await assert.rejects(pending, { code: 'INVALID_ACCOUNT' });
    assert.deepEqual(f.rows('users'), before);
    assert.ok(await f.app.accounts.sessionFor(web.token));
    assert.equal(f.rows('audit_events').filter(row => row.kind === 'admin.password_reset_locally').length, 0);
  });
});

test('operator administrator recovery has no browser or native reset endpoint', async (t) => {
  const h = await harness(t), web = h.client(), customer = h.client();
  await web.register('owner'); await customer.register('customer');
  const app = createApplication({ db: h.db, clock: () => h.now });
  await app.accounts.bootstrapAdmin(web.user.email);
  const login = await web.post('/api/admin/console/login', { email: web.user.email, password: PASSWORD });
  assert.equal(login.status, 200, JSON.stringify(login.body));
  const before = h.db.prepare('SELECT password_hash FROM users WHERE id=?').get(web.user.id);
  for (const path of ['/api/admin/console/password/reset', '/api/auth/admin/password/reset']) {
    const result = await web.post(path, { email: web.user.email, password: NEW_PASSWORD });
    assert.equal(result.status, 404, JSON.stringify(result.body));
  }
  const device = await app.devices.login({ email: customer.user.email, password: PASSWORD, deviceName: 'Customer phone' });
  const response = await fetch(h.base + '/api/mobile/v1/auth/admin/password/reset', { method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${device.credentials.accessToken}` },
    body: JSON.stringify({ email: web.user.email, password: NEW_PASSWORD }) });
  assert.equal(response.status, 404, await response.text());
  assert.deepEqual(h.db.prepare('SELECT password_hash FROM users WHERE id=?').get(web.user.id), before);
});
