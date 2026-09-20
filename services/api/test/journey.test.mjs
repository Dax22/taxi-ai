import { submitApplication, approveApplication } from './driver-fixtures.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { TEST_NOW, harness, PASSWORD } from './helpers.mjs';
import { createApiClient } from '../../../apps/web/public/dashboard/api-client.mjs';

// Real loopback HTTP + SQLite + the shipped browser transport, with isolated cookie jars.
// Provider routes, positions and call invitations below are fixtures, not device/media tests.
function actor(h) {
  let cookie = '', dropNext = null, user = null;
  const attempts = [];
  const api = createApiClient({ makeKey: randomUUID, fetchImpl: async (path, options) => {
    const response = await fetch(h.base + path, { ...options, headers: { ...options.headers,
      ...(cookie ? { Cookie: cookie } : {}), ...(options.method === 'POST' ? { Origin: h.base } : {}) } });
    const next = response.headers.get('set-cookie'); if (next) cookie = next.split(';')[0];
    if (options.method === 'POST') attempts.push({ path, key: options.headers['Idempotency-Key'] });
    if (dropNext === path && response.ok) {
      dropNext = null; await response.arrayBuffer(); throw new Error('Fixture: saved response lost on the way back');
    }
    return response;
  } });
  async function authenticate(path, data) {
    const result = await api.request(path, { method: 'POST', data });
    api.reset(); api.setCsrf(result.csrfToken); user = result.user; return result.user;
  }
  return { api, attempts, get user() { return user; }, loseNextResponse(path) { dropNext = path; },
    register: (name, role = 'customer') => authenticate('/api/auth/register', {
      name, email: `${name}@example.test`, password: PASSWORD, role,
      ...(role === 'driver' ? { vehicle: { model: 'Toyota Corolla', plate: 'TEST-001' } } : {}),
    }),
    login: () => authenticate('/api/auth/login', { email: user.email, password: PASSWORD }),
  };
}

async function step(who, ride, action, extra = {}) {
  return (await who.api.rideCommand(`/api/rides/${ride.id}/${action}`, { expectedVersion: ride.version, ...extra })).ride;
}

