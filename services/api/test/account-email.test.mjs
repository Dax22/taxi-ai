import { removeEatsFixtureTables } from './migration-fixtures.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { openDatabase, SCHEMA_VERSION } from '../src/infrastructure/database.mjs';
import { createApplication } from '../src/application.mjs';
import { createAccountsService } from '../src/modules/accounts/service.mjs';
import { createAccountsRepository } from '../src/modules/accounts/repository.mjs';
import { tokens } from '../src/infrastructure/tokens.mjs';
import { PASSWORD, TEST_NOW, harness } from './helpers.mjs';

const NEW_PASSWORD = 'A new long fixture password 456';
function mailFixture() {
  const messages = [], state = { fail: false, wait: null };
  return { messages, state, enabled: true, async send(message) { messages.push(message); await state.wait?.(); if (state.fail) throw new Error('private provider detail'); }, close() {} };
}
function fixture(t) {
  const db = openDatabase(':memory:'), mail = mailFixture(); let now = TEST_NOW;
  const app = createApplication({ db, clock: () => now, accountMail: mail, allowSimulation: true });
  t.after(async () => { (await app.accountEmail.stop()); db.close(); });
  return { db, app, mail, advance(ms) { now += ms; },
    register: async (email = 'fixture@example.test') => (await app.accounts.register({ name: 'Email Fixture', email, password: PASSWORD })),
    last: (purpose) => mail.messages.filter((m) => m.purpose === purpose).at(-1),
    count: (table) => db.prepare(`SELECT count(*) AS n FROM ${table}`).get().n };
}
const invalidLink = { code: 'INVALID_EMAIL_LINK' };

test('registration queues verification without exposing a token; explicit confirmation is single-use and survives password login', async (t) => {
  const f = fixture(t), user = await f.register();
  assert.equal(user.emailVerified,false); assert.equal(f.mail.messages.length,0); assert.equal(f.count('account_email_jobs'),1);
  await f.app.accountEmail.deliverPending(); const link = f.last('verify').token;
  assert.equal(link.length,64);
  assert.equal(f.db.prepare('SELECT token_hash FROM account_email_tokens').get().token_hash,tokens.digest(link));
  for (const table of ['account_email_jobs','account_email_tokens','audit_events']) assert.ok(!JSON.stringify(f.db.prepare(`SELECT * FROM ${table}`).all()).includes(link));
  assert.equal((await f.app.accounts.profile(user.id)).emailVerified,false);
  assert.deepEqual((await f.app.accountEmail.verify({ token: link })),{ verified:true });
  (await assert.rejects(async () => (await f.app.accountEmail.verify({ token: link })),invalidLink));
  assert.equal((await f.app.accounts.login({ email:user.email,password:PASSWORD })).emailVerified,true);
  assert.equal((await f.app.accountEmail.status(user.id)).verified,true);
});

test('reset atomically revokes all web and native credentials, consumes both link purposes and preserves trips and driver identity', async (t) => {
  const f = fixture(t), user = await f.register();
  const driver = (await f.app.accounts.addDriverProfile(user.id,{ vehicle:{ model:'Toyota Corolla',plate:'ABJ-123' } },'email-test-driver-key')).user;
  const web = (await f.app.accounts.issueSession(user.id)), second = (await f.app.accounts.issueSession(user.id));
  const ride = (await f.app.rides.mutate({ userId:user.id, key:'reset-ride-fixture-key', action:'create', id:null, data:{pickupId:'wuse-ii',destinationId:'maitama'} })).ride;
  const device = await f.app.devices.login({ email:user.email,password:PASSWORD,deviceName:'Fixture phone' });
  (await f.app.accountEmail.requestReset({ email:user.email }));
  await f.app.accountEmail.deliverPending(); const verify = f.last('verify').token, reset = f.last('reset').token;
  assert.ok((await f.app.accounts.sessionFor(web.token)));
  const before = f.db.prepare('SELECT * FROM drivers').all();
  assert.deepEqual(await f.app.accountEmail.reset({ token:reset,password:NEW_PASSWORD }),{ reset:true });
  assert.equal((await f.app.accounts.sessionFor(web.token)),null); assert.equal((await f.app.accounts.sessionFor(second.token)),null);
  assert.equal((await f.app.devices.sessionFor(device.credentials.accessToken)),null);
  (await assert.rejects(async () => (await f.app.devices.refresh({ refreshToken:device.credentials.refreshToken })),{ code:'UNAUTHENTICATED' }));
  (await assert.rejects(async () => (await f.app.accountEmail.verify({ token:verify })),invalidLink));
  await assert.rejects((f.app.accountEmail.reset({ token:reset,password:PASSWORD })),invalidLink);
  await assert.rejects((f.app.accounts.login({ email:user.email,password:PASSWORD })),{ code:'INVALID_CREDENTIALS' });
  const logged = await f.app.accounts.login({ email:user.email,password:NEW_PASSWORD });
  assert.equal(logged.id,user.id); assert.equal(logged.emailVerified,true); assert.deepEqual(logged.driver,driver.driver);
  assert.deepEqual(f.db.prepare('SELECT * FROM drivers').all(),before); assert.equal(f.count('sessions'),0);
  assert.deepEqual((await f.app.rides.get(logged,ride.id)),ride);
  await f.app.accountEmail.deliverPending(); assert.equal(f.last('changed').token,null);
});

