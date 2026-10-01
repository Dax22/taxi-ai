import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID,createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { openDatabase } from '../src/infrastructure/database.mjs';
import { asAsyncDatabase } from '../src/infrastructure/async-database.mjs';
import { createCheckoutPaymentsRepository } from '../src/modules/checkout-payments/repository.mjs';
import { createCheckoutPaymentsService } from '../src/modules/checkout-payments/service.mjs';
import { check } from '../src/shared/errors.mjs';

async function fixture(t,options={}) {
  const raw=openDatabase(':memory:'),db=asAsyncDatabase(raw); t.after(()=>db.close());
  let now=Date.UTC(2026,0,1),inTransaction=0,initializeCalls=0,verifyCalls=0;
  const customer={id:randomUUID(),email:'payer@example.test'},driver={id:randomUUID(),email:'driver@example.test'},stranger={id:randomUUID()};
  for(const user of [customer,driver,stranger]) await db.prepare("INSERT INTO users(id,email,name,password_hash,role,created_at) VALUES(?,?,?,?,?,?)").run(user.id,user.email??'stranger@example.test','Checkout test','unused','customer',now);
  await db.exec('CREATE TABLE test_fulfillment(target_id TEXT PRIMARY KEY,applied_at INTEGER NOT NULL)');
  const targetId=randomUUID(),kind=options.kind??'ride',context={customerId:customer.id,amountKobo:470001,currency:'NGN',eligible:true,paymentMode:'paystack_test'};
  const repository=createCheckoutPaymentsRepository(db),users=new Map([customer,driver,stranger].map(u=>[u.id,u]));
  let initialize=async ({reference})=>({reference,checkoutUrl:'https://checkout.paystack.com/fictional-test-checkout'});
  let verify=async reference=>({reference,amountKobo:context.amountKobo,currency:'NGN',domain:'test',status:'success',transactionId:'123456'});
  let apply=async record=>{ if(!record.eligible) return {applied:false}; await db.prepare('INSERT INTO test_fulfillment(target_id,applied_at) VALUES(?,?)').run(record.targetId,now);return {applied:true}; };
  const deps={repository,getAccount:async id=>users.get(id),contextFor:async(user,k,id)=>{check(id===targetId && k===kind && [customer.id,driver.id].includes(user.id),'NOT_FOUND','Not found');return {...context};},
    onPaid:record=>apply(record),provider:{initialize:async args=>{assert.equal(inTransaction,0,'initialize outside transaction');initializeCalls++;return initialize(args);},verify:async reference=>{assert.equal(inTransaction,0,'verify outside transaction');verifyCalls++;return verify(reference);}},
    unitOfWork:run=>db.transaction(async()=>{inTransaction++;try{return await run();}finally{inTransaction--;}}),
    tokens:{id:randomUUID,digest:value=>createHash('sha256').update(value).digest('hex')},audit:{record:async()=>{}},clock:()=>now,enabled:options.enabled??true};
  let service=createCheckoutPaymentsService(deps);
  return {db,raw,repository,customer,driver,stranger,context,targetId,kind,deps,users,get service(){return service;},
    get now(){return now;},advance:n=>{now+=n;},get initializeCalls(){return initializeCalls;},get verifyCalls(){return verifyCalls;},
    setInitialize:fn=>{initialize=fn;},setVerify:fn=>{verify=fn;},setApply:fn=>{apply=fn;},restart:enabled=>{service=createCheckoutPaymentsService({...deps,enabled});},
    count:async()=>Number((await db.prepare('SELECT count(*) AS n FROM test_fulfillment').get()).n),
    get:(user=customer)=>service.get(user.id,kind,targetId),
    command:(action,version,key=randomUUID(),extra={})=>service.command({userId:customer.id,kind,targetId,action,key,data:{expectedVersion:version},...extra}),
  };
}

