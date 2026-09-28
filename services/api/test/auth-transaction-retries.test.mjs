import test from 'node:test';
import assert from 'node:assert/strict';
import { openDatabase } from '../src/infrastructure/database.mjs';
import { asAsyncDatabase } from '../src/infrastructure/async-database.mjs';
import { createAudit } from '../src/infrastructure/audit.mjs';
import { tokens } from '../src/infrastructure/tokens.mjs';
import { createAccountsRepository } from '../src/modules/accounts/repository.mjs';
import { createAccountsService } from '../src/modules/accounts/service.mjs';
import { createDeviceSessionsRepository } from '../src/modules/device-sessions/repository.mjs';
import { createDeviceSessionsService } from '../src/modules/device-sessions/service.mjs';
import { createGoogleAuthRepository } from '../src/modules/google-auth/repository.mjs';
import { createGoogleAuthService } from '../src/modules/google-auth/service.mjs';

const password = 'Fixture password for transaction retry';
async function fixture(t) {
  const db = asAsyncDatabase(openDatabase(':memory:'));
  t.after(() => db.close());
  const now = Date.now(), repository = createAccountsRepository(db), audit = createAudit(db);
  const state = { retryNext: false, retries: 0, beforeRetry: async () => {}, depth: 0 };
  async function unitOfWork(run) {
    const retry = state.retryNext; state.retryNext = false;
    const wrapped = async () => { state.depth++; try { return await run(); } finally { state.depth--; } };
    if (retry) {
      const conflict = Object.assign(new Error('Injected commit conflict'), { code: '40001' });
      await assert.rejects(db.transaction(async () => { await wrapped(); throw conflict; }), { code: '40001' });
      state.retries++;
      await state.beforeRetry();
    }
    return db.transaction(wrapped);
  }
  const accounts = createAccountsService({ repository, driverProfiles: { find: async () => null },
    passwords: { verify: async () => true }, tokens, unitOfWork, audit, clock: () => now });
  const devices = createDeviceSessionsService({ repository: createDeviceSessionsRepository(db),
    authenticate: accounts.login, validatePasswordLogin: accounts.validatePasswordLogin,
    consumePasswordLogin: accounts.consumePasswordLogin, getAccount: accounts.profile,
    tokens, unitOfWork, audit, clock: () => now });
  const userId = tokens.id(), email = 'transaction-fixture@example.test';
  await repository.insert({ id: userId, email, name: 'Retry fixture', passwordHash: 'verified-fixture-hash', role: 'customer', createdAt: now });
  await repository.grant(userId, 'customer', now);
  return { db, repository, accounts, devices, unitOfWork, state, now, userId, email,
    count: async (table) => (await db.prepare(`SELECT count(*) AS n FROM ${table}`).get()).n };
}

for (const channel of ['web', 'native']) {
  test(`${channel} password issuance survives a rolled-back attempt, commits one session and consumes its proof`, async (t) => {
    const f = await fixture(t), proof = await f.accounts.login({ email: f.email, password });
    const issue = () => channel === 'web' ? f.accounts.issueSession(f.userId, null, proof) : f.devices.issue(f.userId, 'Retry phone', proof);
    f.state.retryNext = true;
    const result = await issue();
    assert.equal(f.state.retries, 1);
    assert.equal(await f.count(channel === 'web' ? 'sessions' : 'device_sessions'), 1);
    if (channel === 'web') assert.equal((await f.accounts.sessionFor(result.token)).user.id, f.userId);
    else {
      assert.equal((await f.devices.sessionFor(result.credentials.accessToken)).user.id, f.userId);
      assert.equal(await f.count('device_refresh_tokens'), 1);
    }
    await assert.rejects(issue(), { code: 'INVALID_CREDENTIALS' });
    assert.equal(await f.count(channel === 'web' ? 'sessions' : 'device_sessions'), 1);
  });

  test(`${channel} issuance rechecks a changed password on the retried attempt and leaves no session`, async (t) => {
    const f = await fixture(t), proof = await f.accounts.login({ email: f.email, password });
    f.state.retryNext = true;
    f.state.beforeRetry = () => f.repository.replacePassword(f.userId, 'new-password-fixture-hash');
    await assert.rejects(channel === 'web' ? f.accounts.issueSession(f.userId, null, proof) : f.devices.issue(f.userId, 'Retry phone', proof),
      { code: 'INVALID_CREDENTIALS' });
    assert.equal(f.state.retries, 1);
    assert.equal(await f.count('sessions'), 0);
    assert.equal(await f.count('device_sessions'), 0);
    assert.equal(await f.count('device_refresh_tokens'), 0);
  });
}

test('Google linking rechecks session revocation on transaction retry and exchanges its code only once outside transactions', async (t) => {
  const f = await fixture(t), session = await f.accounts.issueSession(f.userId);
  let exchanged = 0;
  const provider = { config: { enabled: true, nativeClientIds: [], origin: 'https://taxi.example.test' },
    authorization: ({ state }) => `https://accounts.example.test/?state=${state}`,
    exchange: async () => {
      exchanged++;
      assert.equal(f.state.depth, 0);
      f.state.retryNext = true;
      f.state.beforeRetry = () => f.accounts.revokeSession(session.token);
      return { subject: 'transaction-google-fixture', email: f.email, name: 'Google fixture' };
    } };
  const google = createGoogleAuthService({ repository: createGoogleAuthRepository(f.db), provider, accounts: f.accounts,
    devices: f.devices, tokens, unitOfWork: f.unitOfWork, clock: () => f.now });
  const started = await google.startWeb({ data: { password }, token: session.token, origin: provider.config.origin, link: true });
  const state = new URL(started.redirectUrl).searchParams.get('state');
  await assert.rejects(google.finishWeb({ state, binding: started.binding, code: 'fixture-code', origin: provider.config.origin }),
    { code: 'UNAUTHENTICATED' });
  assert.equal(exchanged, 1);
  assert.equal(f.state.retries, 1);
  assert.equal(await f.count('account_identities'), 0);
  assert.equal(await f.accounts.sessionFor(session.token), null);
});