test('unknown, Google-only, staff and throttled addresses receive the same reset response without gaining password access', async (t) => {
  const f = fixture(t), customer = await f.register(), staff = await f.register('staff@example.test');
  (await f.app.accounts.bootstrapAdmin(staff.email));
  const google = (await f.app.accounts.resolveGoogle({ subject:'fixture-google',email:'google@example.test',name:'Google Fixture' }));
  const expected = { accepted:true };
  for (const email of [customer.email,'missing@example.test',google.email,staff.email,customer.email]) {
    assert.deepEqual((await f.app.accountEmail.requestReset({ email })),expected);
  }
  assert.equal(f.db.prepare("SELECT count(*) AS n FROM account_email_jobs WHERE purpose='reset'").get().n,1);
  await f.app.accountEmail.deliverPending(); await f.app.accountEmail.deliverPending();
  assert.deepEqual(f.mail.messages.filter((m) => m.purpose==='reset').map((m) => m.email),[customer.email]);
  assert.equal((await f.app.accounts.signInMethods(google.id)).password,false);
  assert.equal((await f.app.accounts.emailState(staff.id)),null);
});

test('links are purpose-bound, expire exactly at the deadline and are superseded by a new delivery', async (t) => {
  const f = fixture(t), user = await f.register(); (await f.app.accountEmail.requestReset({ email:user.email }));
  await f.app.accountEmail.deliverPending(); const verify = f.last('verify').token, old = f.last('reset').token;
  (await assert.rejects(async () => (await f.app.accountEmail.verify({ token:old })),invalidLink));
  await assert.rejects((f.app.accountEmail.reset({ token:verify,password:NEW_PASSWORD })),invalidLink);
  f.advance(60_000); (await f.app.accountEmail.requestReset({ email:user.email })); await f.app.accountEmail.deliverPending();
  await assert.rejects((f.app.accountEmail.reset({ token:old,password:NEW_PASSWORD })),invalidLink);
  const fresh = f.last('reset').token;
  const pending = (f.app.accountEmail.reset({ token:fresh,password:NEW_PASSWORD }));
  f.advance(30*60_000); await assert.rejects(pending,invalidLink);
  await assert.rejects((f.app.accountEmail.reset({ token:fresh,password:NEW_PASSWORD })),invalidLink);
  f.advance((24*60-31)*60_000); (await assert.rejects(async () => (await f.app.accountEmail.verify({ token:verify })),invalidLink));
  for (const token of [null,123,'bad','a'.repeat(64)]) (await assert.rejects(async () => (await f.app.accountEmail.verify({ token })),invalidLink));
  assert.equal((await f.app.accounts.profile(user.id)).emailVerified,false);
});

test('simultaneous reset submissions have exactly one winner and no partial credential change', async (t) => {
  const f = fixture(t), user = await f.register(); (await f.app.accountEmail.requestReset({ email:user.email })); await f.app.accountEmail.deliverPending();
  const token = f.last('reset').token;
  const results = await Promise.allSettled([(f.app.accountEmail.reset({ token,password:NEW_PASSWORD })),(f.app.accountEmail.reset({ token,password:NEW_PASSWORD }))]);
  assert.equal(results.filter((r) => r.status==='fulfilled').length,1);
  assert.equal(results.find((r) => r.status==='rejected').reason.code,'INVALID_EMAIL_LINK');
  assert.equal((await f.app.accounts.login({ email:user.email,password:NEW_PASSWORD })).id,user.id);
});

test('a pending password check cannot authenticate with credentials changed while hashing', async (t) => {
  const f = fixture(t), user = await f.register(); let finish, entered;
  const verifying = new Promise((resolve) => { entered = resolve; });
  const accounts = createAccountsService({ repository:createAccountsRepository(f.db), passwords:{ verify:() => new Promise((resolve) => { finish=resolve; entered(); }) },
    driverProfiles:{ find:() => null }, clock:() => TEST_NOW });
  const result = accounts.login({ email:user.email,password:PASSWORD });
  await verifying;
  f.db.prepare('UPDATE users SET password_hash=? WHERE id=?').run('changed-while-checking',user.id); finish(true);
  await assert.rejects(result,{ code:'INVALID_CREDENTIALS' });
});

