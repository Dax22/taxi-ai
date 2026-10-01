import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash,randomUUID } from 'node:crypto';
import { openPostgresDatabase } from '../src/infrastructure/postgres.mjs';
import { createCheckoutPaymentsRepository } from '../src/modules/checkout-payments/repository.mjs';
import { createCheckoutPaymentsService } from '../src/modules/checkout-payments/service.mjs';
const connectionString=process.env.TAXI_AI_TEST_POSTGRES_URL;

test('PostgreSQL checkout has one initializer and one atomic fulfillment across competing API replicas', {skip:!connectionString},async()=>{
  const schema=`test_checkout_${randomUUID().replaceAll('-','')}`;
  const db=await openPostgresDatabase({connectionString,schema,max:3,migrate:true});let other;
  try {
    const now=Date.UTC(2026,0,1),user={id:randomUUID(),email:'paystack-test@example.test'},targetId=randomUUID();
    await db.prepare('INSERT INTO users(id,email,name,password_hash,role,created_at) VALUES(?,?,?,?,?,?)').run(user.id,user.email,'Payment test','unused','customer',now);
    await db.exec('CREATE TABLE test_fulfillment(target_id TEXT PRIMARY KEY,paid_at BIGINT NOT NULL)');
    let initializeCalls=0,verifyCalls=0,verifyWait=null,verifyEntered=()=>{};
    const provider={async initialize({reference}){initializeCalls++;return {reference,checkoutUrl:'https://checkout.paystack.com/replica-test'};},
      async verify(reference){verifyCalls++;verifyEntered();if(verifyWait)await verifyWait;return {reference,amountKobo:470001,currency:'NGN',domain:'test',status:'success',transactionId:reference};}};
    function service(database) {return createCheckoutPaymentsService({repository:createCheckoutPaymentsRepository(database),getAccount:async()=>user,
      contextFor:async()=>({customerId:user.id,amountKobo:470001,currency:'NGN',eligible:true}),
      onPaid:async record=>{if(!record.eligible)return {applied:false};await database.prepare('INSERT INTO test_fulfillment(target_id,paid_at) VALUES(?,?)').run(record.targetId,now);return {applied:true};},
      provider,unitOfWork:run=>database.transaction(run),tokens:{id:randomUUID,digest:value=>createHash('sha256').update(value).digest('hex')},audit:{record:async()=>{}},clock:()=>now,enabled:true});}
    other=await openPostgresDatabase({connectionString,schema,max:3});const first=service(db),second=service(other);
    const args={userId:user.id,kind:'ride',targetId,action:'start',data:{expectedVersion:0}},key=randomUUID();
    const concurrent=await Promise.all([first.command({...args,key}),second.command({...args,key})]);
    assert.equal(initializeCalls,1);assert.equal(concurrent.filter(result=>result.replayed).length,1);
    const saved=(await first.get(user.id,'ride',targetId)).payment;assert.equal(saved.status,'pending');
    await Promise.all([first.command({...args,action:'refresh',data:{expectedVersion:saved.version},key:randomUUID()}),second.handleVerifiedReference(saved.reference)]);
    assert.equal((await first.get(user.id,'ride',targetId)).payment.status,'paid');
    assert.equal(Number((await db.prepare('SELECT count(*) AS n FROM test_fulfillment').get()).n),1);assert.equal(verifyCalls,1);
    const close={kind:'ride',targetId,customerId:user.id,closedAt:now};
    await Promise.all([db.transaction(()=>first.close(close)),other.transaction(()=>second.close(close))]);
    const refunded=(await first.get(user.id,'ride',targetId)).payment;
    assert.equal(refunded.status,'refund_required');assert.equal(refunded.refundAmountKobo,470001);
    assert.equal(Number((await db.prepare('SELECT count(*) AS n FROM checkout_payment_closures').get()).n),1);
    const anotherTarget=randomUUID(),started=await first.command({...args,targetId:anotherTarget,key:randomUUID()});
    let release;verifyWait=new Promise(resolve=>{release=resolve;});const entered=new Promise(resolve=>{verifyEntered=resolve;});
    const inFlight=second.command({...args,targetId:anotherTarget,action:'refresh',data:{expectedVersion:started.payment.version},key:randomUUID()});
    await entered;await db.transaction(()=>first.close({...close,targetId:anotherTarget}));release();
    const cancelled=await inFlight;assert.equal(cancelled.payment.status,'refund_required');
    assert.equal(Number((await db.prepare('SELECT count(*) AS n FROM test_fulfillment').get()).n),1,'Closure during verify must not fulfill a second target');
  } finally {if(other)await other.close();await db.exec(`DROP SCHEMA "${schema}" CASCADE`);await db.close();}
});
