import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createAdminTransactionsRepository } from '../src/modules/admin-transactions/repository.mjs';
import { filters, summarize } from '../src/modules/admin-transactions/domain.mjs';

/** Disposable-source fixture only. Never imports or accesses deployment credentials. */
export async function verifyCombinedReport(db, now = 1800000000000) {
  const buyer = randomUUID(), checkout = randomUUID(), orders = [], quotes = [];
  await db.prepare("INSERT INTO users(id,email,name,password_hash,role,created_at) VALUES(?,?,?,'test-no-login','customer',?)")
    .run(buyer, buyer+'@report.example.test', 'Report fixture', now);
  for (let n = 0; n < 2; n++) {
    const store = randomUUID(), order = randomUUID(), quote = randomUUID(); orders.push(order); quotes.push(quote);
    const snapshot = JSON.stringify({restaurant:{id:store,name:'Test kitchen '+n,areaId:'wuse-ii'},address:{areaId:'maitama'},
      totals:{totalKobo:100000+n*50000,currency:'NGN'},payment:{method:'paystack',status:'paid',targetId:checkout}});
    await db.prepare("INSERT INTO eats_stores(id,status,details_json,created_at,updated_at) VALUES(?,'approved',?,?,?)")
      .run(store,JSON.stringify({name:'Kitchen '+n}),now,now);
    await db.prepare("INSERT INTO eats_orders(id,store_id,customer_id,status,snapshot_json,events_json,created_at,updated_at) VALUES(?,?,?,'placed',?,'[]',?,?)")
      .run(order,store,buyer,snapshot,now,now);
    await db.prepare('INSERT INTO eats_quotes(id,customer_id,store_id,store_version,snapshot_json,expires_at,order_id) VALUES(?,?,?,0,?,?,?)')
      .run(quote,buyer,store,snapshot,now+10000,order);
  }
  await db.prepare('INSERT INTO eats_checkouts(id,customer_id,quote_ids_json,created_at) VALUES(?,?,?,?)')
    .run(checkout,buyer,JSON.stringify(quotes),now);
  const paymentId=randomUUID();
  await db.prepare("INSERT INTO checkout_payments(id,kind,target_id,customer_id,amount_kobo,currency,reference,status,version,created_at,updated_at,paid_at,receipt_json) VALUES(?,'food',?,?,250000,'NGN',?,'paid',1,?,?,?,?)")
    .run(paymentId,checkout,buyer,'TA-TEST-'+paymentId,now,now,now,JSON.stringify({mode:'test'}));
  const repository=createAdminTransactionsRepository(db), result=await repository.checkout(orders[0],now);
  assert.equal(result.id,checkout); assert.deepEqual(result.orders.map(o=>o.id).sort(),[...orders].sort());
  assert.equal(result.orders.reduce((total,row)=>total+BigInt(row.amountKobo),0n),250000n);
  assert.ok(result.orders.every(row=>row.paymentTargetId===checkout&&row.paymentMode==='test'));
  const cohort=filters({customerId:buyer,paymentStatus:'paid',paymentMode:'test',area:'maitama'},now);
  const summary=await summarize(repository.facts(cohort,now));
  assert.equal(summary.total,2);assert.equal(summary.groups[0].amountKobo,'250000');
  assert.equal(await repository.checkout(randomUUID(),now),null);
}
