import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { harness, participants, requestRide, claimRide, PASSWORD, TEST_NOW } from './helpers.mjs';
import { summarize, filters } from '../src/modules/admin-console/domain.mjs';
import { SCHEMA_VERSION } from '../src/infrastructure/database.mjs';

const root = '/api/admin/console';
async function get(actor, path) { const result = await actor.send(root + path); assert.equal(result.status, 200, JSON.stringify(result.body)); return result.body; }
async function step(actor, ride, action, data = {}) {
  const result = await actor.post(`/api/rides/${ride.id}/${action}`, { expectedVersion: ride.version, ...data });
  assert.equal(result.status, 200, JSON.stringify(result.body)); return result.body.ride;
}
async function complete(customer, driver, amountKobo) {
  let ride = await claimRide(driver, await requestRide(customer));
  ride = await step(driver, ride, 'offers', { amountKobo });
  ride = await step(customer, ride, 'accept', { offerId: ride.negotiation.currentOffer.id });
  ride = await step(customer, ride, 'confirm'); const pickupPin = ride.trip.pickupPin;
  ride = await step(driver, ride, 'depart'); ride = await step(driver, ride, 'arrive');
  ride = await step(driver, ride, 'start', { pickupPin }); return step(driver, ride, 'complete');
}
test('staff reporting rejects anonymous, customer, driver and bearer-only access; staff login never promotes an account', async (t) => {
  const h = await harness(t), { customer, driver, admin } = await participants(h);
  const paths = ['/session', '/accounts', '/trips', '/analytics', `/accounts/${customer.user.id}`];
  for (const path of paths) {
    assert.equal((await h.client().send(root + path)).status, 401);
    for (const person of [customer, driver]) assert.equal((await person.send(root + path)).status, 403);
  }
  const visitor = h.client();
  assert.equal((await visitor.post(root + '/login', { email: customer.user.email, password: PASSWORD })).status, 403);
  assert.equal(visitor.cookie, '');
  assert.equal((await visitor.post(root + '/login', { email: admin.user.email, password: PASSWORD })).status, 200);
  assert.equal((await get(visitor, '/session')).user.id, admin.user.id);
  const body = await get(visitor, '/accounts'); assert.equal(body.viewerId, admin.user.id);
  assert.equal(body.items.some((row) => row.id === admin.user.id), false);
  assert.match(body.items[0].email, /•••/);
  assert.equal((await visitor.send(root + '/accounts', { headers: { Origin: 'https://untrusted.test' } })).status, 403);
  const native = await fetch(h.base + '/api/mobile/v1/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: customer.user.email, password: PASSWORD, deviceName: 'Admin isolation test' }) });
  assert.equal(native.status, 200); const nativeBody = await native.json();
  assert.equal((await h.client().send(root + '/accounts', { headers: { Authorization: `Bearer ${nativeBody.credentials.accessToken}` } })).status, 401);
  await visitor.post('/api/auth/logout'); assert.equal((await visitor.send(root + '/accounts')).status, 401);
});

test('account details include every role, exact lifetime fares and simulated payment totals without duplicate payment attempts', async (t) => {
  const h = await harness(t, { persistent: true }), { customer, drivers, admin } = await participants(h, 2, { online: false });
  const [driver, second] = drivers;
  const paid = await complete(customer, driver, 470001), unpaid = await complete(customer, driver, 500099);
  await complete(driver, second, 600001);
  const paymentPath = `/api/payments/rides/${paid.id}`;
  let payment = (await customer.post(paymentPath + '/start', { expectedVersion: 0 })).body.payment;
  payment = (await customer.post(paymentPath + `/attempts/${payment.attempt.id}/simulate`, { expectedVersion: payment.version, outcome: 'failure' })).body.payment;
  payment = (await customer.post(paymentPath + '/start', { expectedVersion: payment.version })).body.payment;
  await customer.post(paymentPath + `/attempts/${payment.attempt.id}/simulate`, { expectedVersion: payment.version, outcome: 'success' });
  const requested = await requestRide(customer); await step(customer, requested, 'cancel');
  const detail = await get(admin, `/accounts/${driver.user.id}?limit=1`);
  assert.equal(detail.account.type, 'driver'); assert.equal(detail.account.tripCount, 3); assert.equal(detail.trips.items.length, 1);
  assert.equal(detail.driving.completedFareKobo, '970100'); assert.equal(detail.driving.simulatedPaidKobo, '470001');
  assert.equal(detail.driving.outstandingKobo, '500099'); assert.equal(detail.passenger.completedFareKobo, '600001');
  assert.equal(detail.passenger.requests, 1); assert.equal(detail.account.vehicle.colour, 'Yellow');
  const rider = await get(admin, `/accounts/${customer.user.id}`);
  assert.equal(rider.summary.requests, 3); assert.equal(rider.summary.cancelled, 1); assert.equal(rider.passenger.completedFareKobo, '970100');
  const analytics = await get(admin, '/analytics');
  assert.equal(analytics.summary.completedFareKobo, '1570101'); assert.equal(analytics.summary.completed, 3);
  assert.equal(analytics.summary.requests, 4); assert.equal(analytics.summary.simulatedPaidKobo, '470001');
  assert.equal(analytics.summary.outstandingKobo, '1100100'); assert.equal(analytics.summary.completionRate, .75);
  assert.equal(analytics.routes[0].pickup, 'Wuse II'); assert.equal(analytics.routes[0].requests, 4);
  const trip = await get(admin, `/trips/${paid.id}`); assert.equal(trip.trip.fareKobo, '470001');
  assert.equal(trip.trip.paymentStatus, 'paid'); assert.equal(trip.trip.paymentMode, 'simulation');
  assert.equal(trip.activity.at(-1).type, 'completed');
  for (const privateField of ['password_hash', 'csrfToken', 'pickupPin', 'licenceNumber', 'phone', 'position_json', 'verification', 'base64']) {
    assert.ok(!JSON.stringify([detail, trip, analytics]).includes(privateField), privateField);
  }
  assert.ok(h.db.prepare("SELECT count(*) AS n FROM audit_events WHERE kind='admin.account_viewed' AND subject_id=? AND actor_id=?").get(driver.user.id, admin.user.id).n > 0);
  assert.ok(h.db.prepare("SELECT count(*) AS n FROM audit_events WHERE kind='admin.trip_viewed' AND subject_id=?").get(paid.id).n > 0);
  await h.restart(); assert.equal((await get(admin, `/trips/${unpaid.id}`)).trip.paymentStatus, 'unpaid');
});

test('stable keyset pages include older history, navigate backwards, apply literal searches and preserve zero-trip accounts', async (t) => {
  const h = await harness(t), { customer, admin } = await participants(h, 0);
  const empty = h.client(); await empty.register('no-trips-yet');
  // Bulk history fixture exercises pagination beyond the old fifty-row workspace cap.
  const insert = h.db.prepare("INSERT INTO rides(id,customer_id,pickup_id,destination_id,suggested_fare_kobo,status,version,created_at,updated_at) VALUES (?,?,'wuse-ii','maitama',450000,'cancelled',0,?,?)");
  for (let i = 0; i < 1057; i++) insert.run(randomUUID(), customer.user.id, TEST_NOW, TEST_NOW);
  const seen = [], first = await get(admin, '/trips?limit=100'); seen.push(...first.items.map((row) => row.id));
  let result = first;
  while (result.page.next) { result = await get(admin, '/trips?limit=100&before=' + result.page.next); seen.push(...result.items.map((row) => row.id)); }
  assert.equal(seen.length, 1057); assert.equal(new Set(seen).size, 1057);
  const previous = await get(admin, '/trips?limit=100&after=' + result.page.previous);
  assert.deepEqual(previous.items.map((row) => row.id), seen.slice(900, 1000));
  assert.equal((await get(admin, '/analytics')).summary.requests, 1057, 'facts spanning internal batches are counted once');
  const accounts = await get(admin, '/accounts?q=' + encodeURIComponent(empty.user.name)); assert.equal(accounts.items.length, 1);
  const emptyDetail = await get(admin, `/accounts/${empty.user.id}`); assert.equal(emptyDetail.summary.requests, 0); assert.equal(emptyDetail.summary.completionRate, null);
  assert.equal((await get(admin, '/accounts?q=%25')).items.length, 0);
  assert.equal((await get(admin, '/trips?payment=paid')).items.length, 0);
  assert.equal((await get(admin, `/accounts/${customer.user.id}?mode=driver`)).trips.items.length, 0);
  assert.equal((await admin.send(root + '/accounts/' + randomUUID())).status, 404);
  for (const query of ['limit=0', 'limit=101', 'before=broken', 'before=1.' + randomUUID() + '&after=1.' + randomUUID(), 'q=a&q=b', 'role=admin']) {
    assert.equal((await admin.send(root + '/accounts?' + query)).status, 400, query);
  }
});

test('Abuja day boundaries, current request states and zero-filled analytics use the selected request cohort', async (t) => {
  const h = await harness(t), { customer, admin } = await participants(h, 0);
  const midnight = Date.parse('2026-01-01T00:00:00+01:00');
  for (const time of [midnight - 1, midnight, TEST_NOW]) {
    h.db.prepare("INSERT INTO rides(id,customer_id,pickup_id,destination_id,suggested_fare_kobo,status,version,created_at,updated_at) VALUES (?,?,'wuse-ii','maitama',450000,'cancelled',0,?,?)")
      .run(randomUUID(), customer.user.id, time, time);
  }
  let data = await get(admin, '/analytics?from=2026-01-01&to=2026-01-01'); assert.equal(data.summary.requests, 2); assert.equal(data.daily.length, 1);
  data = await get(admin, '/analytics?from=2025-12-30&to=2025-12-31'); assert.equal(data.daily[0].requests, 0); assert.equal(data.daily[1].requests, 1);
  for (const query of ['from=2026-02-30&to=2026-03-01', 'from=2026-01-01', 'from=2026-01-02&to=2026-01-01', 'from=2024-01-01&to=2026-01-01']) {
    assert.equal((await admin.send(root + '/analytics?' + query)).status, 400);
  }
  const ride = await requestRide(customer); h.advance(300000);
  assert.equal((await get(admin, '/trips/' + ride.id)).trip.status, 'expired');
});

test('report totals keep kobo precision beyond safe integers and do not count cancelled fares or suggested prices', () => {
  const fareKobo = Number.MAX_SAFE_INTEGER;
  const result = summarize([
    { createdAt: TEST_NOW, status: 'completed', fareKobo, paymentStatus: 'paid', paymentMode: 'simulation' },
    { createdAt: TEST_NOW, status: 'completed', fareKobo, paymentStatus: 'failed', paymentMode: 'simulation' },
    { createdAt: TEST_NOW, status: 'cancelled', fareKobo }, { createdAt: TEST_NOW, status: 'requested', fareKobo: null },
  ]);
  assert.equal(result.summary.completedFareKobo, String(BigInt(fareKobo) * 2n));
  assert.equal(result.summary.simulatedPaidKobo, String(fareKobo)); assert.equal(result.summary.outstandingKobo, String(fareKobo));
  assert.equal(result.summary.averageFareKobo, String(fareKobo));
  assert.throws(() => filters({ limit: '1e1' }, TEST_NOW, 'accounts'));
});

test('staff pages and modules have direct routes, no embedded private data, no-store caching and the existing restrictive CSP', async (t) => {
  const h = await harness(t), id = randomUUID();
  for (const path of ['/admin', '/admin/accounts', '/admin/trips', '/admin/analytics', '/admin/accounts/' + id, '/admin/trips/' + id,
    '/admin/styles.css', ...['app', 'api-client', 'controller', 'view', 'navigation', 'pages', 'charts', 'ui'].map((name) => '/admin/' + name + '.mjs')]) {
    const response = await fetch(h.base + path); assert.equal(response.status, 200, path);
    assert.equal(response.headers.get('cache-control'), 'no-store'); assert.match(response.headers.get('content-security-policy'), /frame-ancestors 'none'/);
    if (!path.includes('.')) assert.match(await response.text(), /id="sign-in"/);
  }
  assert.equal((await fetch(h.base + '/admin/unknown.mjs')).status, 404);
});

test('schema twelve gains reporting indexes without changing identities, sessions, applications or trip records', async (t) => {
  const h = await harness(t, { persistent: true }), { customer, admin } = await participants(h);
  await requestRide(customer);
  const tables = h.db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all().map((row) => row.name);
  const before = new Map(tables.map((name) => [name, h.db.prepare(`SELECT * FROM ${name}`).all()]));
  h.db.exec('DROP INDEX admin_accounts_created; DROP INDEX admin_rides_created; DROP INDEX admin_customer_trips; PRAGMA user_version=12;');
  await h.restart();
  for (const name of tables) assert.deepEqual(h.db.prepare(`SELECT * FROM ${name}`).all(), before.get(name), name);
  assert.equal(h.db.prepare('PRAGMA user_version').get().user_version, SCHEMA_VERSION);
  assert.equal((await get(admin, '/accounts')).counts.total, 2);
  assert.deepEqual(h.db.prepare('PRAGMA foreign_key_check').all(), []);
});
