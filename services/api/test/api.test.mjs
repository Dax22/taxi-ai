import { submitApplication, approveApplication, fixtureApi } from './driver-fixtures.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { get as httpGet } from 'node:http';
import { randomUUID } from 'node:crypto';
import { harness, participants, requestRide, claimRide, bootstrapAdmin, PASSWORD } from './helpers.mjs';

test('registration stores salted password hashes and sessions; identities and roles cannot be supplied as privileges', async (t) => {
  const h = await harness(t);
  const first = h.client(), second = h.client();
  const registered = await first.register('alice');
  await second.register('bob');
  assert.match(registered.headers.get('set-cookie'), /HttpOnly; SameSite=Strict/);
  const users = h.db.prepare('SELECT password_hash FROM users ORDER BY email').all();
  assert.ok(users.every((user) => user.password_hash.startsWith('scrypt$') && !user.password_hash.includes(PASSWORD)));
  assert.notEqual(users[0].password_hash, users[1].password_hash);
  assert.ok(h.db.prepare('SELECT token_hash FROM sessions').all().every((row) => !first.cookie.includes(row.token_hash)));
  assert.equal((await first.post('/api/auth/register', { name: 'intruder', email: 'i@example.test', password: PASSWORD, role: 'admin' })).status, 400);
  assert.equal((await first.post('/api/auth/register', { name: 'driver', email: 'd@example.test', password: PASSWORD, role: 'driver', approved: true })).status, 400);
  assert.equal((await first.post('/api/auth/register', { name: 'Alice', email: 'ALICE@example.test', password: PASSWORD, role: 'customer' })).status, 409);
  assert.equal((await second.post('/api/auth/login', { email: 'alice@example.test', password: 'This is the wrong password' })).status, 401);
  const me = await first.send('/api/session');
  assert.equal(me.body.user.id, first.user.id);
  assert.ok(!JSON.stringify(me.body).includes('password_hash'));
});

test('login rotates sessions; logout and expiry prevent reuse of previous cookies', async (t) => {
  const h = await harness(t);
  const client = h.client(); await client.register('alice');
  const old = h.client(); old.cookie = client.cookie;
  await client.post('/api/auth/login', { email: client.user.email, password: PASSWORD });
  assert.notEqual(client.cookie, old.cookie);
  assert.equal((await old.send('/api/rides')).status, 401);
  const loggedOutCookie = client.cookie;
  assert.equal((await client.post('/api/auth/logout')).status, 200);
  old.cookie = loggedOutCookie;
  assert.equal((await old.send('/api/rides')).status, 401);
  await client.post('/api/auth/login', { email: 'alice@example.test', password: PASSWORD });
  h.advance(12 * 60 * 60_000);
  assert.equal((await client.send('/api/session')).body.user, null);
  assert.equal((await client.send('/api/rides')).status, 401);
});

test('writes require same-origin JSON and a session CSRF token; malformed, oversized and foreign-host requests fail', async (t) => {
  const h = await harness(t);
  const client = h.client(); await client.register('alice');
  const data = { pickupId: 'wuse-ii', destinationId: 'maitama' };
  for (const headers of [{ Origin: 'https://example.org' }, { Origin: null },
    { 'X-CSRF-Token': null }, { 'X-CSRF-Token': 'wrong' }, { 'X-CSRF-Token': 'é'.repeat(64) },
    { 'Sec-Fetch-Site': 'cross-site' }]) {
    const response = await client.send('/api/rides', { method: 'POST', data, headers });
    assert.equal(response.status, 403, JSON.stringify(headers));
  }
  // Fetch implementations may normalize Host. Send the exact header using HTTP.
  const hostStatus = await new Promise((resolve, reject) => {
    httpGet(`${h.base}/api/session`, { headers: { Host: 'attacker.example' } }, (response) => {
      response.resume(); response.on('end', () => resolve(response.statusCode));
    }).on('error', reject);
  });
  assert.equal(hostStatus, 403);
  assert.equal((await client.send('/api/rides', { method: 'POST', data, headers: { 'Content-Type': 'text/plain' } })).status, 415);
  assert.equal((await client.send('/api/rides', { method: 'POST', rawBody: '{' })).status, 400);
  assert.equal((await client.send('/api/rides', { method: 'POST', rawBody: JSON.stringify({ tooMuch: 'a'.repeat(17000) }) })).status, 413);
  assert.equal((await client.send('/api/rides', { method: 'DELETE' })).status, 405);
  assert.equal(h.db.prepare('SELECT count(*) AS count FROM rides').get().count, 0);
  assert.equal((await h.client().post('/api/rides', data)).status, 401);
});