test('Paystack test checkout is disabled by default and leaves legacy simulation bookings untouched',async t=>{
  const f=await fixture(t,{enabled:false});const empty=await f.get();
  assert.equal(empty.settings.enabled,false);assert.equal(empty.payment,null);assert.equal(empty.canStart,false);
  await assert.rejects(()=>f.command('start',0),{code:'FORBIDDEN'});assert.equal(f.initializeCalls,0);
  f.restart(true);f.context.paymentMode='simulation';assert.equal((await f.get()).settings.enabled,false);
  await assert.rejects(()=>f.command('start',0),{code:'FORBIDDEN'});assert.equal(f.initializeCalls,0);
});

test('server-owned amount, stable retry references, verified settlement and participant redaction work together',async t=>{
  const f=await fixture(t),key=randomUUID(),start=await f.command('start',0,key);
  assert.equal(start.payment.status,'pending');assert.equal(start.canStart,false);assert.equal(start.isPayer,true);
  const replay=await f.command('start',0,key);assert.equal(replay.replayed,true);assert.equal(replay.payment.reference,start.payment.reference);assert.equal(f.initializeCalls,1);
  await assert.rejects(()=>f.command('refresh',start.payment.version,key),{code:'KEY_REUSED'});
  await assert.rejects(()=>f.command('start',0),{code:'STALE_VERSION'});
  await f.command('start',start.payment.version);assert.equal(f.initializeCalls,1);
  const participant=await f.get(f.driver);assert.equal(participant.payment.reference,null);assert.equal(participant.payment.checkoutUrl,null);assert.equal(participant.isPayer,false);
  await assert.rejects(()=>f.get(f.stranger),{code:'NOT_FOUND'});
  const refreshKey=randomUUID(),paid=await f.command('refresh',start.payment.version,refreshKey);
  assert.equal(paid.payment.status,'paid');assert.equal(paid.payment.checkoutUrl,null);assert.equal(paid.payment.receipt.notice,'PAYSTACK TEST RECEIPT — NO LIVE MONEY MOVED');
  assert.equal(paid.payment.receipt.amountKobo,470001);assert.equal(await f.count(),1);
  await f.command('refresh',start.payment.version,refreshKey);assert.equal(f.verifyCalls,1);assert.equal(await f.count(),1);
  const base={kind:f.kind,targetId:f.targetId,customerId:f.customer.id,amountKobo:470001,currency:'NGN'};
  await f.service.requirePaid(base);await assert.rejects(()=>f.service.requirePaid({...base,amountKobo:470002}),{code:'PAYMENT_REQUIRED'});
  await assert.rejects(()=>f.service.requirePaid({...base,customerId:f.driver.id}),{code:'PAYMENT_REQUIRED'});
  const driverView=await f.get(f.driver);assert.equal(driverView.payment.receipt,null);assert.equal(driverView.payment.reference,null);
});

test('concurrent starts reserve one checkout and provider I/O does not hold the database transaction',async t=>{
  const f=await fixture(t);let release,entered;const wait=new Promise(resolve=>{release=resolve;});const called=new Promise(resolve=>{entered=resolve;});
  f.setInitialize(async({reference})=>{entered();await wait;return {reference,checkoutUrl:'https://checkout.paystack.com/test'};});
  const first=f.command('start',0);await called;
  assert.equal((await f.get()).payment.status,'initializing');
  await assert.rejects(()=>f.command('start',0),{code:'STALE_VERSION'});assert.equal(f.initializeCalls,1);
  release();const result=await first;assert.equal(result.payment.status,'pending');
});

test('unknown initialization outcome survives service restart and never creates another charge',async t=>{
  const f=await fixture(t);f.setInitialize(async()=>{throw new Error('response lost after provider accepted');});
  const first=await f.command('start',0);assert.equal(first.payment.status,'unknown');const reference=first.payment.reference;
  f.restart(true);await f.command('start',first.payment.version);assert.equal(f.initializeCalls,1);
  const paid=await f.command('refresh',first.payment.version);assert.equal(paid.payment.status,'paid');assert.equal(paid.payment.reference,reference);assert.equal(await f.count(),1);
});

