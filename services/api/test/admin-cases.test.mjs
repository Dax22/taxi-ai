import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { openDatabase } from '../src/infrastructure/database.mjs';
import { asAsyncDatabase } from '../src/infrastructure/async-database.mjs';
import { tokens } from '../src/infrastructure/tokens.mjs';
import { createAudit } from '../src/infrastructure/audit.mjs';
import { createAdminCasesRepository } from '../src/modules/admin-cases/repository.mjs';
import { createAdminCasesService } from '../src/modules/admin-cases/service.mjs';
import { ApplicationError } from '../src/shared/errors.mjs';

function fixture(t) {
  const raw = openDatabase(':memory:'); t.after(() => raw.close());
  if (!raw.prepare("SELECT 1 FROM sqlite_master WHERE name='admin_cases'").get()) raw.exec(readFileSync(new URL('../migrations/034_admin_cases.sql', import.meta.url), 'utf8'));
  const db = asAsyncDatabase(raw), repository = createAdminCasesRepository(db), users = Object.fromEntries(['owner', 'support', 'safety', 'operations', 'customer'].map((role) => [role, randomUUID()]));
  const grants = new Map(Object.entries(users).map(([role, id]) => [id, role === 'owner' ? ['cases.support', 'cases.safety'] : role === 'support' || role === 'safety' ? [`cases.${role}`] : []]));
  for (const [name, id] of Object.entries(users)) raw.prepare("INSERT INTO users(id,email,name,password_hash,role,created_at) VALUES (?,?,?,'test',?,0)").run(id, `${name}@example.test`, name, name === 'customer' ? 'customer' : 'admin');
  const rideId = randomUUID();
  raw.prepare("INSERT INTO rides(id,customer_id,pickup_id,destination_id,suggested_fare_kobo,status,created_at,updated_at) VALUES (?,?,'wuse-ii','maitama',1000,'requested',0,0)").run(rideId, users.customer);
  let now = 1_000_000, rejectReview = false;
  const reviews = [];
  const getTripEvidence = async (id) => id === rideId ? { rideId, status: 'requested', pickup: 'Wuse II', destination: 'Maitama', customer: { id: users.customer, name: 'Customer', email: 'secret-email' },
    driver: { id: randomUUID(), name: 'Driver', vehicle: { model: 'Toyota', plate: 'TEST-123', privateDocument: 'secret-document' }, phone: 'secret-phone' }, pickupPin: 'secret-pin', chat: ['secret-chat'], family: ['secret-family'] } : null;
  const getIncidentEvidence = async (id) => {
    const row = raw.prepare('SELECT id,ride_id AS rideId,kind,status,note,snapshot_json AS snapshotJson,created_at AS createdAt FROM safety_incidents WHERE id=?').get(id);
    return row ? { ...row, snapshot: JSON.parse(row.snapshotJson), notifications: [{ id: randomUUID(), mode: 'simulation', status: 'queued', attempts: 0, updatedAt: now, recipientPhone: 'secret-recipient' }] } : null;
  };
  const service = createAdminCasesService({ repository, unitOfWork: (run) => db.transaction(run), tokens, audit: createAudit(db), clock: () => now,
    requirePermission: async (id, permission) => { if (!grants.get(id)?.includes(permission)) throw new ApplicationError('FORBIDDEN', 'No access.'); },
    listEligibleStaff: async (permission) => [...grants].filter(([, list]) => list.includes(permission)).map(([id]) => ({ id, name: Object.keys(users).find((key) => users[key] === id), secret: 'secret-staff' })),
    getTripEvidence, getIncidentEvidence,
    reviewIncident: async (value) => { if (rejectReview) throw new Error('Review failed'); reviews.push(value); },
  });
  const run = (userId, action, id, data, key = randomUUID()) => service.command({ userId, action, id, data, key });
  const create = (category = 'support', priority = 'normal') => run(users.owner, 'create', null, { category, rideId, subject: 'Customer asked for assistance', description: 'Please review this trip record.', priority });
  function incident(status = 'open') {
    const id = randomUUID(), snapshot = { reporter: { name: 'Customer', role: 'customer', phone: 'secret-reporter' }, location: { lat: 9.06, lng: 7.45, accuracy: 10, capturedAt: now - 10000, source: 'driver_shared', stale: false, session: 'secret-location-session' }, recordedAt: now, pickupPin: 'secret-pin' };
    raw.prepare('INSERT INTO safety_incidents(id,ride_id,reporter_id,kind,note,status,snapshot_json,created_at,updated_at,resolved_at) VALUES (?,?,?,?,?,?,?,?,?,?)')
      .run(id, rideId, users.customer, 'need_help', 'Passenger requested assistance.', status, JSON.stringify(snapshot), now, now, status === 'resolved' ? now : null);
    return id;
  }
  return { raw, db, users, grants, rideId, repository, service, create, run, incident, reviews, get now() { return now; }, advance(ms) { now += ms; }, failReview() { rejectReview = true; } };
}

