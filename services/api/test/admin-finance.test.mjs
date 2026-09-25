import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { openDatabase } from '../src/infrastructure/database.mjs';
import { asAsyncDatabase } from '../src/infrastructure/async-database.mjs';
import { createAdminFinanceRepository } from '../src/modules/admin-finance/repository.mjs';
import { createAdminFinanceService } from '../src/modules/admin-finance/service.mjs';
import { financeFilters, STALE_PENDING_MS } from '../src/modules/admin-finance/domain.mjs';
import { adminFinanceRoutes } from '../src/modules/admin-finance/routes.mjs';

const NOW = Date.UTC(2026, 8, 25, 12), DAY = 86_400_000;
function fixture(t) {
  const raw = openDatabase(':memory:'); t.after(() => raw.close());
  const db = asAsyncDatabase(raw), owner = { id: randomUUID() }, passenger = randomUUID(), driver = randomUUID(), audits = [];
  for (const id of [owner.id, passenger, driver]) raw.prepare("INSERT INTO users(id,email,name,password_hash,role,created_at) VALUES (?,?,?,'private-password','customer',?)")
    .run(id, `${id}@private.example`, 'Private account name', NOW);
  const service = createAdminFinanceService({ repository: createAdminFinanceRepository(db), unitOfWork: (run) => db.transaction(run), clock: () => NOW,
    requirePermission: async (id, permission) => { assert.equal(permission, 'finance.read'); assert.equal(id, owner.id); },
    audit: { record: async (...values) => audits.push(values) } });
  function payment({ amount = 500_000, completedAt = NOW - 100_000, requestedAt = completedAt - 100_000 } = {}) {
    const id = randomUUID();
    raw.prepare(`INSERT INTO rides(id,customer_id,driver_id,pickup_id,destination_id,suggested_fare_kobo,status,created_at,matched_at,updated_at)
      VALUES (?,?,?,'Private home address','Private destination',?,'agreed',?,?,?)`)
      .run(id, passenger, driver, amount, requestedAt, requestedAt + 1, completedAt);
    raw.prepare(`INSERT INTO ride_trips(ride_id,customer_id,driver_id,status,fare_kobo,booked_at,departed_at,arrived_at,started_at,completed_at)
      VALUES (?,?,?,'completed',?,?,?,?,?,?)`).run(id, passenger, driver, amount, requestedAt, requestedAt + 1, requestedAt + 2, requestedAt + 3, completedAt);
    raw.prepare('INSERT INTO payments(ride_id,customer_id,driver_id,amount_kobo,completed_at,updated_at) VALUES (?,?,?,?,?,?)')
      .run(id, passenger, driver, amount, completedAt, completedAt);
    return id;
  }
  function attempt(rideId, { status = 'failed', amount, at = NOW - 30_000, current = true, receipt = false, overrideReceipt = {} } = {}) {
    const payment = raw.prepare('SELECT * FROM payments WHERE ride_id=?').get(rideId), id = randomUUID(), reference = `SIM-${id.toUpperCase()}`;
    raw.prepare(`INSERT INTO payment_attempts(id,ride_id,reference,amount_kobo,currency,provider,status,created_at,resolved_at)
      VALUES (?,?,?,?,'NGN','simulator',?,?,?)`).run(id, rideId, reference, amount ?? payment.amount_kobo, status, at, status === 'pending' ? null : at + 1);
    if (current) raw.prepare('UPDATE payments SET status=?,current_attempt_id=?,updated_at=?,paid_at=? WHERE ride_id=?')
      .run(status === 'succeeded' ? 'paid' : status, id, at + 1, status === 'succeeded' ? at + 1 : null, rideId);
    if (receipt) raw.prepare('INSERT INTO payment_receipts(ride_id,attempt_id,payload_json) VALUES (?,?,?)').run(rideId, id, JSON.stringify({
      number: reference, reference, rideId, amountKobo: payment.amount_kobo, currency: 'NGN', mode: 'simulation',
      completedAt: payment.completed_at, paidAt: at + 1, pickup: 'Private receipt address', destination: 'Another private address',
      email: 'private@example.test', card: 'Secret card information', ...overrideReceipt,
    }));
    return { id, reference, at };
  }
  return { raw, db, owner, service, payment, attempt, audits, passenger, driver };
}

