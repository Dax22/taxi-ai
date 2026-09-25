import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { openDatabase } from '../src/infrastructure/database.mjs';
import { asAsyncDatabase } from '../src/infrastructure/async-database.mjs';
import { tokens } from '../src/infrastructure/tokens.mjs';
import { createAudit } from '../src/infrastructure/audit.mjs';
import { createDriversRepository } from '../src/modules/drivers/repository.mjs';
import { eligibility } from '../src/modules/drivers/domain.mjs';
import { createAdminComplianceRepository } from '../src/modules/admin-compliance/repository.mjs';
import { createAdminComplianceService } from '../src/modules/admin-compliance/service.mjs';
import { ApplicationError } from '../src/shared/errors.mjs';

function fixture(t) {
  const raw = openDatabase(':memory:'); t.after(() => raw.close());
  if (!raw.prepare("SELECT 1 FROM sqlite_master WHERE name='admin_compliance_followups'").get()) raw.exec(readFileSync(new URL('../migrations/036_admin_compliance.sql', import.meta.url), 'utf8'));
  const db = asAsyncDatabase(raw), drivers = createDriversRepository(db), users = {}, grants = new Map();
  let now = Date.parse('2026-09-25T12:00:00Z'), failAudit = false;
  for (const role of ['owner', 'operations', 'reader', 'support', 'finance', 'customer']) {
    const id = randomUUID(); users[role] = id;
    raw.prepare("INSERT INTO users(id,email,name,password_hash,role,created_at) VALUES (?,?,?,'test',?,?)").run(id, `${role}@example.test`, role, role === 'owner' ? 'admin' : 'customer', now);
    grants.set(id, ['owner', 'operations'].includes(role) ? ['compliance.read', 'compliance.manage'] : role === 'reader' ? ['compliance.read'] : []);
  }
  const repository = createAdminComplianceRepository(db), audit = createAudit(db);
  const service = createAdminComplianceService({ repository, tokens, unitOfWork: (run) => db.transaction(run), clock: () => now,
    getEligibility: async (id) => eligibility(await drivers.application(id), await drivers.documents(id), now),
    requirePermission: async (id, permission) => { if (!grants.get(id)?.includes(permission)) throw new ApplicationError('FORBIDDEN', 'No access.'); },
    audit: { record: async (...args) => { if (failAudit) throw new Error('Audit storage unavailable'); return audit.record(...args); } } });
  function driver({ status = 'approved', name = 'Test driver', plate = 'ABC-123', expiry = '2027-01-01', missing = [], verified = true, active = true } = {}) {
    const id = randomUUID();
    raw.prepare("INSERT INTO users(id,email,name,password_hash,role,created_at) VALUES (?,?,?,'test','customer',?)").run(id, `${id}@example.test`, name, now);
    raw.prepare("INSERT INTO drivers(user_id,status,vehicle_model,vehicle_plate) VALUES (?,'approved','Toyota Test',?)").run(id, plate);
    const details = { legalName: 'SECRET LEGAL', phone: 'SECRET PHONE', licenceNumber: 'SECRET LICENCE', vehicle: { model: 'Test', plate } };
    const verification = { reference: 'Manual reference 123', method: 'manual', secret: 'SECRET VERIFICATION' };
    raw.prepare('INSERT INTO driver_applications(driver_id,status,details_json,verification_json,reviewed_at,review_reason,updated_at) VALUES (?,?,?,?,?,?,?)')
      .run(id, status, JSON.stringify(details), verified ? JSON.stringify(verification) : null, now, 'Manual review recorded.', now);
    raw.prepare('INSERT INTO driver_application_events(driver_id,actor_id,action,version,payload_json,created_at) VALUES (?,?,?,0,?,?)')
      .run(id, users.owner, status, JSON.stringify({ reason: 'Manual review recorded.', details, verification }), now);
    if (active) raw.prepare("INSERT INTO account_capabilities(user_id,capability,created_at) VALUES (?,'driver',?)").run(id, now);
    for (const kind of ['profile_photo', 'driving_licence', 'vehicle_registration', 'insurance', 'vehicle_photo'].filter((kind) => !missing.includes(kind))) {
      raw.prepare("INSERT INTO driver_documents(id,driver_id,kind,name,mime_type,size_bytes,sha256,expires_on,content,created_at) VALUES (?,?,?,'SECRET DOCUMENT NAME','image/png',1,'SECRET HASH',?,?,?)")
        .run(randomUUID(), id, kind, kind.endsWith('photo') ? null : expiry, Buffer.from([0]), now);
    }
    return id;
  }
  const command = (id, action, data, key = randomUUID(), userId = users.operations) => service.command({ userId, id, action, data, key });
  const follow = (id, version = 0, dueAt = now + 60_000, note = 'Review expiring documents.') => command(id, 'follow-up', { expectedVersion: version, dueAt, note });
  return { raw, db, users, grants, service, repository, driver, command, follow, get now() { return now; }, setNow(time) { now = time; }, failAudit() { failAudit = true; } };
}