test('only the local first-admin command creates an admin and only admins can review pending drivers', async (t) => {
  const h = await harness(t);
  const customer = h.client(), driver = h.client(), admin = h.client();
  await customer.register('customer'); await driver.register('driver', 'driver'); await admin.register('admin');
  assert.equal(driver.user.driver.status, 'pending');
  const ride = await requestRide(customer);
  assert.deepEqual((await driver.send('/api/rides')).body.available, []);
  assert.equal((await driver.post(`/api/rides/${ride.id}/claim`, { expectedVersion: 0 })).status, 403);
  assert.equal((await customer.send('/api/admin/drivers')).status, 403);
  assert.equal((await driver.post(`/api/admin/drivers/${driver.user.id}/review`, { decision: 'approved' })).status, 403);
  bootstrapAdmin(h.db, admin.user.email);
  assert.equal((await admin.send('/api/rides')).status, 401, 'promotion revokes existing sessions');
  assert.throws(() => bootstrapAdmin(h.db, customer.user.email), { code: 'ADMIN_EXISTS' });
  await admin.post('/api/auth/login', { email: admin.user.email, password: PASSWORD });
  await submitApplication(fixtureApi(driver));
  const approved = await approveApplication(fixtureApi(admin), driver.user.id);
  assert.equal((await admin.post(`/api/admin/drivers/${driver.user.id}/review`, { decision: 'rejected', expectedVersion: approved.version, reason: 'Cannot review the same version twice.' })).status, 409);
  assert.equal((await driver.send('/api/session')).body.user.driver.status, 'approved');
  assert.equal((await driver.send('/api/rides')).body.available.length, 0, 'approval alone does not make a driver online');
  await driver.online();
  assert.equal((await driver.send('/api/rides')).body.available.length, 1);
  await claimRide(driver, ride);
});

test('ride creation is idempotent, validates the route, and permits one open request per customer', async (t) => {
  const h = await harness(t);
  const client = h.client(); await client.register('alice');
  const key = randomUUID();
  const data = { pickupId: 'wuse-ii', destinationId: 'maitama' };
  assert.equal((await client.post('/api/rides', { ...data, destinationId: data.pickupId })).status, 400);
  assert.equal((await client.post('/api/rides', { ...data, customerId: 'someone-else' })).status, 400);
  assert.equal((await client.send('/api/rides', { method: 'POST', data })).status, 400);
  const [one, two] = await Promise.all([client.post('/api/rides', data, key), client.post('/api/rides', data, key)]);
  assert.deepEqual([one.status, two.status].sort(), [200, 201]);
  assert.equal(one.body.ride.id, two.body.ride.id);
  assert.equal(one.body.ride.suggestedFareKobo, 450000);
  assert.equal((await client.post('/api/rides', data)).body.error.code, 'OPEN_REQUEST_EXISTS');
  assert.equal((await client.post('/api/rides', { ...data, destinationId: 'jabi' }, key)).body.error.code, 'KEY_REUSED');
  assert.equal(h.db.prepare('SELECT count(*) AS count FROM rides').get().count, 1);
});

test('competing approved drivers cannot both claim a request or hold two negotiations', async (t) => {
  const h = await harness(t);
  const { customer, drivers } = await participants(h, 2);
  const ride = await requestRide(customer);
  const attempts = await Promise.all(drivers.map((driver) => driver.post(`/api/rides/${ride.id}/claim`, { expectedVersion: 0 })));
  assert.deepEqual(attempts.map((result) => result.status).sort(), [200, 409]);
  const winnerIndex = attempts.findIndex((result) => result.status === 200);
  const winner = drivers[winnerIndex], loser = drivers[1 - winnerIndex];
  const other = h.client(); await other.register('other');
  const otherRide = await requestRide(other);
  assert.equal((await winner.post(`/api/rides/${otherRide.id}/claim`, { expectedVersion: 0 })).body.error.code, 'DRIVER_BUSY');
  assert.equal((await loser.send(`/api/rides/${ride.id}`)).status, 404);
  await claimRide(loser, otherRide);
});