test('finance totals count completed payment records once across retry attempts and retain exact integer kobo', async (t) => {
  const h = fixture(t), amount = Number.MAX_SAFE_INTEGER;
  const paid = h.payment({ amount }), unpaid = h.payment({ amount }), failed = h.payment({ amount: 7 }), pending = h.payment({ amount: 11 });
  for (let index = 0; index < 4; index++) h.attempt(paid, { at: NOW - 50_000 + index });
  h.attempt(paid, { status: 'succeeded', receipt: true });
  h.attempt(failed); h.attempt(pending, { status: 'pending' });
  const result = await h.service.get(h.owner, { limit: '1' });
  assert.equal(result.summary.completedTrips, 4);
  assert.equal(result.summary.paidTrips, 1); assert.equal(result.summary.failedTrips, 1);
  assert.equal(result.summary.pendingTrips, 1); assert.equal(result.summary.unpaidTrips, 1);
  assert.equal(result.summary.grossFareKobo, String(2n * BigInt(amount) + 18n));
  assert.equal(result.summary.simulatedPaidKobo, String(amount));
  assert.equal(result.summary.outstandingKobo, String(BigInt(amount) + 18n));
  assert.equal(result.summary.attentionTrips, 0); assert.equal(result.payments.length, 1);
  assert.equal(result.paymentMode, 'simulation'); assert.equal(result.provider, 'not_configured');
  for (const key of ['feesKobo', 'commissionKobo', 'refundsKobo', 'payoutsKobo']) assert.equal(result.summary[key], null);
  assert.deepEqual(result.availability, { gateway: false, eatsPayments: false, fees: false, commission: false, refunds: false, payouts: false });
  assert.equal(result.scope.basis, 'payment_completed_at'); assert.equal(result.scope.statusBasis, 'current');
  const filtered = await h.service.get(h.owner, { status: 'unpaid', q: unpaid.slice(0, 8) });
  assert.equal(filtered.summary.grossFareKobo, String(amount)); assert.equal(filtered.summary.completedTrips, 1);
  assert.equal(filtered.payments[0].rideId, unpaid);
});

test('finance uses WAT completed-at dates, current statuses and safe historical reference prefixes', async (t) => {
  const h = fixture(t), start = Date.parse('2026-09-20T00:00:00+01:00'), end = start + DAY;
  h.payment({ completedAt: start - 1 }); h.payment({ completedAt: end });
  const included = h.payment({ completedAt: start, requestedAt: start - 50 * DAY });
  const old = h.attempt(included, { status: 'failed', at: start + 10 });
  h.attempt(included, { status: 'succeeded', at: NOW - 60_000, receipt: true });
  const result = await h.service.get(h.owner, { from: '2026-09-20', to: '2026-09-20', status: 'paid', q: old.reference.slice(0, 15) });
  assert.deepEqual(result.payments.map((row) => row.rideId), [included]);
  assert.equal(result.summary.paidTrips, 1); assert.equal(result.scope.timeZone, 'Africa/Lagos');
  assert.equal(result.scope.start, start); assert.equal(result.scope.end, end);
  assert.equal((await h.service.get(h.owner, { status: 'failed' })).summary.completedTrips, 0, 'The cohort uses current payment status, not old failed attempts');
  const defaults = await h.service.get(h.owner);
  assert.equal(defaults.filters.from, '2026-08-27'); assert.equal(defaults.filters.to, '2026-09-25');
});

