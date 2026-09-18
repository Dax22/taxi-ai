import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { harness, participants, requestRide, claimRide } from './helpers.mjs';
import { createApplication } from '../src/application.mjs';

const pathFor = (ride) => `/api/rides/${ride.id}/chat`;

test('chat is available only to the assigned participants and inherits session/CSRF protection', async (t) => {
  const h = await harness(t);
  const { customer, driver, drivers, admin } = await participants(h, 2);
  const outsider = h.client(); await outsider.register('outsider');
  const requested = await requestRide(customer);
  const path = pathFor(requested);
  assert.equal((await customer.send(path)).body.error.code, 'CHAT_NOT_READY');
  assert.equal((await driver.send(path)).status, 404);
  await claimRide(driver, requested);
  for (const client of [outsider, drivers[1], admin]) {
    assert.equal((await client.send(path)).status, 404);
    assert.equal((await client.post(`${path}/messages`, { body: 'Not a participant' })).status, 404);
    assert.equal((await client.post(`${path}/read`, { throughSequence: 0 })).status, 404);
  }
  assert.equal((await h.client().send(path)).status, 401);
  assert.equal((await customer.send(`${path}/messages`, { method: 'POST', data: { body: 'Hello' },
    headers: { 'X-CSRF-Token': null, 'Idempotency-Key': randomUUID() } })).status, 403);
  const sent = await customer.post(`${path}/messages`, { body: 'I am by the entrance.' });
  assert.equal(sent.status, 201);
  const thread = await driver.send(path);
  assert.equal(thread.body.messages[0].senderId, customer.user.id);
  assert.equal(thread.body.messages[0].body, 'I am by the entrance.');
  for (const secret of ['@example.test', 'password', 'token_hash', 'csrfToken', 'phone']) {
    assert.ok(!JSON.stringify(thread.body).includes(secret), secret);
  }
  assert.deepEqual((await outsider.send('/api/chat')).body.conversations, []);
});

test('messages validate input and never turn chat text into a fare offer or acceptance', async (t) => {
  const h = await harness(t);
  const { customer, driver } = await participants(h);
  const ride = await claimRide(driver, await requestRide(customer));
  const path = pathFor(ride);
  for (const data of [{ body: '' }, { body: '  \n ' }, { body: 'a'.repeat(2001) }, { body: 5000 },
    { body: 'Hi\u0000there' }, { body: 'Hello', senderId: driver.user.id }, { body: 'Hello', createdAt: 0 }]) {
    assert.equal((await customer.post(`${path}/messages`, data)).status, 400);
  }
  assert.equal((await customer.send(`${path}/messages`, { method: 'POST', data: { body: 'Hi' } })).status, 400);
  const text = '<img src=x onerror=alert(1)>\nI agree to ₦4,700';
  assert.equal((await customer.post(`${path}/messages`, { body: text })).status, 201);
  assert.equal((await driver.send(path)).body.messages[0].body, text);
  const unchanged = (await driver.send(`/api/rides/${ride.id}`)).body.ride;
  assert.equal(unchanged.version, ride.version);
  assert.equal(unchanged.negotiation.currentOffer, null);
  assert.equal(unchanged.negotiation.agreement, null);
  const offered = (await driver.post(`/api/rides/${ride.id}/offers`, { expectedVersion: ride.version, amountKobo: 470000 })).body.ride;
  const agreed = await customer.post(`/api/rides/${ride.id}/accept`, {
    expectedVersion: offered.version, offerId: offered.negotiation.currentOffer.id });
  assert.equal(agreed.body.ride.negotiation.agreement.amountKobo, 470000);
  assert.equal((await driver.post(`${path}/messages`, { body: 'See you at the pickup.' })).status, 201);
});

