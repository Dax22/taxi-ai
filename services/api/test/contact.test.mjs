import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createAppServer } from '../../../apps/web/server.mjs';
import { createContactEmailConfig } from '../src/infrastructure/contact-email-config.mjs';
import { createContactMail } from '../src/infrastructure/contact-mail.mjs';
import { createMapProvider } from '../src/infrastructure/map-provider.mjs';

const message = { name: 'Fixture Sender', email: 'sender@example.test', message: 'Isolated contact-form verification; no real email.' };
const env = { TAXI_AI_CONTACT_EMAIL_MODE: 'smtp', TAXI_AI_CONTACT_SMTP_HOST: 'smtp.example.test',
  TAXI_AI_CONTACT_SMTP_PORT: '465', TAXI_AI_CONTACT_SMTP_USER: 'sender@example.test',
  TAXI_AI_CONTACT_SMTP_PASSWORD: 'fixture-only-not-a-real-credential', TAXI_AI_CONTACT_SMTP_FROM: 'sender@example.test' };

async function serverFixture(t, mail) {
  const server = createAppServer({ contactMail: mail,
    mapProvider: createMapProvider({ env: { TAXI_AI_MAPS_MODE: 'off' } }) });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(async () => {
    await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    await server.closeResources();
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  return { get: () => fetch(base + '/api/contact'),
    post: (data = message, origin = base) => fetch(base + '/api/contact', { method: 'POST',
      headers: { Origin: origin, 'Content-Type': 'application/json' }, body: JSON.stringify(data) }) };
}

test('contact is disabled by default and never inherits account-email credentials', () => {
  assert.equal(createContactEmailConfig({}).enabled, false);
  const accountEnv = Object.fromEntries(Object.entries(env).map(([k, v]) => [k.replace('_CONTACT', ''), v]));
  assert.equal(createContactEmailConfig(accountEnv).enabled, false);
});

test('contact enables only with a complete dedicated SMTP configuration', () => {
  const config = createContactEmailConfig(env);
  assert.equal(config.enabled, true);
  assert.equal(config.port, 465);
  assert.equal(config.from, 'sender@example.test');
  assert.throws(() => createContactEmailConfig({ ...env, TAXI_AI_CONTACT_SMTP_PASSWORD: '' }), /HOST, PORT, USER, PASSWORD and FROM/);
  assert.throws(() => createContactEmailConfig({ ...env, TAXI_AI_CONTACT_SMTP_PORT: '25' }), /465/);
  assert.throws(() => createContactEmailConfig({ ...env, TAXI_AI_CONTACT_EMAIL_MODE: 'off' }), /TAXI_AI_CONTACT_EMAIL_MODE/);
});

test('SMTP transport enforces TLS, a fixed recipient and a separate Reply-To', async () => {
  let options, sent;
  const mail = createContactMail({ config: createContactEmailConfig(env), transportFactory: config => {
    options = config;
    return { async sendMail(value) { sent = value; return { accepted: ['info@taxiai.app'], rejected: [] }; }, close() {} };
  } });
  await mail.send(message);
  assert.equal(options.secure, true);
  assert.equal(options.requireTLS, true);
  assert.equal(options.tls.rejectUnauthorized, true);
  assert.equal(options.disableFileAccess, true);
  assert.equal(options.disableUrlAccess, true);
  assert.deepEqual(sent.envelope.to, ['info@taxiai.app']);
  assert.equal(sent.replyTo.address, message.email);
  assert.equal(sent.from.address, 'sender@example.test');
  assert.match(sent.text, /Isolated contact-form/);
  mail.close();
});

test('SMTP provider rejection is not reported as sent and does not expose credentials', async () => {
  for (const provider of [async () => ({ accepted: [], rejected: ['info@taxiai.app'] }),
    async () => { throw new Error('private-provider-diagnostic'); }]) {
    const mail = createContactMail({ config: createContactEmailConfig(env),
      transportFactory: () => ({ sendMail: provider, close() {} }) });
    await assert.rejects(mail.send(message), error => {
      assert.equal(error.message, 'Contact email could not be delivered.');
      return true;
    });
    mail.close();
  }
});

test('disabled transport cannot send or construct an SMTP connection', async () => {
  const mail = createContactMail({ config: { enabled: false }, transportFactory: () => assert.fail('must not connect') });
  assert.equal(mail.enabled, false);
  await assert.rejects(mail.send(message), /unavailable/);
});

test('real loopback HTTP accepts a valid public contact message through the mail adapter', async t => {
  const sent = [];
  const client = await serverFixture(t, { enabled: true, async send(value) { sent.push(value); }, close() {} });
  assert.deepEqual(await (await client.get()).json(), { available: true });
  const response = await client.post();
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { sent: true });
  assert.deepEqual(sent, [message]);
});

test('real loopback HTTP reports disabled contact honestly rather than false success', async t => {
  const client = await serverFixture(t, { enabled: false, async send() { assert.fail('must not send'); }, close() {} });
  assert.deepEqual(await (await client.get()).json(), { available: false });
  const response = await client.post();
  assert.equal(response.status, 503);
  assert.equal((await response.json()).error.code, 'EMAIL_DISABLED');
});

test('contact rejects recipient injection, honeypots, invalid messages and cross-origin writes', async t => {
  let sends = 0;
  const client = await serverFixture(t, { enabled: true, async send() { sends++; }, close() {} });
  for (const invalid of [{ ...message, to: 'outsider@example.test' }, { ...message, website: 'bot' },
    { ...message, message: 'short' }, { ...message, email: 'invalid' }]) {
    const response = await client.post(invalid);
    assert.equal((await response.json()).error.code, 'INVALID_CONTACT');
  }
  const crossOrigin = await client.post(message, 'https://untrusted.example.test');
  assert.equal((await crossOrigin.json()).error.code, 'INVALID_ORIGIN');
  assert.equal(sends, 0);
});

test('provider failure returns a generic delivery failure without private diagnostics', async t => {
  const client = await serverFixture(t, { enabled: true,
    async send() { throw new Error('private-provider-diagnostic'); }, close() {} });
  const response = await client.post();
  assert.equal(response.status, 503);
  const body = await response.json();
  assert.equal(body.error.code, 'EMAIL_DISABLED');
  assert.ok(!JSON.stringify(body).includes('private-provider-diagnostic'));
});

test('public contact enforces the per-email limit before a fourth message is sent', async t => {
  let sends = 0;
  const client = await serverFixture(t, { enabled: true, async send() { sends++; }, close() {} });
  for (let i = 0; i < 3; i++) assert.equal((await client.post()).status, 200);
  const limited = await client.post();
  assert.equal(limited.status, 429);
  assert.equal((await limited.json()).error.code, 'RATE_LIMITED');
  assert.equal(sends, 3);
});