test('case categories enforce least privilege on list, detail, commands and idempotent replay', async (t) => {
  const h = fixture(t), support = await h.create(), safety = await h.create('safety');
  const result = await h.service.list(h.users.support);
  assert.deepEqual(result.cases.map((row) => row.id), [support.case.id]);
  assert.deepEqual(result.permissions, { support: true, safety: false });
  assert.equal(result.viewerId, h.users.support);
  assert.equal(result.paymentMode, 'simulation');
  await assert.rejects(h.service.list(h.users.support, { category: 'safety' }), { code: 'FORBIDDEN' });
  await assert.rejects(h.service.get(h.users.support, safety.case.id), { code: 'NOT_FOUND' });
  await assert.rejects(h.service.list(h.users.operations), { code: 'FORBIDDEN' });
  await assert.rejects(h.run(h.users.support, 'create', null, { category: 'safety', rideId: h.rideId, subject: 'Unsafe driver behaviour', description: 'Please examine this report.', priority: 'high' }), { code: 'FORBIDDEN' });
  const key = randomUUID(), data = { expectedVersion: support.case.version, body: 'Passenger contacted support.' };
  const saved = await h.run(h.users.support, 'note', support.case.id, data, key);
  assert.equal(saved.case.version, 1);
  assert.equal((await h.run(h.users.support, 'note', support.case.id, data, key)).replayed, true);
  h.grants.set(h.users.support, []);
  await assert.rejects(h.run(h.users.support, 'note', support.case.id, data, key), { code: 'FORBIDDEN' });
});

test('case evidence excludes private booking data and labels saved SOS notification modes accurately', async (t) => {
  const h = fixture(t), incidentId = h.incident();
  const caseId = await h.db.transaction(() => h.service.onIncident({ incidentId, rideId: h.rideId, now: h.now }));
  assert.equal(await h.db.transaction(() => h.service.onIncident({ incidentId, rideId: h.rideId, now: h.now })), caseId);
  assert.equal(h.raw.prepare('SELECT count(*) AS n FROM admin_cases').get().n, 1);
  const result = await h.service.get(h.users.safety, caseId);
  assert.ok(!JSON.stringify(result).includes('secret-'));
  assert.equal(result.case.incident.location.source, 'driver_shared');
  assert.equal(result.case.incident.location.capturedAt, h.now - 10000);
  assert.equal(result.case.incident.notifications[0].mode, 'simulation');
  assert.equal(result.case.incident.notifications[0].status, 'queued');
  assert.ok(result.events.some((event) => event.action === 'incident_linked' && event.actor === null));
  assert.ok(h.raw.prepare("SELECT 1 FROM audit_events WHERE kind='admin.case.view' AND subject_id=?").get(caseId));
  await assert.rejects(h.service.get(h.users.support, caseId), { code: 'NOT_FOUND' });
});