test('live-domain, wrong amount, foreign references and invalid statuses never fulfill a test checkout',async t=>{
  const f=await fixture(t);let result=await f.command('start',0);
  for(const change of [{domain:'live'},{amountKobo:1},{currency:'USD'},{reference:'foreign'},{status:'invented'}]) {
    f.setVerify(async reference=>({reference,amountKobo:470001,currency:'NGN',domain:'test',status:'success',...change}));
    result=await f.command('refresh',result.payment.version);assert.equal(result.payment.status,'unknown');assert.equal(await f.count(),0);
  }
  f.setVerify(async reference=>({reference,amountKobo:470001,currency:'NGN',domain:'test',status:'failed'}));
  result=await f.command('refresh',result.payment.version);assert.equal(result.payment.status,'failed');assert.equal(result.payment.checkoutUrl,null);
  await f.command('start',result.payment.version);assert.equal(f.initializeCalls,1);
});

test('verified late success records a refund review after cancellation without fulfilling the target',async t=>{
  const f=await fixture(t),first=await f.command('start',0);
  f.context.eligible=false;
  await f.deps.unitOfWork(()=>f.service.close({kind:f.kind,targetId:f.targetId,customerId:f.customer.id,closedAt:f.now}));
  const closed=await f.get();assert.equal(closed.payment.checkoutUrl,null);
  const result=await f.command('refresh',closed.payment.version);assert.equal(result.payment.status,'refund_required');
  assert.equal(result.payment.refundAmountKobo,470001);assert.equal(result.payment.reference,first.payment.reference);
  assert.equal(result.payment.receipt.amountKobo,470001);assert.equal(await f.count(),0);
});

test('partial food cancellation records each refund liability once and never claims an automatic refund',async t=>{
  const f=await fixture(t,{kind:'food'}),first=await f.command('start',0);await f.command('refresh',first.payment.version);
  const ctx={kind:'food',targetId:f.targetId,customerId:f.customer.id,orderId:randomUUID(),refundAmountKobo:100001};
  await f.deps.unitOfWork(()=>f.service.close(ctx));await f.deps.unitOfWork(()=>f.service.close(ctx));
  let result=await f.get();assert.equal(result.payment.status,'refund_required');assert.equal(result.payment.refundAmountKobo,100001);
  assert.equal((await f.repository.closures(result.payment.id)).length,1);
  await f.deps.unitOfWork(()=>f.service.close({...ctx,orderId:randomUUID(),refundAmountKobo:200000}));
  result=await f.get();assert.equal(result.payment.refundAmountKobo,300001);assert.equal(result.payment.receipt.amountKobo,470001);assert.equal(await f.count(),1);
});

test('failed atomic fulfillment is retried durably after lease expiry without losing verified money',async t=>{
  const f=await fixture(t),first=await f.command('start',0);let fail=true;
  f.setApply(async record=>{await f.db.prepare('INSERT INTO test_fulfillment(target_id,applied_at) VALUES(?,?)').run(record.targetId,f.now);if(fail)throw new Error('injected write failure');return {applied:true};});
  await assert.rejects(()=>f.command('refresh',first.payment.version),/injected write failure/);assert.equal(await f.count(),0);
  assert.equal((await f.get()).payment.status,'pending');fail=false;f.advance(60001);
  assert.equal((await f.service.reconcileDue()).checked,1);assert.equal((await f.get()).payment.status,'paid');assert.equal(await f.count(),1);
  await f.service.handleVerifiedReference(first.payment.reference);assert.equal(await f.count(),1);assert.equal(f.verifyCalls,2);
});

test('logout during initialization withholds checkout credentials but keeps the durable pending payment',async t=>{
  const f=await fixture(t);let authenticated=true;
  f.setInitialize(async({reference})=>{authenticated=false;return {reference,checkoutUrl:'https://checkout.paystack.com/test'};});
  await assert.rejects(()=>f.command('start',0,randomUUID(),{reauthenticate:async()=>authenticated ? f.customer : null}),{code:'UNAUTHENTICATED'});
  assert.equal((await f.repository.find(f.kind,f.targetId)).status,'pending');assert.equal(f.initializeCalls,1);
});