test('message retries are idempotent and a last-step storage failure rolls back the message and audit', async (t) => {
  const h = await harness(t);
  const { customer, driver } = await participants(h);
  const ride = await claimRide(driver, await requestRide(customer));
  const path = pathFor(ride), key = randomUUID(), data = { body: 'Please wait at the gate.' };
  const attempts = await Promise.all([customer.post(`${path}/messages`, data, key), customer.post(`${path}/messages`, data, key)]);
  assert.deepEqual(attempts.map((result) => result.status).sort(), [200, 201]);
  assert.equal(attempts[0].body.message.id, attempts[1].body.message.id);
  assert.equal((await customer.post(`${path}/messages`, { body: 'A different message' }, key)).body.error.code, 'KEY_REUSED');
  const before = h.db.prepare('SELECT count(*) AS count FROM audit_events').get().count;
  h.db.exec(`CREATE TRIGGER fail_chat_key BEFORE INSERT ON chat_commands BEGIN SELECT RAISE(ABORT, 'test failure'); END`);
  const nextKey = randomUUID();
  assert.equal((await driver.post(`${path}/messages`, { body: 'I am coming.' }, nextKey)).status, 500);
  assert.equal(h.db.prepare('SELECT count(*) AS count FROM chat_messages').get().count, 1);
  assert.equal(h.db.prepare('SELECT count(*) AS count FROM audit_events').get().count, before);
  h.db.exec('DROP TRIGGER fail_chat_key');
  const recovered = await driver.post(`${path}/messages`, { body: 'I am coming.' }, nextKey);
  assert.equal(recovered.status, 201);
  assert.equal(recovered.body.message.sequence, 2);
});

test('unread markers are per participant, monotonic and bounded; messages paginate without gaps', async (t) => {
  const h = await harness(t);
  const { customer, driver } = await participants(h);
  const ride = await claimRide(driver, await requestRide(customer));
  const path = pathFor(ride);
  const app = createApplication({ db: h.db, clock: () => 1_000_000 });
  // Exercise the real service with enough records to cross an HTTP page boundary.
  for (let n = 1; n <= 105; n++) app.chat.send({ userId: customer.user.id, rideId: ride.id,
    key: randomUUID(), data: { body: `Message ${n}` } });
  const first = (await driver.send(path)).body;
  assert.equal(first.messages.length, 100); assert.equal(first.hasMore, true);
  assert.equal(first.nextAfter, 100); assert.equal(first.unread, 105);
  const second = (await driver.send(`${path}?after=${first.nextAfter}`)).body;
  assert.deepEqual(second.messages.map((message) => message.sequence), [101, 102, 103, 104, 105]);
  assert.equal(second.hasMore, false);
  for (const cursor of ['-1', '1.5', 'wrong', '106', '9007199254740992', '1&after=2']) {
    assert.equal((await driver.send(`${path}?after=${cursor}`)).status, 400, cursor);
  }
  assert.equal((await driver.post(`${path}/read`, { throughSequence: 106 })).status, 400);
  assert.equal((await driver.post(`${path}/read`, { throughSequence: '100' })).status, 400);
  assert.equal((await driver.post(`${path}/read`, { throughSequence: 100 })).body.unread, 5);
  assert.equal((await driver.post(`${path}/read`, { throughSequence: 4 })).body.readThrough, 100);
  assert.equal((await driver.send('/api/chat')).body.conversations[0].unread, 5);
  assert.equal((await customer.send('/api/chat')).body.conversations[0].unread, 0);
  await driver.post(`${path}/read`, { throughSequence: 105 });
  assert.equal((await driver.send(path)).body.unread, 0);
});

