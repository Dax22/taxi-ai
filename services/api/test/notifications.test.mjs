import test from 'node:test';
import assert from 'node:assert/strict';
import { harness, participants, requestRide, claimRide } from './helpers.mjs';
import { createApplication } from '../src/application.mjs';
import { createPushProvider } from '../src/infrastructure/push-provider.mjs';
import { createNotificationsRepository } from '../src/modules/notifications/repository.mjs';
import { asAsyncDatabase } from '../src/infrastructure/async-database.mjs';
import { randomUUID } from 'node:crypto';
import { DETAILS, fixtureApi, submitApplication, approveApplication } from './driver-fixtures.mjs';
const projectId='00000000-0000-4000-8000-000000000001',token='ExpoPushToken[fixture_no_real_destination]';
async function fixture(t){
  const h=await harness(t),{customer,driver,admin}=await participants(h);
  const sent=[],receipts=[];
  const provider={enabled:true,projectId,send:async(data)=>{sent.push(data);return{status:'ticket',ticket:'fixture-ticket'};},receipt:async(ticket)=>{receipts.push(ticket);return{status:'ok'};}};
  const app=createApplication({db:h.db,clock:()=>h.now,allowSimulation:true,pushProvider:provider,dispatchConfig:{mode:'legacy'}});
  const credentials=(await app.devices.issue(customer.user.id,'Test device')).credentials;
  (await app.notifications.register(customer.user.id,credentials.sessionId,{token,projectId}));
  const ride=await claimRide(driver,await requestRide(customer));
  return{h,customer,driver,admin,app,credentials,provider,ride,sent,receipts};
}
async function step(who, ride, action, data = {}, key = randomUUID()) {
  const result = await who.post(`/api/rides/${ride.id}/${action}`, { expectedVersion: ride.version, ...data }, key);
  assert.equal(result.status, 200, JSON.stringify(result.body)); return result.body.ride;
}
async function arrival(f) {
  let ride = await step(f.driver, f.ride, 'offers', { amountKobo: 470000 });
  ride = await step(f.customer, ride, 'accept', { offerId: ride.negotiation.currentOffer.id });
  ride = await step(f.customer, ride, 'confirm'); ride = await step(f.driver, ride, 'depart');
  const key = randomUUID(), before = ride;
  ride = await step(f.driver, before, 'arrive', {}, key);
  await step(f.driver, before, 'arrive', {}, key); // A lost-reply retry must not duplicate the alert.
  return ride;
}

test('arrival details and phone alerts belong to the rider and retain the assigned vehicle snapshot after later edits', async (t) => {
  const f = await fixture(t), ride = await arrival(f);
  const notices = async () => (await f.app.notifications.list(f.customer.user.id, null, f.credentials.sessionId)).notifications.filter(n => n.kind === 'arrive');
  assert.equal((await notices()).length, 1); const saved = (await notices())[0]; assert.equal(saved.arrivalActive, true);
  for (const expected of ['driver0', 'Toyota Corolla', 'Yellow', 'Standard', 'TEST-DRIVER']) assert.ok(saved.body.includes(expected), expected);
  for (const privateValue of [DETAILS.phone, DETAILS.licenceNumber, ride.pickup.name, ride.destination.name]) assert.ok(!saved.body.includes(privateValue));
  const outsider = f.h.client(); await outsider.register('unrelated');
  (await assert.rejects(async () => (await f.app.notifications.open(outsider.user.id, saved.id)), { code: 'NOT_FOUND' }));
  assert.equal((await f.app.notifications.list(f.driver.user.id, null, null)).notifications.some(n => n.body), false);
  await f.app.notifications.deliverPending();
  assert.equal(f.sent.filter(n => n.arrivalBody).length, 1); assert.equal(f.sent.find(n => n.arrivalBody).arrivalBody, saved.body);
  const customerView = (await f.customer.send(`/api/rides/${ride.id}`)).body.ride;
  assert.ok(!saved.body.includes(customerView.trip.pickupPin));
  await step(f.customer, customerView, 'cancel', { reason: 'other' });
  const application = (await f.driver.send('/api/driver/application')).body.application;
  await f.driver.post('/api/driver/application/reopen', { expectedVersion: application.version });
  await submitApplication(fixtureApi(f.driver), '2099-12-31', { ...DETAILS, vehicle: { ...DETAILS.vehicle, make: 'Honda', model: 'Civic', colour: 'Blue', plate: 'NEW-TEST' } });
  await approveApplication(fixtureApi(f.admin), f.driver.user.id);
  assert.equal((await f.app.accounts.profile(f.driver.user.id)).driver.vehicle.plate, 'NEW-TEST');
  assert.equal((await notices())[0].body, saved.body); assert.equal((await notices())[0].arrivalActive, false);
});