test('turning off new checkout still reconciles existing payments and preserves mandatory payment gates',async t=>{
  const f=await fixture(t),first=await f.command('start',0);f.restart(false);
  assert.equal((await f.get()).settings.enabled,false);
  const paid=await f.command('refresh',first.payment.version);assert.equal(paid.payment.status,'paid');assert.equal(await f.count(),1);
  await f.service.requirePaid({kind:f.kind,targetId:f.targetId,customerId:f.customer.id,amountKobo:470001,currency:'NGN'});
});

test('concurrent refresh and webhook verification use one leased provider request',async t=>{
  const f=await fixture(t),first=await f.command('start',0);let release,entered;
  const wait=new Promise(resolve=>{release=resolve;}),called=new Promise(resolve=>{entered=resolve;});
  f.setVerify(async reference=>{entered();await wait;return {reference,amountKobo:470001,currency:'NGN',domain:'test',status:'success'};});
  const refresh=f.command('refresh',first.payment.version);await called;
  assert.deepEqual(await f.service.handleVerifiedReference(first.payment.reference),{accepted:true});assert.equal(f.verifyCalls,1);
  release();assert.equal((await refresh).payment.status,'paid');assert.equal(await f.count(),1);
});

test('reconciliation clamps an untrusted batch size to twenty-five rows',async t=>{
  const f=await fixture(t);for(let index=0;index<30;index++) {
    const id=randomUUID();await f.repository.insert({id,kind:'ride',targetId:randomUUID(),customerId:f.customer.id,amountKobo:470001,currency:'NGN',reference:`TA-TEST-${id}`,now:f.now-60001,leaseToken:randomUUID()});
  }
  f.setVerify(async reference=>({reference,amountKobo:470001,currency:'NGN',domain:'test',status:'pending'}));
  assert.equal((await f.service.reconcileDue({limit:10000})).checked,25);assert.equal(f.verifyCalls,25);
});


test('additive checkout migration keeps earlier fares and food snapshots as simulations without creating charges',()=>{
  const db=new DatabaseSync(':memory:');
  try {
    db.exec("CREATE TABLE users(id TEXT PRIMARY KEY); CREATE TABLE ride_trips(ride_id TEXT PRIMARY KEY,fare_kobo INTEGER); CREATE TABLE eats_orders(id TEXT PRIMARY KEY,status TEXT,snapshot_json TEXT);");
    db.prepare('INSERT INTO ride_trips VALUES(?,?)').run('legacy-trip',470001);
    const snapshot=JSON.stringify({payment:{method:'test',status:'not_charged'},totals:{totalKobo:320001}});
    db.prepare('INSERT INTO eats_orders VALUES(?,?,?)').run('legacy-food','placed',snapshot);
    db.exec(readFileSync(new URL('../migrations/046_checkout_payments.sql',import.meta.url),'utf8'));
    assert.deepEqual({...db.prepare('SELECT * FROM ride_trips').get()},{ride_id:'legacy-trip',fare_kobo:470001,payment_mode:'simulation'});
    assert.equal(db.prepare('SELECT snapshot_json FROM eats_orders').get().snapshot_json,snapshot);
    assert.equal(db.prepare('SELECT count(*) AS n FROM checkout_payments').get().n,0);
    assert.ok(db.prepare("SELECT name FROM sqlite_master WHERE name='eats_pending_payment_expiry'").get());
  } finally {db.close();}
});


test('signed webhook hints for another application reference are ignored without provider calls',async t=>{
  const f=await fixture(t);
  assert.deepEqual(await f.service.handleVerifiedReference('other-app_checkout-123'),{accepted:false});
  assert.deepEqual(await f.service.handleVerifiedReference('TA-TEST-an-unrelated-reference'),{accepted:false});
  await assert.rejects(()=>f.service.handleVerifiedReference('malformed reference'),{code:'INVALID_INPUT'});
  assert.equal(f.verifyCalls,0);assert.equal(f.initializeCalls,0);
});