test('participants alone can read or change a request, and peer payloads contain no email or credentials', async (t) => {
  const h = await harness(t);
  const { customer, driver } = await participants(h);
  const outsider = h.client(); await outsider.register('outsider');
  const requested = await requestRide(customer);
  const available = (await driver.send('/api/rides')).body.available[0];
  assert.ok(!Object.hasOwn(available, 'customer'));
  const ride = await claimRide(driver, requested);
  assert.equal((await outsider.send(`/api/rides/${ride.id}`)).status, 404);
  assert.equal((await outsider.post(`/api/rides/${ride.id}/offers`, { expectedVersion: ride.version, amountKobo: 470000 })).status, 404);
  assert.equal((await outsider.post(`/api/rides/${ride.id}/cancel`, { expectedVersion: ride.version })).status, 404);
  assert.equal((await driver.post('/api/rides', { pickupId: 'garki', destinationId: 'jabi' })).body.error.code, 'DRIVER_BUSY');
  const payload = JSON.stringify((await customer.send(`/api/rides/${ride.id}`)).body);
  for (const secret of ['@example.test', 'password', 'csrf', 'token_hash', 'phone']) assert.ok(!payload.includes(secret), secret);
  assert.ok(payload.includes('Toyota Corolla'));
});

test('stale counteroffers, self-acceptance, forged clocks and invalid amounts never create an agreement', async (t) => {
  const h = await harness(t);
  const { customer, driver } = await participants(h);
  let ride = await claimRide(driver, await requestRide(customer));
  const path = `/api/rides/${ride.id}`;
  assert.equal((await customer.post(`${path}/accept`, { expectedVersion: ride.version, offerId: 'suggestion' })).body.error.code, 'NO_OFFER');
  for (const data of [{ expectedVersion: ride.version, amountKobo: '450000' },
    { expectedVersion: ride.version, amountKobo: 0 }, { expectedVersion: ride.version, amountKobo: 12.5 },
    { expectedVersion: ride.version, amountKobo: 450000, now: 0 },
    { expectedVersion: String(ride.version), amountKobo: 450000 },
    { expectedVersion: ride.version, amountKobo: 450000, actorId: driver.user.id }]) {
    assert.equal((await customer.post(`${path}/offers`, data)).status, 400);
  }
  ride = (await driver.post(`${path}/offers`, { expectedVersion: ride.version, amountKobo: 500000 })).body.ride;
  const old = ride;
  assert.equal((await driver.post(`${path}/accept`, { expectedVersion: ride.version, offerId: ride.negotiation.currentOffer.id })).body.error.code, 'SELF_ACCEPTANCE');
  ride = (await customer.post(`${path}/offers`, { expectedVersion: ride.version, amountKobo: 470000 })).body.ride;
  assert.equal((await customer.post(`${path}/accept`, { expectedVersion: old.version, offerId: old.negotiation.currentOffer.id })).body.error.code, 'STALE_VERSION');
  assert.equal((await driver.post(`${path}/accept`, { expectedVersion: ride.version, offerId: old.negotiation.currentOffer.id })).body.error.code, 'STALE_OFFER');
  assert.equal((await driver.send(path)).body.ride.negotiation.agreement, null);
  const key = randomUUID();
  const acceptance = { expectedVersion: ride.version, offerId: ride.negotiation.currentOffer.id };
  const [first, second] = await Promise.all([driver.post(`${path}/accept`, acceptance, key), driver.post(`${path}/accept`, acceptance, key)]);
  assert.equal(first.status, 200); assert.equal(second.status, 200);
  assert.equal(first.body.ride.negotiation.agreement.amountKobo, 470000);
  assert.equal(h.db.prepare("SELECT count(*) AS count FROM fare_events WHERE type = 'accept'").get().count, 1);
  const cancelled = await customer.post(`${path}/cancel`, { expectedVersion: first.body.ride.version });
  assert.equal(cancelled.status, 200);
  assert.equal(cancelled.body.ride.status, 'cancelled');
  assert.deepEqual(cancelled.body.ride.negotiation.agreement, first.body.ride.negotiation.agreement,
    'cancelling the journey preserves the immutable fare agreement');
});

