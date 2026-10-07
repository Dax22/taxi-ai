import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { openDatabase, SCHEMA_VERSION } from '../src/infrastructure/database.mjs';
import { createApplication } from '../src/application.mjs';
import { PASSWORD, TEST_NOW } from './helpers.mjs';

function mailFixture() {
  const messages = [];
  return { enabled: true, messages, async send(message) { messages.push(structuredClone(message)); }, close() {} };
}
function appFixture(t) {
  const db = openDatabase(':memory:'), mail = mailFixture();
  const app = createApplication({ db, clock: () => TEST_NOW, accountMail: mail });
  t.after(async () => { await app.accountEmail.stop(); await app.realtime.close(); db.close(); });
  return { db, mail, app };
}

test('password signup verifies the mailbox before sending one contextual welcome email', async t => {
  const { db, mail, app } = appFixture(t);
  const user = await app.accounts.register({ name: 'Ada Rider', email: 'ada@example.test', password: PASSWORD, intent: 'driver' });
  assert.equal(user.emailVerified, false);
  assert.deepEqual(db.prepare('SELECT purpose FROM account_email_jobs ORDER BY purpose').all().map(r => r.purpose), ['verify']);

  await app.accountEmail.deliverPending();
  const verify = mail.messages.find(message => message.purpose === 'verify');
  assert.equal(typeof verify.token, 'string');
  await app.accountEmail.verify({ token: verify.token });
  assert.equal((await app.accounts.profile(user.id)).emailVerified, true);
  assert.deepEqual(db.prepare('SELECT purpose FROM account_email_jobs ORDER BY purpose').all().map(r => r.purpose), ['welcome']);

  await app.accountEmail.deliverPending();
  const welcome = mail.messages.find(message => message.purpose === 'welcome');
  assert.equal(welcome.email, user.email);
  assert.equal(welcome.name, 'Ada Rider');
  assert.equal(welcome.intent, 'driver');
  assert.equal(welcome.token, null);
  assert.equal(mail.messages.filter(message => message.purpose === 'welcome').length, 1);
});

test('Google-created account is mailbox-verified and queues welcome without a verification email', async t => {
  const { db, mail, app } = appFixture(t);
  const user = await app.accounts.resolveGoogle({
    subject: 'google-welcome-1', email: 'google-welcome@example.test', name: 'Google Rider',
  }, null, 'eats_seller');
  assert.equal(user.emailVerified, true);
  assert.equal((await app.accounts.profile(user.id)).emailVerified, true);
  assert.deepEqual(db.prepare('SELECT purpose FROM account_email_jobs').all().map(r => r.purpose), ['welcome']);
  assert.equal(db.prepare('SELECT count(*) AS n FROM account_email_tokens').get().n, 0);

  await app.accountEmail.deliverPending();
  assert.equal(mail.messages.length, 1);
  assert.equal(mail.messages[0].purpose, 'welcome');
  assert.equal(mail.messages[0].intent, 'eats_seller');
  assert.equal(mail.messages[0].token, null);
});

test('schema 51 to 52 preserves pending account email jobs and only expands allowed purpose', t => {
  const dir = mkdtempSync(join(tmpdir(), 'taxi-welcome-migration-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const filename = join(dir, 'previous.sqlite');
  let db = openDatabase(filename);
  db.exec(`INSERT INTO users(id,email,name,password_hash,role,created_at)
    VALUES('welcome-user','welcome-user@example.test','Welcome User','fixture-hash','customer',1);
    PRAGMA foreign_keys=OFF;
    DROP INDEX account_email_job_schedule;
    ALTER TABLE account_email_jobs RENAME TO account_email_jobs_current;
    CREATE TABLE account_email_jobs (
      id TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id),
      purpose TEXT NOT NULL CHECK (purpose IN ('verify','reset','changed')),
      email TEXT NOT NULL,created_at INTEGER NOT NULL,next_attempt_at INTEGER NOT NULL,
      attempts INTEGER NOT NULL DEFAULT 0,lease_id TEXT,lease_until INTEGER NOT NULL DEFAULT 0,
      UNIQUE(user_id,purpose)) STRICT;
    INSERT INTO account_email_jobs(id,user_id,purpose,email,created_at,next_attempt_at,attempts,lease_id,lease_until)
      VALUES('pending-job','welcome-user','verify','welcome-user@example.test',1,1,0,NULL,0);
    DROP TABLE account_email_jobs_current;
    CREATE INDEX account_email_job_schedule ON account_email_jobs(next_attempt_at,lease_until);
    PRAGMA user_version=51;
    PRAGMA foreign_keys=ON;`);
  db.close();

  db = openDatabase(filename);
  try {
    assert.equal(db.prepare('PRAGMA user_version').get().user_version, SCHEMA_VERSION);
    assert.equal(db.prepare('SELECT purpose FROM account_email_jobs WHERE id=?').get('pending-job').purpose, 'verify');
    db.prepare(`INSERT INTO account_email_jobs(id,user_id,purpose,email,created_at,next_attempt_at)
      VALUES('welcome-job','welcome-user','welcome','welcome-user@example.test',2,2)`).run();
    assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), []);
  } finally { db.close(); }
});