test('password proof is rechecked at web and native session issuance after a reset', async (t) => {
  const f=fixture(t), user=await f.register();
  const oldWeb=await f.app.accounts.login({email:user.email,password:PASSWORD});
  const oldNative=await f.app.accounts.login({email:user.email,password:PASSWORD});
  assert.ok(!JSON.stringify(oldWeb).includes('scrypt'));
  (await f.app.accountEmail.requestReset({email:user.email})); await f.app.accountEmail.deliverPending();
  await f.app.accountEmail.reset({token:f.last('reset').token,password:NEW_PASSWORD});
  (await assert.rejects(async ()=>(await f.app.accounts.issueSession(user.id,null,oldWeb)),{code:'INVALID_CREDENTIALS'}));
  (await assert.rejects(async ()=>(await f.app.devices.issue(user.id,'Late phone',oldNative)),{code:'INVALID_CREDENTIALS'}));
  assert.equal(f.count('sessions'),0); assert.equal(f.count('device_sessions'),0);
});

test('mail failures retry with new links, bound attempts, never expose provider errors and do not change passwords', async (t) => {
  const f = fixture(t), user = await f.register(); f.mail.state.fail=true;
  await f.app.accountEmail.deliverPending(); const failedToken = f.last('verify').token;
  assert.equal(f.count('account_email_tokens'),0); assert.equal(f.count('account_email_jobs'),1);
  await f.app.accountEmail.deliverPending(); assert.equal(f.mail.messages.length,1);
  f.advance(60_000); await f.app.accountEmail.deliverPending(); assert.notEqual(f.last('verify').token,failedToken);
  f.advance(120_000); await f.app.accountEmail.deliverPending();
  assert.equal(f.mail.messages.length,3); assert.equal(f.count('account_email_jobs'),0);
  assert.ok(!JSON.stringify(f.db.prepare('SELECT * FROM audit_events').all()).includes('private provider'));
  assert.equal((await f.app.accounts.login({ email:user.email,password:PASSWORD })).id,user.id);
});

test('role promotion and contact changes invalidate outstanding links', async (t) => {
  const f = fixture(t), staff = await f.register(); (await f.app.accountEmail.requestReset({ email:staff.email })); await f.app.accountEmail.deliverPending();
  const reset=f.last('reset').token, verify=f.last('verify').token;
  (await f.app.accounts.bootstrapAdmin(staff.email));
  await assert.rejects((f.app.accountEmail.reset({ token:reset,password:NEW_PASSWORD })),invalidLink);
  (await assert.rejects(async () => (await f.app.accountEmail.verify({ token:verify })),invalidLink));
  const changed=await f.register('changed@example.test'); await f.app.accountEmail.deliverPending(); const link=f.last('verify').token;
  f.db.prepare('UPDATE users SET email=? WHERE id=?').run('new@example.test',changed.id);
  (await assert.rejects(async () => (await f.app.accountEmail.verify({ token:link })),invalidLink));
});

test('failed password mutation rolls back link consumption, verification and session revocation together', async (t) => {
  const f=fixture(t), user=await f.register(), session=(await f.app.accounts.issueSession(user.id));
  (await f.app.accountEmail.requestReset({ email:user.email })); await f.app.accountEmail.deliverPending(); const token=f.last('reset').token;
  f.db.exec("CREATE TRIGGER reject_reset BEFORE UPDATE OF password_hash ON users BEGIN SELECT RAISE(ABORT,'fixture failure'); END;");
  await assert.rejects((f.app.accountEmail.reset({ token,password:NEW_PASSWORD })));
  assert.ok((await f.app.accounts.sessionFor(session.token))); assert.equal((await f.app.accounts.profile(user.id)).emailVerified,false);
  f.db.exec('DROP TRIGGER reject_reset');
  assert.deepEqual(await f.app.accountEmail.reset({ token,password:NEW_PASSWORD }),{ reset:true });
});

test('delivery intentions survive restarts; schema 14 upgrades preserve accounts without inventing verification', async (t) => {
  const mail=mailFixture(), h=await harness(t,{ persistent:true,accountMail:mail }), web=h.client(); await web.register('restart');
  const before=h.db.prepare('SELECT * FROM users').all();
  await h.restart();
  assert.ok(h.db.prepare('SELECT count(*) AS n FROM account_email_jobs').get().n + mail.messages.length >= 1, 'the intention is retained or accepted by the restarted worker');
  // A shutdown can leave an SMTP intention leased. Recovery is at least once,
  // and the replacement worker must respect the lease before trying again.
  await new Promise(setImmediate); h.advance(60_000);
  const app=createApplication({ db:h.db,clock:()=>h.now,accountMail:mail }); await app.accountEmail.deliverPending();
  await new Promise(setImmediate);
  assert.ok(mail.messages.length >= 1); assert.deepEqual((await app.accountEmail.verify({ token:mail.messages.at(-1).token })),{ verified:true });
  removeEatsFixtureTables(h.db); h.db.exec('DROP TABLE vehicle_photo_checks; DROP TABLE push_jobs; DROP TABLE push_registrations; DROP TABLE account_notifications; ALTER TABLE driver_availability DROP COLUMN native_session_id; DROP TABLE delivery_orders; ALTER TABLE rides DROP COLUMN vehicle_category; DROP TABLE account_email_tokens; DROP TABLE account_email_jobs; DROP TABLE account_email_verifications; PRAGMA user_version=14;');
  await h.restart(); assert.deepEqual(h.db.prepare('SELECT * FROM users').all(),before);
  assert.equal(h.db.prepare('PRAGMA user_version').get().user_version,SCHEMA_VERSION);
  assert.equal((await web.send('/api/session')).body.user.emailVerified,false);
});