test('a failed retry-key write rolls back the fare, ride version and audit, then the same command can succeed', async (t) => {
  const h = await harness(t);
  const { customer, driver } = await participants(h);
  const ride = await claimRide(driver, await requestRide(customer));
  const auditCount = h.db.prepare('SELECT count(*) AS count FROM audit_events').get().count;
  const key = randomUUID();
  const path = `/api/rides/${ride.id}/offers`;
  const command = { expectedVersion: ride.version, amountKobo: 470000 };
  // Fail at the last persistence step, after the fare, ride and audit writes.
  h.db.exec(`CREATE TRIGGER reject_retry_write BEFORE INSERT ON idempotency
    BEGIN SELECT RAISE(ABORT, 'test-only storage failure'); END`);
  const failed = await customer.post(path, command, key);
  assert.equal(failed.status, 500);
  assert.ok(!JSON.stringify(failed.body).includes('test-only storage failure'));
  assert.equal(h.db.prepare('SELECT version FROM rides WHERE id = ?').get(ride.id).version, ride.version);
  assert.equal(h.db.prepare('SELECT count(*) AS count FROM fare_events').get().count, 0);
  assert.equal(h.db.prepare('SELECT count(*) AS count FROM audit_events').get().count, auditCount);
  assert.equal(h.db.prepare('SELECT count(*) AS count FROM idempotency WHERE key = ?').get(key).count, 0);

  h.db.exec('DROP TRIGGER reject_retry_write');
  const saved = await customer.post(path, command, key);
  assert.equal(saved.status, 200);
  assert.equal(saved.body.ride.version, ride.version + 1);
  assert.equal(saved.body.ride.negotiation.currentOffer.amountKobo, 470000);
  const replayed = await customer.post(path, command, key);
  assert.equal(replayed.status, 200);
  assert.equal(replayed.body.ride.version, saved.body.ride.version);
  assert.equal(h.db.prepare('SELECT count(*) AS count FROM fare_events').get().count, 1);
  assert.equal(h.db.prepare('SELECT count(*) AS count FROM audit_events').get().count, auditCount + 1);
});

test('offer expiry uses the server clock at the exact deadline and cancellation prevents later acceptance', async (t) => {
  const h = await harness(t);
  const { customer, driver } = await participants(h);
  let ride = await claimRide(driver, await requestRide(customer));
  const path = `/api/rides/${ride.id}`;
  ride = (await customer.post(`${path}/offers`, { expectedVersion: ride.version, amountKobo: 450000 })).body.ride;
  h.advance(120000);
  const acceptance = { expectedVersion: ride.version, offerId: ride.negotiation.currentOffer.id };
  assert.equal((await driver.post(`${path}/accept`, acceptance)).body.error.code, 'OFFER_EXPIRED');
  assert.equal((await driver.send(path)).body.ride.version, ride.version);
  ride = (await driver.post(`${path}/cancel`, { expectedVersion: ride.version })).body.ride;
  assert.equal(ride.status, 'cancelled');
  assert.equal((await customer.post(`${path}/accept`, { ...acceptance, expectedVersion: ride.version })).body.error.code, 'REQUEST_CLOSED');
  const next = await requestRide(customer);
  assert.notEqual(next.id, ride.id);
  assert.equal((await customer.post(`/api/rides/${next.id}/cancel`, { expectedVersion: 0 })).body.ride.status, 'cancelled');
});

test('requests, offers, acceptance, sessions and retry keys survive a complete database/server restart', async (t) => {
  const h = await harness(t, { persistent: true });
  const { customer, driver } = await participants(h);
  let ride = await claimRide(driver, await requestRide(customer));
  const path = `/api/rides/${ride.id}`;
  ride = (await driver.post(`${path}/offers`, { expectedVersion: ride.version, amountKobo: 500000 })).body.ride;
  await h.restart();
  assert.equal((await customer.send('/api/session')).body.user.name, 'customer');
  assert.equal((await customer.send(path)).body.ride.negotiation.currentOffer.amountKobo, 500000);
  const key = randomUUID();
  const data = { expectedVersion: ride.version, offerId: ride.negotiation.currentOffer.id };
  const agreed = (await customer.post(`${path}/accept`, data, key)).body.ride;
  await h.restart();
  const restored = (await driver.send(path)).body.ride;
  assert.deepEqual(restored, agreed);
  const replay = await customer.post(`${path}/accept`, data, key);
  assert.equal(replay.status, 200);
  assert.equal(replay.body.replayed, true);
  assert.equal(h.db.prepare("SELECT count(*) AS count FROM fare_events WHERE type = 'accept'").get().count, 1);
  assert.equal(h.db.prepare("SELECT count(*) AS count FROM audit_events WHERE kind = 'fare.accept'").get().count, 1);
});

test('authentication rate limits survive restart and expire after their window', async (t) => {
  const h = await harness(t, { persistent: true });
  const client = h.client();
  for (let i = 0; i < 30; i++) assert.equal((await client.post('/api/auth/login', {})).status, 400);
  assert.equal((await client.post('/api/auth/login', {})).status, 429);
  await h.restart();
  assert.equal((await client.post('/api/auth/login', {})).status, 429);
  h.advance(10 * 60_000);
  assert.equal((await client.post('/api/auth/login', {})).status, 400);
});