test('full customer/driver/admin journey: approval, matching, chat, fare, PIN, restart, payment retry and receipt', async (t) => {
  const pickup = { lat: 9.08, lng: 7.4, name: 'Fixture Wuse pickup' };
  const destination = { lat: 9.1, lng: 7.45, name: 'Fixture Maitama destination' };
  const mapProvider = { mode: 'off', describe: () => ({ enabled: false }),
    route: async () => ({ distanceMeters: 7000, durationSeconds: 1200, coordinates: [[7.4, 9.08], [7.45, 9.1]] }) };
  const h = await harness(t, { persistent: true, mapProvider });
  const customer = actor(h), driver = actor(h), admin = actor(h), outsider = actor(h);
  await customer.register('journey-customer'); await admin.register('journey-operator');
  // Exercise the actual operator command against the disposable database, never data/.
  const cli = execFileSync(process.execPath, ['--experimental-sqlite', fileURLToPath(new URL('../../../scripts/create-admin.mjs', import.meta.url)), admin.user.email],
    { env: { ...process.env, TAXI_AI_DB: h.filename }, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  assert.match(cli, /Administrator enabled/);
  assert.equal((await admin.api.request('/api/session')).user, null, 'bootstrap revokes the old customer session');
  await admin.login(); await driver.register('journey-driver', 'driver'); await outsider.register('journey-outsider');
  const availabilityClient = randomUUID(), locationClient = randomUUID();
  const available = (path, data = {}) => driver.api.command(path, data, { availabilityClient });
  const position = { lat: pickup.lat, lng: pickup.lng, accuracy: 10, capturedAt: TEST_NOW };
  assert.equal(driver.user.driver.status, 'pending');
  await assert.rejects(available('/api/availability/online', { mode: 'gps', position }), { status: 403 });
  await assert.rejects(customer.api.request('/api/admin/drivers'), { status: 403 });
  const applications = await admin.api.request('/api/admin/drivers');
  assert.equal(applications.drivers[0].vehicle.plate, 'TEST-001');
  await submitApplication(driver.api);
  await approveApplication(admin.api, driver.user.id);
  assert.equal((await driver.api.request('/api/session')).user.driver.status, 'approved');
  t.diagnostic('Registration, CLI administrator setup and driver review passed.');

  const quote = (await customer.api.command('/api/locations/quotes', { pickup, destination })).quote;
  let ride = (await customer.api.rideCommand('/api/rides', { quoteId: quote.id })).ride;
  assert.deepEqual((await driver.api.request('/api/rides')).available, [], 'offline drivers do not receive requests');
  await available('/api/availability/online', { mode: 'gps', position });
  assert.equal((await driver.api.request('/api/rides')).available[0].id, ride.id);
  ride = await step(driver, ride, 'claim');
  assert.equal((await driver.api.request('/api/availability', { availabilityClient })).availability, null);
  await assert.rejects(outsider.api.request(`/api/rides/${ride.id}`), { status: 404 });
  const chatPath = `/api/rides/${ride.id}/chat`;
  const message = (await driver.api.command(chatPath + '/messages', { body: 'Fixture: I will meet you at the pickup.' })).message;
  assert.equal((await customer.api.request(chatPath)).unread, 1);
  await customer.api.request(chatPath + '/read', { method: 'POST', data: { throughSequence: message.sequence } });
  assert.equal((await customer.api.request(chatPath)).unread, 0);
  const report = await customer.api.request(`${chatPath}/messages/${message.id}/report`, { method: 'POST', data: { reason: 'spam' } });
  await admin.api.request(`/api/admin/chat-reports/${report.report.id}/review`, { method: 'POST', data: {} });
  assert.equal((await admin.api.request('/api/admin/chat-reports')).reports[0].status, 'reviewed');
  await assert.rejects(admin.api.request(chatPath), { status: 404 });
  t.diagnostic('Nearby matching, private chat, read acknowledgement and limited administrator review passed.');

  ride = await step(driver, ride, 'offers', { amountKobo: 500000 });
  const oldOffer = { expectedVersion: ride.version, offerId: ride.negotiation.currentOffer.id };
  ride = await step(customer, ride, 'offers', { amountKobo: 470001 });
  await assert.rejects(customer.api.rideCommand(`/api/rides/${ride.id}/accept`, oldOffer), { status: 409 });
  ride = await step(driver, ride, 'accept', { offerId: ride.negotiation.currentOffer.id });
  assert.equal(ride.negotiation.agreement.amountKobo, 470001);
  const callClient = randomUUID();
  const call = (await customer.api.command(`/api/rides/${ride.id}/calls`, {}, { callClient })).call;
  await driver.api.command(`/api/calls/${call.id}/accept`, { expectedVersion: call.version }, { callClient: randomUUID() });
  ride = await step(customer, ride, 'confirm'); const pin = ride.trip.pickupPin;
  assert.equal((await driver.api.request(`/api/rides/${ride.id}`)).ride.trip.pickupPin, undefined);
  const share = (await driver.api.command(`/api/rides/${ride.id}/location/start`, {}, { locationClient })).share;
  await driver.api.request(`/api/location-shares/${share.id}/position`, { method: 'POST', locationClient, data: { ...position, sequence: 1 } });
  assert.equal((await customer.api.request(`/api/rides/${ride.id}/location`)).share.position.lat, pickup.lat);
  ride = await step(driver, ride, 'depart'); ride = await step(driver, ride, 'arrive');
  const wrongPin = (pin[0] === '0' ? '1' : '0') + pin.slice(1);
  await assert.rejects(step(driver, ride, 'start', { pickupPin: wrongPin }), { code: 'INVALID_PICKUP_PIN' });
  ride = (await driver.api.request(`/api/rides/${ride.id}`)).ride;
  await h.restart();
  assert.equal((await customer.api.request(`/api/rides/${ride.id}`)).ride.trip.pickupPin, pin);
  ride = await step(driver, ride, 'start', { pickupPin: pin });
  assert.equal((await customer.api.request(`/api/payments/rides/${ride.id}`)).payment, null);
  ride = await step(driver, ride, 'complete');
  assert.equal((await customer.api.request(`/api/rides/${ride.id}/location`)).share, null);
  assert.equal((await customer.api.request('/api/calls', { callClient })).active, null);
  assert.equal((await customer.api.request(chatPath)).canSend, false);
  assert.equal((await driver.api.request('/api/availability', { availabilityClient })).availability, null);
  t.diagnostic('Exact fare, stale-offer rejection, private PIN, restart and trip cleanup passed (location/call fixtures).');

  const payPath = `/api/payments/rides/${ride.id}`;
  let payment = (await customer.api.request(payPath)).payment;
  assert.equal(payment.amountKobo, 470001); assert.equal(payment.status, 'unpaid');
  await assert.rejects(driver.api.command(payPath + '/start', { expectedVersion: payment.version }), { status: 403 });
  payment = (await customer.api.command(payPath + '/start', { expectedVersion: payment.version })).payment;
  payment = (await customer.api.command(`${payPath}/attempts/${payment.attempt.id}/simulate`, { expectedVersion: payment.version, outcome: 'failure' })).payment;
  const failedReference = payment.attempt.reference;
  payment = (await customer.api.command(payPath + '/start', { expectedVersion: payment.version })).payment;
  assert.notEqual(payment.attempt.reference, failedReference);
  const outcomePath = `${payPath}/attempts/${payment.attempt.id}/simulate`;
  const outcome = { expectedVersion: payment.version, outcome: 'success' };
  customer.loseNextResponse(outcomePath);
  await assert.rejects(customer.api.command(outcomePath, outcome), /Connection interrupted/);
  await h.restart();
  const retry = await customer.api.command(outcomePath, outcome);
  assert.equal(retry.replayed, true); assert.equal(retry.payment.status, 'paid');
  const submitted = customer.attempts.filter((item) => item.path === outcomePath);
  assert.equal(submitted.length, 2); assert.equal(submitted[0].key, submitted[1].key);
  const receipt = (await customer.api.request(payPath + '/receipt')).receipt;
  assert.equal(receipt.amountKobo, 470001); assert.match(receipt.notice, /NO MONEY MOVED/);
  assert.deepEqual((await driver.api.request(payPath + '/receipt')).receipt, receipt);
  const earnings = await driver.api.request('/api/driver/earnings');
  assert.equal(earnings.summary.paidTrips, 1); assert.equal(earnings.summary.simulatedPaidKobo, '470001');
  assert.equal(earnings.summary.outstandingKobo, '0');
  const records = await admin.api.request('/api/admin/payments');
  assert.equal(records.payments.length, 1); assert.equal(records.payments[0].status, 'paid');
  assert.ok(!JSON.stringify(records).includes(pickup.name), 'admin ledger does not disclose private route labels');
  for (const path of [payPath, payPath + '/receipt', chatPath, `/api/rides/${ride.id}/location`]) {
    await assert.rejects(outsider.api.request(path), { status: 404 });
  }
  assert.equal((await customer.api.request('/api/rides/history')).rides[0].id, ride.id);
  t.diagnostic('Failed payment, lost success response, same-key retry, receipts and exact earnings passed.');

  // Follow the completed journey with cancellation and a new request: no stale billing/chat.
  const next = (await customer.api.rideCommand('/api/rides', { pickupId: 'wuse-ii', destinationId: 'maitama' })).ride;
  await available('/api/availability/online', { mode: 'sample', areaId: 'wuse-ii' });
  let cancelled = await step(driver, next, 'claim');
  cancelled = await step(driver, cancelled, 'offers', { amountKobo: 400000 });
  cancelled = await step(customer, cancelled, 'accept', { offerId: cancelled.negotiation.currentOffer.id });
  cancelled = await step(customer, cancelled, 'confirm');
  cancelled = await step(customer, cancelled, 'cancel', { reason: 'plans_changed' });
  assert.equal((await customer.api.request(`/api/payments/rides/${cancelled.id}`)).payment, null);
  assert.equal((await driver.api.request('/api/driver/earnings')).summary.completedTrips, 1);
  const fresh = (await customer.api.rideCommand('/api/rides', { pickupId: 'wuse-ii', destinationId: 'maitama' })).ride;
  assert.notEqual(fresh.id, cancelled.id); assert.equal(fresh.status, 'requested');
  assert.equal((await customer.api.request('/api/rides/history')).rides.length, 2);
  await customer.api.request('/api/auth/logout', { method: 'POST' }); customer.api.reset();
  await assert.rejects(customer.api.request(payPath + '/receipt'), { status: 401 });
  await customer.login(); assert.deepEqual((await customer.api.request(payPath + '/receipt')).receipt, receipt);
  t.diagnostic('Cancellation, a fresh request, logout protection and receipt recovery passed.');
});
