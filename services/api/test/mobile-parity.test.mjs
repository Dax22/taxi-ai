import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { harness, participants, requestRide, claimRide, PASSWORD } from './helpers.mjs';

async function mobile(h, path, { token, data, key } = {}) {
  const response = await fetch(h.base + '/api/mobile/v1' + path, { method: data === undefined ? 'GET' : 'POST',
    headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(data === undefined ? {} : { 'Content-Type': 'application/json', 'Idempotency-Key': key ?? randomUUID() }) },
    ...(data === undefined ? {} : { body: JSON.stringify(data) }) });
  return { status: response.status, body: await response.json() };
}
async function webStep(actor, ride, action, data = {}) {
  if (['depart', 'arrive', 'start'].includes(action)) await actor.shareTripLocation(ride.id);
  const result = await actor.post(`/api/rides/${ride.id}/${action}`, { expectedVersion: ride.version, ...data });
  assert.equal(result.status, 200, JSON.stringify(result.body)); return result.body.ride;
}

test('a new customer can register and sign in directly from the native app', async (t) => {
  const h = await harness(t), email = `new-${randomUUID()}@example.test`;
  const result = await mobile(h, '/auth/register', { data: { name: 'New rider', email, password: PASSWORD, deviceName: 'My iPhone' } });
  assert.equal(result.status, 200, JSON.stringify(result.body));
  assert.equal(result.body.user.email, email);
  assert.equal((await mobile(h, '/session', { token: result.body.credentials.accessToken })).body.user.id, result.body.user.id);
  assert.equal((await mobile(h, '/auth/register', { data: { name: 'Duplicate', email, password: PASSWORD, deviceName: 'Second phone' } })).body.error.code, 'EMAIL_IN_USE');
  assert.equal((await mobile(h, '/devices', { token: result.body.credentials.accessToken })).body.devices.length, 1);
});

test('native trip payment, receipt and driver earnings use the same saved records as web', async (t) => {
  const h = await harness(t), { customer, driver } = await participants(h);
  const customerAuth = await mobile(h, '/auth/login', { data: { email: customer.user.email, password: PASSWORD, deviceName: 'Customer phone' } });
  const driverAuth = await mobile(h, '/auth/login', { data: { email: driver.user.email, password: PASSWORD, deviceName: 'Driver phone' } });
  assert.equal(customerAuth.status, 200); assert.equal(driverAuth.status, 200);
  const customerToken = customerAuth.body.credentials.accessToken, driverToken = driverAuth.body.credentials.accessToken;
  let ride = await claimRide(driver, await requestRide(customer));
  ride = await webStep(driver, ride, 'offers', { amountKobo: 470001 });
  ride = await webStep(customer, ride, 'accept', { offerId: ride.negotiation.currentOffer.id });
  ride = await webStep(customer, ride, 'confirm'); const pickupPin = ride.trip.pickupPin;
  ride = await webStep(driver, ride, 'depart'); ride = await webStep(driver, ride, 'arrive');
  ride = await webStep(driver, ride, 'start', { pickupPin }); ride = await webStep(driver, ride, 'complete');
  const path = `/payments/rides/${ride.id}`;
  let result = await mobile(h, path, { token: customerToken });
  assert.equal(result.status, 200); assert.equal(result.body.payment.status, 'unpaid');
  assert.equal((await mobile(h, path, { token: driverToken })).body.payment.rideId, ride.id);
  const key = randomUUID(), originalVersion = result.body.payment.version;
  result = await mobile(h, path + '/start', { token: customerToken, data: { expectedVersion: originalVersion }, key });
  assert.equal(result.status, 200, JSON.stringify(result.body)); assert.equal(result.body.payment.status, 'pending');
  assert.equal((await mobile(h, path + '/start', { token: customerToken, data: { expectedVersion: originalVersion }, key })).status, 200);
  const attempt = result.body.payment.attempt;
  result = await mobile(h, `${path}/attempts/${attempt.id}/simulate`, { token: customerToken,
    data: { expectedVersion: result.body.payment.version, outcome: 'success' } });
  assert.equal(result.status, 200, JSON.stringify(result.body)); assert.equal(result.body.payment.status, 'paid');
  assert.equal((await mobile(h, path + '/receipt', { token: customerToken })).body.receipt.reference, attempt.reference);
  assert.equal((await mobile(h, '/driver/earnings', { token: driverToken })).body.summary.simulatedPaidKobo, '470001');
  assert.equal((await driver.send('/api/driver/earnings')).body.summary.simulatedPaidKobo, '470001');
  assert.equal((await mobile(h, '/driver/earnings', { token: customerToken })).status, 403);
});