test('unsent arrival alerts expire and are discarded after pickup or cancellation', async (t) => {
  for (const outcome of ['start', 'cancel', 'expired']) {
    const f = await fixture(t), ride = await arrival(f);
    const id = (await f.app.notifications.list(f.customer.user.id, null, f.credentials.sessionId)).notifications.find(n => n.kind === 'arrive').id;
    if (outcome === 'start') {
      const current = (await f.customer.send(`/api/rides/${ride.id}`)).body.ride;
      await step(f.driver, ride, 'start', { pickupPin: current.trip.pickupPin });
    } else if (outcome === 'cancel') await step(f.customer, ride, 'cancel', { reason: 'other' });
    else f.h.advance(300_000);
    await f.app.notifications.deliverPending();
    assert.equal(f.sent.some(n => n.notificationId === id), false, outcome);
    assert.equal(f.h.db.prepare('SELECT status FROM push_jobs WHERE notification_id=?').get(id).status, 'dead');
  }
});

test('deleting Work closes queued alerts and a late provider reply cannot revive them after reapplication', async (t) => {
  const f = await fixture(t);
  await step(f.customer, f.ride, 'cancel'); await f.driver.online();
  const device = (await f.app.devices.issue(f.driver.user.id, 'Work phone')).credentials, workToken = 'ExpoPushToken[work_fixture_no_real_destination]';
  (await f.app.notifications.register(f.driver.user.id, device.sessionId, { token: workToken, projectId }));
  await requestRide(f.customer);
  let finish, started;
  const ready = new Promise((resolve) => { started = resolve; });
  f.provider.send = async (data) => {
    if (data.token !== workToken) return { status: 'ok' };
    started(); return new Promise((resolve) => { finish = resolve; });
  };
  const sending = f.app.notifications.deliverPending(); await ready;
  const version = (await f.driver.send('/api/driver/application')).body.application.version;
  (await f.app.accounts.deleteDriverProfile(f.driver.user.id, { expectedVersion: version, confirmation: 'DELETE' }, randomUUID()));
  const workJobs = () => f.h.db.prepare("SELECT j.status FROM push_jobs j JOIN account_notifications n ON n.id=j.notification_id WHERE n.mode='work'").all();
  assert.ok(workJobs().length); assert.ok(workJobs().every((j) => j.status === 'dead'));
  (await f.app.accounts.addDriverProfile(f.driver.user.id, { vehicle: DETAILS.vehicle }, randomUUID()));
  finish({ status: 'ticket', ticket: 'late-work-ticket' }); await sending;
  assert.ok(workJobs().every((j) => j.status === 'dead'));
});
test('push jobs persist separately from transactions, await receipts and contain no journey or message contents',async(t)=>{
  const f=await fixture(t);assert.equal(f.sent.length,0);
  const row=f.h.db.prepare('SELECT status FROM push_jobs').get();assert.equal(row.status,'pending');
  await f.app.notifications.deliverPending();assert.equal(f.sent.length,1);assert.deepEqual(Object.keys(f.sent[0]).sort(),['notificationId','token']);
  assert.equal(f.h.db.prepare('SELECT status FROM push_jobs').get().status,'ticket');
  await f.app.notifications.deliverPending();assert.equal(f.sent.length,1);
  f.h.advance(15*60_000);await f.app.notifications.deliverPending();assert.equal(f.receipts.length,1);
  assert.equal(f.h.db.prepare('SELECT status FROM push_jobs').get().status,'done');
});