test('case ownership, status changes and reopening require current versions and preserve audit reasons', async (t) => {
  const h = fixture(t); let result = await h.create('support', 'normal'); const id = result.case.id, deadline = result.case.responseDueAt;
  await assert.rejects(h.run(h.users.owner, 'assign', id, { expectedVersion: 0, assigneeId: h.users.safety, reason: 'Assign to specialist.' }), { code: 'INVALID_INPUT' });
  result = await h.run(h.users.owner, 'assign', id, { expectedVersion: 0, assigneeId: h.users.support, reason: 'Support team will follow up.' });
  assert.equal(result.case.assignedTo.id, h.users.support);
  assert.ok(result.events.some((event) => event.action === 'assigned' && event.note.includes(h.users.support)));
  h.advance(10_000);
  result = await h.run(h.users.support, 'priority', id, { expectedVersion: 1, priority: 'low', reason: 'No immediate disruption.' });
  assert.equal(result.case.responseDueAt, deadline, 'lowering priority cannot silently delay the existing target');
  await assert.rejects(h.run(h.users.support, 'status', id, { expectedVersion: 2, status: 'resolved', reason: '' }), { code: 'INVALID_INPUT' });
  result = await h.run(h.users.support, 'status', id, { expectedVersion: 2, status: 'waiting', reason: 'Awaiting passenger response.' });
  assert.equal(result.case.firstRespondedAt, h.now);
  h.advance(10_000);
  result = await h.run(h.users.support, 'status', id, { expectedVersion: 3, status: 'resolved', reason: 'Passenger confirmed the concern is resolved.' });
  assert.equal(result.case.resolvedAt, h.now);
  await assert.rejects(h.run(h.users.support, 'status', id, { expectedVersion: 4, status: 'waiting', reason: 'Additional issue reported.' }), { code: 'INVALID_INPUT' });
  result = await h.run(h.users.support, 'status', id, { expectedVersion: 4, status: 'open', reason: 'Passenger reported a new detail.' });
  assert.equal(result.case.resolvedAt, null); assert.equal(result.case.firstRespondedAt, null);
  assert.equal(result.case.responseDueAt, h.now + 24 * 60 * 60_000);
  assert.ok(result.events.some((event) => event.action === 'reopened'));
  await assert.rejects(h.run(h.users.support, 'note', id, { expectedVersion: 0, body: 'Old browser tab submission.' }), { code: 'STALE_VERSION' });
});

test('idempotency and optimistic versions prevent duplicate cases and concurrent stale notes', async (t) => {
  const h = fixture(t), key = randomUUID(), data = { category: 'support', rideId: h.rideId, subject: 'Trip assistance needed', description: 'Review the saved trip.', priority: 'normal' };
  const saved = await h.run(h.users.support, 'create', null, data, key);
  const replay = await h.run(h.users.support, 'create', null, data, key);
  assert.equal(replay.case.id, saved.case.id); assert.equal(replay.replayed, true);
  await assert.rejects(h.run(h.users.support, 'create', null, { ...data, subject: 'Different assistance needed' }, key), { code: 'KEY_REUSED' });
  assert.equal(h.raw.prepare('SELECT count(*) AS n FROM admin_cases').get().n, 1);
  const results = await Promise.allSettled(['First concurrent note', 'Second concurrent note'].map((body) => h.run(h.users.support, 'note', saved.case.id, { expectedVersion: 0, body })));
  assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
  assert.equal(results.find((r) => r.status === 'rejected').reason.code, 'STALE_VERSION');
  assert.equal(h.raw.prepare('SELECT count(*) AS n FROM admin_case_events').get().n, 2);
});