test('compliance permissions apply to reads, writes and retries without promoting scoped staff', async (t) => {
  const h = fixture(t), id = h.driver();
  for (const role of ['support', 'finance', 'customer']) {
    await assert.rejects(h.service.list(h.users[role]), { code: 'FORBIDDEN' });
    await assert.rejects(h.service.get(h.users[role], id), { code: 'FORBIDDEN' });
  }
  assert.equal((await h.service.get(h.users.reader, id)).driver.capabilities.canManage, false);
  await assert.rejects(h.command(id, 'follow-up', { expectedVersion: 0, dueAt: h.now + 10000, note: 'Review application.' }, randomUUID(), h.users.reader), { code: 'FORBIDDEN' });
  const key = randomUUID(), data = { expectedVersion: 0, dueAt: h.now + 10000, note: 'Review application.' };
  const saved = await h.command(id, 'follow-up', data, key);
  assert.equal(saved.driver.followUp.version, 1);
  assert.equal(h.raw.prepare('SELECT role FROM users WHERE id=?').get(h.users.operations).role, 'customer');
  h.grants.set(h.users.operations, []);
  await assert.rejects(h.command(id, 'follow-up', data, key), { code: 'FORBIDDEN' });
});

test('expiry queues match canonical Nigeria end-of-day validity and a rolling 30-day window', async (t) => {
  const h = fixture(t);
  h.setNow(Date.parse('2026-09-25T22:59:59.999Z'));
  const today = h.driver({ expiry: '2026-09-25' }), near = h.driver({ expiry: '2026-10-24' }), beyond = h.driver({ expiry: '2026-10-25' });
  h.driver({ expiry: '2026-09-24' }); h.driver({ missing: ['profile_photo'], status: 'submitted' }); h.driver({ verified: false });
  let result = await h.service.list(h.users.operations, { queue: 'expiring', limit: '1' });
  assert.deepEqual(result.summary, { all: 6, submitted: 1, expiring: 2, expired: 1, missing: 1, eligible: 3, openFollowUps: 0, overdueFollowUps: 0 });
  assert.equal(result.drivers.length, 1); assert.ok(result.page.next);
  let record = await h.service.get(h.users.operations, today);
  assert.equal(record.driver.eligibility.eligible, true);
  assert.equal(record.documents.find((doc) => doc.kind === 'insurance').deadline, Date.parse('2026-09-25T23:00:00Z'));
  h.setNow(Date.parse('2026-09-25T23:00:00Z'));
  record = await h.service.get(h.users.operations, today);
  assert.equal(record.driver.eligibility.eligible, false);
  assert.equal(record.documents.find((doc) => doc.kind === 'insurance').state, 'expired');
  result = await h.service.list(h.users.operations, { queue: 'expiring' });
  assert.deepEqual(new Set(result.drivers.map((row) => row.id)), new Set([near, beyond]));
  assert.equal(result.summary.expired, 2);
});

test('queue pagination is bounded and summary counts cover the searched cohort rather than a page', async (t) => {
  const h = fixture(t), ids = [];
  for (let i = 0; i < 7; i++) ids.push(h.driver({ name: `Fleet ${i}`, status: i < 3 ? 'submitted' : 'approved' }));
  h.driver({ name: 'Deleted fleet', active: false }); h.driver({ name: 'Percent% literal' });
  const seen = []; let after = null;
  do {
    const result = await h.service.list(h.users.owner, { q: 'fleet', limit: '2', ...(after ? { after } : {}) });
    assert.equal(result.summary.all, 7); assert.equal(result.summary.submitted, 3);
    seen.push(...result.drivers.map((row) => row.id)); after = result.page.next;
  } while (after);
  assert.deepEqual(seen, ids.sort());
  assert.equal((await h.service.list(h.users.owner, { q: '%' })).drivers.length, 1, 'wildcards are literal search characters');
  assert.equal((await h.service.list(h.users.owner, { queue: 'submitted', q: 'Fleet' })).summary.all, 7);
  for (const query of [{ limit: '1000' }, { queue: 'verified_by_government' }, { followUp: 'emailed' }, { phone: '123' }, { after: 'broken' }]) await assert.rejects(h.service.list(h.users.owner, query));
});