test('temporary provider failures retry from the outbox, concurrent workers are guarded, and invalid tokens are disabled',async(t)=>{
  const f=await fixture(t);let calls=0,resolve,entered;
  const ready = new Promise(r => { entered = r; });
  f.provider.send=()=>{calls++;return new Promise((r)=>{resolve=r;entered();});};
  const first=f.app.notifications.deliverPending();await ready;await f.app.notifications.deliverPending();assert.equal(calls,1);
  resolve({status:'retry'});await first;assert.equal(f.h.db.prepare('SELECT status FROM push_jobs').get().status,'pending');
  f.h.advance(60_000);f.provider.send=async()=>{calls++;return{status:'unregistered'};};await f.app.notifications.deliverPending();
  assert.equal(calls,2);assert.equal(f.h.db.prepare('SELECT count(*) AS n FROM push_registrations').get().n,0);
  assert.equal(f.h.db.prepare('SELECT status FROM push_jobs').get().status,'dead');
});

test('sign-out, opt-out and reassignment of a phone token prevent old-account jobs from being delivered',async(t)=>{
  for(const action of ['revoke','disable','transfer']){
    const f=await fixture(t);
    if(action==='revoke')(await f.app.devices.revoke(f.customer.user,f.credentials.sessionId));
    if(action==='disable')(await f.app.notifications.unregister(f.customer.user.id,f.credentials.sessionId,{}));
    if(action==='transfer'){
      const other=f.h.client();await other.register('token-recipient');
      const session=(await f.app.devices.issue(other.user.id,'Other account')).credentials;
      (await f.app.notifications.register(other.user.id,session.sessionId,{token,projectId}));
    }
    await f.app.notifications.deliverPending();assert.equal(f.sent.length,0,action);assert.equal(f.h.db.prepare('SELECT status FROM push_jobs').get().status,'dead');
  }
});

test('device revocation during provider I/O is rechecked, and stopped workers do not access a closed database',async(t)=>{
  const f=await fixture(t);let finish,entered;const ready=new Promise(r=>{entered=r;});f.provider.send=()=>new Promise((resolve)=>{finish=resolve;entered();});
  const pending=f.app.notifications.deliverPending();await ready;(await f.app.devices.revoke(f.customer.user,f.credentials.sessionId));finish({status:'ticket',ticket:'late-ticket'});await pending;
  assert.equal(f.h.db.prepare('SELECT status FROM push_jobs').get().status,'dead');
  const g=await fixture(t);let done,enteredAgain;const readyAgain=new Promise(r=>{enteredAgain=r;});g.provider.send=()=>new Promise((resolve)=>{done=resolve;enteredAgain();});
  const stopping=g.app.notifications.deliverPending();await readyAgain;(await g.app.notifications.stop());done({status:'ticket',ticket:'after-close'});await stopping;
  assert.equal(g.h.db.prepare('SELECT status FROM push_jobs').get().status,'pending');
});

