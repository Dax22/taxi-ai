import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { harness, PASSWORD } from './helpers.mjs';

async function register(h, suffix, intent) {
  const client = h.client();
  const response = await client.post('/api/auth/register', {
    name: `Registration ${suffix}`,
    email: `registration-${suffix}@example.test`,
    password: PASSWORD,
    intent,
  });
  assert.equal(response.status, 201, JSON.stringify(response.body));
  return client;
}

test('registration intent chooses onboarding without creating conflicting account roles', async (t) => {
  const h = await harness(t);
  const customer = await register(h, 'customer', 'customer');
  const driver = await register(h, 'driver', 'driver');
  const seller = await register(h, 'seller', 'eats_seller');

  assert.equal(customer.user.startingExperience, 'customer');
  assert.equal(driver.user.startingExperience, 'driver');
  assert.equal(seller.user.startingExperience, 'eats_seller');

  for (const client of [customer, driver, seller]) {
    assert.deepEqual(client.user.capabilities, ['customer']);
    assert.equal(client.user.driver, null);
    assert.equal(client.user.role, 'customer');
  }

  assert.equal(h.db.prepare('SELECT count(*) AS n FROM users').get().n, 3);
  assert.equal(h.db.prepare('SELECT count(*) AS n FROM drivers').get().n, 0);
  assert.equal(h.db.prepare('SELECT count(*) AS n FROM eats_memberships').get().n, 0);

  const setup = h.db.prepare('SELECT experience FROM account_kemmy_setup WHERE user_id=?').get(driver.user.id);
  assert.equal(setup.experience, 'driver');

  const id = driver.user.id;
  const added = await driver.post('/api/account/driver-profile', { vehicle: { model: 'Toyota Corolla', plate: 'REG-DRIVER' } }, randomUUID());
  assert.equal(added.status, 200, JSON.stringify(added.body));
  assert.equal(added.body.user.id, id);
  assert.deepEqual(added.body.user.capabilities, ['customer','driver']);
  assert.equal(h.db.prepare('SELECT count(*) AS n FROM users').get().n, 3, 'adding Work must not create another account');
});

test('registration rejects unknown or conflicting starting intents', async (t) => {
  const h = await harness(t), client = h.client();
  let response = await client.post('/api/auth/register', {
    name: 'Bad intent', email: 'bad-intent@example.test', password: PASSWORD, intent: 'admin',
  });
  assert.equal(response.status, 400);
  assert.equal(response.body.error.code, 'INVALID_ROLE');

  response = await client.post('/api/auth/register', {
    name: 'Conflict', email: 'conflict@example.test', password: PASSWORD,
    role: 'driver', intent: 'eats_seller', vehicle: { model: 'Toyota Corolla', plate: 'CONFLICT' },
  });
  assert.equal(response.status, 400);
  assert.equal(response.body.error.code, 'INVALID_FIELDS');
  assert.equal(h.db.prepare("SELECT count(*) AS n FROM users WHERE email IN ('bad-intent@example.test','conflict@example.test')").get().n, 0);
});