test('case queues and timelines use bounded stable pagination and reject unsupported filters', async (t) => {
  const h = fixture(t);
  for (let i = 0; i < 5; i++) await h.create(i % 2 ? 'safety' : 'support');
  const ids = []; let before;
  do { const result = await h.service.list(h.users.owner, { limit: '2', ...(before ? { before } : {}) }); ids.push(...result.cases.map((c) => c.id)); before = result.page.next; } while (before);
  assert.equal(ids.length, 5); assert.equal(new Set(ids).size, 5);
  await assert.rejects(h.service.list(h.users.owner, { limit: '1000' }), { code: 'INVALID_INPUT' });
  await assert.rejects(h.service.list(h.users.owner, { before: 'corrupt' }), { code: 'INVALID_CURSOR' });
  await assert.rejects(h.service.list(h.users.owner, { passengerId: h.users.customer }), { code: 'INVALID_FIELDS' });
  const row = await h.repository.get(ids[0]);
  for (let i = 0; i < 5; i++) await h.run(h.users.owner, 'note', row.id, { expectedVersion: i, body: `Review note number ${i}` });
  const events = []; before = null;
  do { const result = await h.service.get(h.users.owner, row.id, { limit: '2', ...(before ? { before } : {}) }); events.push(...result.events.map((e) => e.id)); before = result.page.next; } while (before);
  assert.equal(events.length, 6); assert.equal(new Set(events).size, 6);
});

test('case review synchronises source SOS and failed source review rolls the whole case action back', async (t) => {
  const h = fixture(t), incidentId = h.incident();
  const id = await h.db.transaction(() => h.service.onIncident({ incidentId, rideId: h.rideId, now: h.now }));
  let result = await h.run(h.users.safety, 'status', id, { expectedVersion: 0, status: 'in_progress', reason: 'Safety officer reviewing report.' });
  assert.equal(h.reviews.at(-1).status, 'acknowledged');
  assert.equal(h.reviews.at(-1).incidentId, incidentId);
  h.failReview();
  await assert.rejects(h.run(h.users.safety, 'status', id, { expectedVersion: 1, status: 'resolved', reason: 'Report reviewed and closed.' }), /Review failed/);
  result = await h.service.get(h.users.safety, id);
  assert.equal(result.case.status, 'in_progress'); assert.equal(result.case.version, 1);
  h.advance(1000);
  await h.db.transaction(() => h.service.syncIncident({ incidentId, status: 'resolved', userId: h.users.safety, reason: 'Closed through existing SOS review.', now: h.now }));
  result = await h.service.get(h.users.safety, id);
  assert.equal(result.case.status, 'resolved'); assert.equal(result.case.version, 2);
  assert.equal(result.case.resolvedAt, h.now);
  await h.db.transaction(() => h.service.syncIncident({ incidentId, status: 'resolved', userId: h.users.safety, reason: 'Repeated upstream update.', now: h.now }));
  assert.equal((await h.repository.get(id)).version, 2);
});

test('case upgrade imports saved SOS without duplicating sensitive snapshots', async (t) => {
  const h = fixture(t), id = h.incident('resolved');
  h.raw.prepare('INSERT INTO safety_incident_events(incident_id,actor_id,action,note,version,created_at) VALUES (?,?,?,?,?,?)').run(id, h.users.owner, 'acknowledged', 'Existing review', 1, h.now - 1000);
  h.raw.exec('DROP TABLE admin_case_commands; DROP TABLE admin_case_events; DROP TABLE admin_cases;');
  h.raw.exec(readFileSync(new URL('../migrations/034_admin_cases.sql', import.meta.url), 'utf8'));
  const saved = h.raw.prepare('SELECT * FROM admin_cases WHERE id=?').get(id);
  assert.equal(saved.incident_id, id); assert.equal(saved.status, 'resolved'); assert.equal(saved.first_responded_at, h.now - 1000);
  assert.equal(saved.resolved_at, h.now); assert.ok(!JSON.stringify(saved).includes('secret-'));
  assert.equal(h.raw.prepare('SELECT count(*) AS n FROM admin_case_events WHERE case_id=?').get(id).n, 1);
  assert.equal(h.raw.prepare('PRAGMA foreign_key_check').all().length, 0);
});