test('notification pagination and reads are private and stable when newer events arrive',async(t)=>{
  const f=await fixture(t),repo=createNotificationsRepository(f.h.db);
  await asAsyncDatabase(f.h.db).transaction(async ()=>{for(let i=0;i<55;i++)(await f.app.notifications.publish({userId:f.customer.user.id,rideId:f.ride.id,kind:'message',mode:'customer',eventKey:`fixture-${i}`}));});
  const page=(await f.app.notifications.list(f.customer.user.id,null,f.credentials.sessionId));assert.equal(page.notifications.length,50);assert.ok(page.nextBefore);
  await asAsyncDatabase(f.h.db).transaction(async ()=>(await f.app.notifications.publish({userId:f.customer.user.id,rideId:f.ride.id,kind:'arrive',mode:'customer',eventKey:'new-arrival'})));
  const older=(await f.app.notifications.list(f.customer.user.id,page.nextBefore,f.credentials.sessionId));assert.equal(older.notifications.length,6);
  assert.equal(page.notifications.some((n)=>older.notifications.some((old)=>old.id===n.id)),false);
  (await assert.rejects(async ()=>(await f.app.notifications.list(f.driver.user.id,page.nextBefore)),{code:'NOT_FOUND'}));
  assert.equal((await repo.unread(f.customer.user.id)),57);(await f.app.notifications.read(f.customer.user.id,page.notifications[0].id));(await f.app.notifications.read(f.customer.user.id,page.notifications[0].id));
  assert.equal((await repo.unread(f.customer.user.id)),56);
});

test('Expo adapter uses generic bounded payloads, fixed HTTPS endpoints, tickets and receipt error semantics',async()=>{
  const requests=[],results=[{data:{status:'ok',id:'ticket'}},{data:{ticket:{status:'ok'}}},{data:{status:'error',details:{error:'DeviceNotRegistered'}}}];
  const provider=createPushProvider({env:{TAXI_AI_PUSH_ENABLED:'true',TAXI_AI_EXPO_PROJECT_ID:projectId},fetchImpl:async(url,options)=>{requests.push({url,...options});return Response.json(results.shift());}});
  assert.deepEqual(await provider.send({token,notificationId:1}),{status:'ticket',ticket:'ticket'});
  assert.deepEqual(await provider.receipt('ticket'),{status:'ok'});
  assert.deepEqual(await provider.send({token,notificationId:2}),{status:'unregistered'});
  assert.equal(requests[0].url,'https://exp.host/--/api/v2/push/send');assert.equal(requests[1].url,'https://exp.host/--/api/v2/push/getReceipts');
  const body=JSON.parse(requests[0].body);assert.deepEqual(body.data,{notificationId:1});assert.equal(body.ttl,300);assert.equal(requests[0].redirect,'error');
  let called=false;const off=createPushProvider({fetchImpl:async()=>{called=true;throw new Error('No external contact expected');}});await off.send({token,notificationId:1});assert.equal(called,false);
  assert.throws(()=>createPushProvider({env:{TAXI_AI_PUSH_ENABLED:'true'}}),/project/i);
});

test('Expo arrival text contains the requested identity while routing data remains an inbox ID only', async () => {
  const requests = [], arrivalBody = 'Tunde has arrived. Number plate: TEST-123. Toyota Corolla · Standard · Silver.';
  const provider = createPushProvider({ env: { TAXI_AI_PUSH_ENABLED:'true', TAXI_AI_EXPO_PROJECT_ID:projectId },
    fetchImpl: async (_url,options) => { requests.push(JSON.parse(options.body)); return Response.json({ data: { status:'ok',id:'fixture-ticket' } }); } });
  await provider.send({ token,notificationId:3,arrivalBody });
  assert.equal(requests[0].title, 'Taxi Ai · Driver has arrived'); assert.equal(requests[0].body, arrivalBody);
  assert.deepEqual(requests[0].data, { notificationId:3 }); assert.equal(requests[0].ttl, 300);
  await provider.send({ token,notificationId:4,arrivalBody:'x'.repeat(501) });
  assert.equal(requests[1].title, 'Taxi Ai'); assert.match(requests[1].body, /new journey update/);
});