const native = async (h,path,data,headers={}) => {
  const r=await fetch(h.base+'/api/mobile/v1'+path,{ method:data===undefined?'GET':'POST', headers:{ ...(data===undefined?{}:{'Content-Type':'application/json'}),...headers }, ...(data===undefined?{}:{body:JSON.stringify(data)}) });
  return { status:r.status,body:await r.json() };
};
test('web and native use the same actions, enforce transport boundaries and never return reset tokens', async (t) => {
  const mail=mailFixture(), h=await harness(t,{ accountMail:mail }), web=h.client(); await web.register('http');
  assert.equal((await web.send('/api/account/email')).body.verified,false);
  assert.equal((await web.send('/api/account/email/request',{method:'POST',data:{},headers:{'X-CSRF-Token':''}})).status,403);
  assert.equal((await web.send('/api/auth/password/request',{method:'POST',data:{email:web.user.email},headers:{Origin:'https://evil.example'}})).status,403);
  assert.equal((await web.post('/api/auth/password/request',{email:web.user.email,userId:web.user.id})).status,400);
  const login=await native(h,'/auth/login',{email:web.user.email,password:PASSWORD,deviceName:'Email phone'});
  const bearer={Authorization:`Bearer ${login.body.credentials.accessToken}`};
  assert.equal((await native(h,'/account/email',undefined,bearer)).body.verified,false);
  assert.equal((await native(h,'/account/email',undefined,{Cookie:web.cookie})).status,401);
  assert.equal((await native(h,'/auth/password/request',{email:web.user.email},{Origin:h.base})).status,403);
  const request=await native(h,'/auth/password/request',{email:web.user.email}); assert.equal(request.status,200);
  assert.deepEqual(Object.keys(request.body).sort(),['accepted','apiVersion','serverNow']);
  const app=createApplication({db:h.db,clock:()=>h.now,accountMail:mail}); await app.accountEmail.deliverPending();
  const reset=mail.messages.find((m)=>m.purpose==='reset').token;
  const finish=await web.post('/api/auth/password/reset',{token:reset,password:NEW_PASSWORD}); assert.equal(finish.status,200);
  assert.match(finish.headers.get('set-cookie'),/Max-Age=0/);
  assert.equal((await native(h,'/account/email',undefined,bearer)).status,401);
  for(const path of ['/account-recovery','/account-recovery.mjs','/dashboard/account-recovery-controller.mjs']) {
    const r=await fetch(h.base+path); assert.equal(r.status,200); assert.equal(r.headers.get('cache-control'),'no-store'); assert.equal(r.headers.get('referrer-policy'),'no-referrer');
  }
});

test('email defaults off and never silently claims delivery or marks an account verified', async (t) => {
  const h=await harness(t), web=h.client(); await web.register('disabled');
  assert.equal((await web.send('/api/auth/email-settings')).body.enabled,false);
  assert.equal((await web.post('/api/auth/password/request',{email:web.user.email})).body.error.code,'EMAIL_DISABLED');
  assert.equal((await web.post('/api/account/email/request',{})).status,503);
  assert.equal((await native(h,'/auth/password/request',{email:web.user.email})).status,503);
  assert.equal(h.db.prepare('SELECT count(*) AS n FROM account_email_jobs').get().n,0);
  assert.equal(web.user.emailVerified,false);
});

test('independent email workers do not send the same live lease concurrently', async t => {
 const f = fixture(t); await f.register(); let entered, finish;
 const ready = new Promise(resolve => { entered = resolve; });
 const release = new Promise(resolve => { finish = resolve; });
 f.mail.state.wait = () => { entered(); return release; };
 const replacement = createApplication({ db: f.db, clock: () => TEST_NOW, accountMail: f.mail });
 const original = f.app.accountEmail.deliverPending(); await ready;
 await replacement.accountEmail.deliverPending(); assert.equal(f.mail.messages.length, 1);
 finish(); await original; assert.equal(f.count('account_email_jobs'), 0);
});