test('payment pages use stable tie-breakers while whole-cohort exact totals stream in bounded batches', async (t) => {
  const h = fixture(t), ids = Array.from({ length: 1007 }, (_, index) => h.payment({ amount: index + 1 }));
  const calls = [], boundedDb = { prepare(sql) { const statement = h.db.prepare(sql); return { ...statement, async all(...args) {
    const rows = await statement.all(...args); calls.push({ sql, length: rows.length, limit: args[0]?.limit }); return rows;
  } }; } };
  const repository = createAdminFinanceRepository(boundedDb);
  const finance = createAdminFinanceService({ repository, clock: () => NOW, unitOfWork: (run) => h.db.transaction(run),
    requirePermission: async () => {}, audit: { record: async () => {} } });
  let result = await finance.get(h.owner, { limit: '50' });
  assert.equal(result.summary.completedTrips, 1007); assert.equal(result.summary.grossFareKobo, String(1007n * 1008n / 2n));
  assert.deepEqual(calls.map((call) => call.length), [1000, 7, 51]);
  assert.ok(calls.every((call) => call.limit <= 1000));
  const seen = [...result.payments.map((row) => row.rideId)];
  while (result.page.next) {
    result = await h.service.get(h.owner, { limit: '50', before: result.page.next });
    assert.equal(result.summary.completedTrips, 1007); seen.push(...result.payments.map((row) => row.rideId));
  }
  assert.equal(seen.length, 1007); assert.equal(new Set(seen).size, 1007);
  assert.deepEqual(seen, ids.sort().reverse());
});

test('details page attempts independently and expose receipt metadata only, with an audit of the read', async (t) => {
  const h = fixture(t), id = h.payment();
  for (let index = 0; index < 55; index++) h.attempt(id, { at: NOW - 60_000 });
  const paid = h.attempt(id, { status: 'succeeded', receipt: true });
  const before = h.raw.prepare('SELECT total_changes() AS changes').get().changes;
  let result = await h.service.detail(h.owner, id, { limit: '17' }), seen = [];
  const receipt = result.receipt;
  assert.equal(result.payment.status, 'paid'); assert.equal(receipt.consistent, true); assert.equal(receipt.reference, paid.reference);
  assert.equal(receipt.amountKobo, '500000'); assert.deepEqual(result.findings, []);
  do {
    seen.push(...result.attempts.map((attempt) => attempt.id));
    for (const forbidden of [h.passenger, h.driver, 'Private', 'private@example.test', 'Secret', 'receiptMetadata', 'receiptJson', 'pickup', 'destination', 'password', 'payload', 'customerId', 'driverId']) {
      assert.ok(!JSON.stringify(result).includes(forbidden), forbidden);
    }
    result = result.page.next ? await h.service.detail(h.owner, id, { limit: '17', before: result.page.next }) : null;
  } while (result);
  assert.equal(seen.length, 56); assert.equal(new Set(seen).size, 56);
  assert.equal(h.audits.length, 4); assert.deepEqual(h.audits[0], [h.owner.id, 'admin.finance.payment.view', id, NOW]);
  assert.equal(h.raw.prepare('SELECT total_changes() AS changes').get().changes, before, 'Finance reads do not mutate saved payments, attempts or receipts');
});

test('integrity attention reports local mismatches and elapsed pending attempts without pretending to reconcile a provider', async (t) => {
  const h = fixture(t), missing = h.payment(), malformed = h.payment(), mismatch = h.payment(), pending = h.payment(), duplicate = h.payment();
  h.attempt(missing, { status: 'succeeded' });
  h.attempt(malformed, { status: 'succeeded', receipt: true });
  h.raw.prepare("UPDATE payment_receipts SET payload_json='{invalid' WHERE ride_id=?").run(malformed);
  h.attempt(mismatch, { status: 'succeeded', receipt: true, overrideReceipt: { number: 'A private address', reference: { phone: 'Secret phone' } } });
  h.attempt(pending, { status: 'pending', at: NOW - STALE_PENDING_MS });
  h.attempt(duplicate, { status: 'succeeded', current: false }); h.attempt(duplicate, { status: 'failed' });
  const result = await h.service.get(h.owner);
  assert.equal(result.summary.attentionTrips, 5);
  const finding = (id) => result.payments.find((payment) => payment.rideId === id).findings.map((item) => item.code);
  assert.deepEqual(finding(missing), ['receipt_missing']); assert.deepEqual(finding(malformed), ['receipt_mismatch']);
  assert.deepEqual(finding(mismatch), ['receipt_mismatch']); assert.deepEqual(finding(pending), ['stale_pending']);
  assert.deepEqual(finding(duplicate), ['succeeded_attempt_mismatch']);
  const detail = await h.service.detail(h.owner, mismatch);
  assert.equal(detail.receipt.consistent, false); assert.equal(detail.receipt.reference, null); assert.equal(detail.receipt.number, null);
  assert.ok(!JSON.stringify(detail).includes('private address')); assert.ok(!JSON.stringify(detail).includes('Secret phone'));
  assert.deepEqual(detail.integrityPolicy, { basis: 'saved_local_records', stalePendingSeconds: 900 });
  h.raw.prepare('UPDATE payment_receipts SET payload_json=? WHERE ride_id=?').run(JSON.stringify({ padding: 'x'.repeat(20_000) }), malformed);
  assert.equal((await h.service.detail(h.owner, malformed)).receipt.consistent, false);
});