async function dispatchPushFixture(t) {
  const h = await harness(t, { dispatchConfig: { mode: 'sequential' } });
  const { customer, driver } = await participants(h);
  const sent = [], receipts = [];
  const provider = { enabled: true, projectId,
    send: async (data) => { sent.push(data); return { status: 'ticket', ticket: 'dispatch-ticket' }; },
    receipt: async (ticket) => { receipts.push(ticket); return { status: 'ok' }; } };
  const app = createApplication({ db: h.db, clock: () => h.now, allowSimulation: true,
    pushProvider: provider, dispatchConfig: { mode: 'sequential' } });
  const device = (await app.devices.issue(driver.user.id, 'Dispatch phone')).credentials;
  (await app.notifications.register(driver.user.id, device.sessionId, { token, projectId }));
  const ride = await requestRide(customer);
  await app.dispatch.refresh();
  const offer = (await app.dispatch.forDriver(driver.user.id, h.now));
  assert.equal(offer.rideId, ride.id);
  const job = h.db.prepare(`SELECT j.id FROM push_jobs j JOIN account_notifications n ON n.id=j.notification_id
    WHERE n.user_id=? AND n.kind='request'`).get(driver.user.id);
  assert.ok(job);
  return { h, app, driver, ride, offer, job, sent, receipts, provider };
}

test('expired and declined dispatch invitations discard pending push jobs without a provider send', async (t) => {
  for (const outcome of ['expired', 'declined']) {
    const f = await dispatchPushFixture(t);
    if (outcome === 'expired') f.h.advance(20_000);
    else (await f.app.dispatch.decline({ userId: f.driver.user.id, offerId: f.offer.id, key: randomUUID(), data: {} }));
    await f.app.notifications.deliverPending();
    assert.equal(f.sent.length, 0, outcome);
    assert.equal(f.h.db.prepare('SELECT status FROM push_jobs WHERE id=?').get(f.job.id).status, 'dead', outcome);
  }
});

test('a dispatch push retry rechecks its offer while an already-sent ticket can finish its receipt', async (t) => {
  const retry = await dispatchPushFixture(t);
  retry.provider.send = async (data) => { retry.sent.push(data); return { status: 'retry' }; };
  await retry.app.notifications.deliverPending();
  assert.equal(retry.sent.length, 1);
  retry.h.advance(60_000);
  await retry.app.notifications.deliverPending();
  assert.equal(retry.sent.length, 1, 'an expired invitation cannot cause a new provider send');
  assert.equal(retry.h.db.prepare('SELECT status FROM push_jobs WHERE id=?').get(retry.job.id).status, 'dead');

  const ticket = await dispatchPushFixture(t);
  await ticket.app.notifications.deliverPending();
  assert.equal(ticket.sent.length, 1);
  ticket.h.advance(15 * 60_000);
  await ticket.app.notifications.deliverPending();
  assert.deepEqual(ticket.receipts, ['dispatch-ticket']);
  assert.equal(ticket.sent.length, 1);
  assert.equal(ticket.h.db.prepare('SELECT status FROM push_jobs WHERE id=?').get(ticket.job.id).status, 'done');
});

test('separate push workers claim once and an expired worker cannot overwrite a replacement receipt', async (t) => {
  const f = await fixture(t); let started, finish, sends = 0;
  const ready = new Promise(resolve => { started = resolve; });
  f.provider.send = async () => {
    sends += 1;
    if (sends === 1) { started(); return new Promise(resolve => { finish = resolve; }); }
    return { status: 'ticket', ticket: 'replacement-ticket' };
  };
  const replacement = createApplication({ db: f.h.db, clock: () => f.h.now, pushProvider: f.provider, dispatchConfig: { mode: 'legacy' } });
  const original = f.app.notifications.deliverPending(); await ready;
  await replacement.notifications.deliverPending(); assert.equal(sends, 1);
  f.h.advance(60_000);
  await replacement.notifications.deliverPending(); assert.equal(sends, 2);
  finish({ status: 'ticket', ticket: 'stale-ticket' }); await original;
  const job = f.h.db.prepare('SELECT attempts,status,ticket FROM push_jobs').get();
  assert.equal(job.attempts, 2); assert.equal(job.status, 'ticket'); assert.equal(job.ticket, 'replacement-ticket');
});