test('internal follow-ups are versioned, idempotent, auditable and never change driver eligibility', async (t) => {
  const h = fixture(t), id = h.driver({ status: 'submitted' }), key = randomUUID();
  const data = { expectedVersion: 0, dueAt: h.now + 1000, note: 'Ask operator to review application.' };
  let result = await h.command(id, 'follow-up', data, key);
  assert.equal(result.followUpMode, 'internal'); assert.equal(result.driver.followUp.status, 'open');
  assert.equal(result.driver.eligibility.eligible, false);
  h.setNow(h.now + 2000);
  result = await h.command(id, 'follow-up', data, key);
  assert.equal(result.replayed, true, 'retry remains valid even after the original due date');
  assert.equal(result.driver.followUp.overdue, true);
  assert.equal((await h.service.list(h.users.operations, { followUp: 'overdue' })).summary.overdueFollowUps, 1);
  await assert.rejects(h.command(id, 'follow-up', { ...data, note: 'Different action.' }, key), { code: 'KEY_REUSED' });
  await assert.rejects(h.command(id, 'complete', { expectedVersion: 0, note: 'Attempt from stale browser.' }), { code: 'STALE_VERSION' });
  result = await h.command(id, 'complete', { expectedVersion: 1, note: 'Reviewed follow-up; application still requires approval.' });
  assert.equal(result.driver.followUp.version, 2); assert.equal(result.driver.followUp.status, 'done');
  assert.equal(result.driver.followUp.completedAt, h.now);
  assert.equal(result.driver.applicationStatus, 'submitted');
  assert.equal(result.events.length, 2);
  assert.equal(h.raw.prepare("SELECT count(*) AS n FROM audit_events WHERE kind LIKE 'admin.compliance.%' AND subject_id=?").get(id).n, 2);
  assert.equal(h.raw.prepare('SELECT count(*) AS n FROM push_jobs').get().n, 0);
  await assert.rejects(h.command(id, 'complete', { expectedVersion: 2, note: 'Complete the task twice.' }), { code: 'INVALID_INPUT' });
  await assert.rejects(h.follow(id, 2, h.now), { code: 'INVALID_INPUT' });
  await assert.rejects(h.follow(id, 2, h.now + 366 * 86400000), { code: 'INVALID_INPUT' });
});

test('concurrent stale actions and failed audit writes cannot leave partial follow-up state', async (t) => {
  const h = fixture(t), id = h.driver();
  const result = await Promise.allSettled([h.follow(id), h.follow(id)]);
  assert.equal(result.filter((row) => row.status === 'fulfilled').length, 1);
  assert.equal(result.find((row) => row.status === 'rejected').reason.code, 'STALE_VERSION');
  h.failAudit();
  await assert.rejects(h.command(id, 'complete', { expectedVersion: 1, note: 'Close task after review.' }), /Audit storage unavailable/);
  assert.equal((await h.repository.get(id)).followupStatus, 'open');
  assert.equal(h.raw.prepare('SELECT count(*) AS n FROM admin_compliance_events').get().n, 1);
});

test('deleted Work profiles cannot be viewed or mutated and old tasks flag application changes on return', async (t) => {
  const h = fixture(t), id = h.driver();
  await h.follow(id);
  h.raw.prepare("DELETE FROM account_capabilities WHERE user_id=? AND capability='driver'").run(id);
  assert.equal((await h.service.list(h.users.operations)).summary.all, 0);
  await assert.rejects(h.service.get(h.users.operations, id), { code: 'NOT_FOUND' });
  await assert.rejects(h.command(id, 'complete', { expectedVersion: 1, note: 'Close deleted profile task.' }), { code: 'NOT_FOUND' });
  h.raw.prepare("UPDATE driver_applications SET version=version+1,status='draft',verification_json=NULL WHERE driver_id=?").run(id);
  h.raw.prepare("INSERT INTO account_capabilities(user_id,capability,created_at) VALUES (?,'driver',?)").run(id, h.now);
  let result = await h.service.get(h.users.operations, id);
  assert.equal(result.driver.followUp.applicationChanged, true); assert.equal(result.driver.eligibility.eligible, false);
  assert.equal(result.review.decision, 'approved', 'reopening never rewrites the prior recorded review decision');
  result = await h.follow(id, 1);
  assert.equal(result.driver.followUp.applicationChanged, false);
});

test('compliance DTOs exclude private application/document fields and use bounded history', async (t) => {
  const h = fixture(t), id = h.driver();
  for (let i = 0; i < 5; i++) await h.follow(id, i);
  let result = await h.service.get(h.users.operations, id, { limit: '2' });
  assert.equal(result.review.reference, 'Manual reference 123'); assert.equal(result.review.reason, 'Manual review recorded.');
  assert.ok(!JSON.stringify(result).includes('SECRET'));
  assert.ok(!JSON.stringify(await h.service.list(h.users.operations)).includes('SECRET'));
  const ids = [];
  do { ids.push(...result.events.map((event) => event.id)); result = result.page.next ? await h.service.get(h.users.operations, id, { limit: '2', before: result.page.next }) : null; } while (result);
  assert.equal(ids.length, 5); assert.equal(new Set(ids).size, 5);
  assert.equal(h.raw.prepare('PRAGMA foreign_key_check').all().length, 0);
});