test('cancelled conversations are read-only and retained messages/keys/read markers survive restart', async (t) => {
  const h = await harness(t, { persistent: true });
  const { customer, driver } = await participants(h);
  const ride = await claimRide(driver, await requestRide(customer));
  const path = pathFor(ride), key = randomUUID(), data = { body: 'Can you meet near the lobby?' };
  const saved = (await customer.post(`${path}/messages`, data, key)).body.message;
  await driver.post(`${path}/read`, { throughSequence: 1 });
  await customer.post(`/api/rides/${ride.id}/cancel`, { expectedVersion: ride.version });
  await h.restart();
  const thread = (await driver.send(path)).body;
  assert.deepEqual(thread.messages, [saved]); assert.equal(thread.unread, 0); assert.equal(thread.canSend, false);
  assert.equal((await customer.post(`${path}/messages`, data, key)).body.replayed, true);
  assert.equal((await customer.post(`${path}/messages`, { body: 'New text after cancellation' })).body.error.code, 'CHAT_CLOSED');
  const next = await claimRide(driver, await requestRide(customer));
  assert.equal((await customer.post(`${pathFor(next)}/messages`, data, key)).body.error.code, 'KEY_REUSED');
  assert.deepEqual((await driver.send(pathFor(next))).body.messages, []);
});

test('reports expose only the reported message to administrators and duplicate review is safe', async (t) => {
  const h = await harness(t, { persistent: true });
  const { customer, driver, admin } = await participants(h);
  const outsider = h.client(); await outsider.register('outsider');
  const ride = await claimRide(driver, await requestRide(customer));
  const path = pathFor(ride);
  const message = (await driver.post(`${path}/messages`, { body: 'A test message to report.' })).body.message;
  await driver.post(`${path}/messages`, { body: 'Unreported content must stay outside the queue.' });
  const reportPath = `${path}/messages/${message.id}/report`;
  assert.equal((await driver.post(reportPath, { reason: 'spam' })).status, 400);
  assert.equal((await outsider.post(reportPath, { reason: 'spam' })).status, 404);
  assert.equal((await customer.post(reportPath, { reason: 'unrecognized' })).status, 400);
  assert.equal((await customer.post(`${path}/messages/${randomUUID()}/report`, { reason: 'spam' })).status, 404);
  const report = await customer.post(reportPath, { reason: 'unsafe_request' });
  assert.equal(report.status, 201);
  assert.equal((await customer.post(reportPath, { reason: 'spam' })).body.report.id, report.body.report.id);
  assert.deepEqual((await customer.send(path)).body.reportedMessageIds, [message.id]);
  assert.deepEqual((await driver.send(path)).body.reportedMessageIds, []);
  assert.equal((await customer.send('/api/admin/chat-reports')).status, 403);
  await h.restart();
  const queue = await admin.send('/api/admin/chat-reports');
  assert.equal(queue.body.reports.length, 1);
  assert.equal(queue.body.reports[0].message.body, message.body);
  assert.ok(!JSON.stringify(queue.body).includes('Unreported content'));
  assert.equal((await admin.send(path)).status, 404);
  const reviewPath = `/api/admin/chat-reports/${report.body.report.id}/review`;
  assert.equal((await customer.post(reviewPath, {})).status, 403);
  assert.equal((await admin.post(reviewPath, {})).body.report.status, 'reviewed');
  assert.equal((await admin.post(reviewPath, {})).body.report.status, 'reviewed');
  assert.equal(h.db.prepare("SELECT count(*) AS count FROM audit_events WHERE kind = 'chat.report_reviewed'").get().count, 1);
});

test('the prototype message cap bounds storage and marks a full conversation read-only', async (t) => {
  const h = await harness(t);
  const { customer, driver } = await participants(h);
  const ride = await claimRide(driver, await requestRide(customer));
  const app = createApplication({ db: h.db, clock: () => 1_000_000 });
  for (let n = 1; n <= 500; n++) app.chat.send({ userId: customer.user.id, rideId: ride.id,
    key: randomUUID(), data: { body: `Message ${n}` } });
  assert.equal((await customer.post(`${pathFor(ride)}/messages`, { body: 'Over the limit' })).body.error.code, 'MESSAGE_LIMIT');
  assert.equal((await driver.send(pathFor(ride))).body.canSend, false);
});