test('integrity checks compare source trip, current attempt amount and outcome against saved payment', async (t) => {
  const h = fixture(t), id = h.payment();
  h.attempt(id, { status: 'succeeded', amount: 499_999, receipt: true });
  h.raw.prepare('UPDATE ride_trips SET fare_kobo=fare_kobo+1 WHERE ride_id=?').run(id);
  let result = await h.service.detail(h.owner, id);
  assert.deepEqual(result.findings.map((finding) => finding.code), ['trip_mismatch', 'attempt_mismatch', 'receipt_mismatch']);
  h.raw.prepare("UPDATE payment_attempts SET status='failed' WHERE ride_id=?").run(id);
  result = await h.service.detail(h.owner, id);
  assert.ok(result.findings.some((finding) => finding.code === 'attempt_status_mismatch'));
  assert.equal(result.payment.amountKobo, '500000', 'A local integrity check never repairs or replaces the saved fare');
});

test('finance validation rejects unsafe searches, invalid ranges, repeated filters and unbounded pages', async (t) => {
  const h = fixture(t);
  for (const query of [{ limit: '51' }, { limit: '1.5' }, { status: 'refunded' }, { q: '%' }, { q: "SIM-' OR 1=1" }, { q: 'ab' },
    { before: '12.not-a-uuid' }, { before: 'NaN.' + randomUUID() }, { from: '2026-02-30', to: '2026-03-01' },
    { from: '2024-09-25', to: '2026-09-25' }, { from: '2026-09-25' }, { from: '2026-09-25', to: '2026-09-26' }, { card: 'private' }]) {
    assert.throws(() => financeFilters(query, NOW), (error) => ['INVALID_INPUT', 'INVALID_FIELDS'].includes(error.code));
  }
  const routes = adminFinanceRoutes(h.service);
  await assert.rejects(routes[0].handle({ user: h.owner, query: new URLSearchParams('status=paid&status=unpaid') }), { code: 'INVALID_INPUT' });
  await assert.rejects(h.service.detail(h.owner, 'bad'), { code: 'INVALID_INPUT' });
  await assert.rejects(h.service.detail(h.owner, randomUUID()), { code: 'NOT_FOUND' });
  const id = h.payment(), route = routes[1], match = route.path.exec('/api/admin/console/finance/' + id);
  assert.equal((await route.handle({ user: h.owner, match, query: new URLSearchParams() })).body.payment.rideId, id);
});

test('fresh finance permission is enforced within the transaction before data and again before release', async () => {
  let inTransaction = false, allowed = false, reads = 0, checks = 0;
  const service = createAdminFinanceService({ repository: {
    async *facts() { reads++; }, list: async () => [], get: async () => { reads++; return null; },
  }, clock: () => NOW, unitOfWork: async (run) => { inTransaction = true; try { return await run(); } finally { inTransaction = false; } },
  requirePermission: async (id, permission) => {
    assert.equal(inTransaction, true); assert.equal(id, 'staff'); assert.equal(permission, 'finance.read'); checks++;
    if (!allowed) throw Object.assign(new Error('Permission revoked'), { code: 'FORBIDDEN' });
  }, audit: { record: async () => assert.fail('Denied reads are not recorded as successful detail views') } });
  await assert.rejects(service.get({ id: 'staff' }), { code: 'FORBIDDEN' }); assert.equal(reads, 0);
  await assert.rejects(service.detail({ id: 'staff' }, randomUUID()), { code: 'FORBIDDEN' }); assert.equal(reads, 0);
  allowed = true; checks = 0; await service.get({ id: 'staff' }); assert.equal(checks, 2); assert.equal(reads, 1);
});
