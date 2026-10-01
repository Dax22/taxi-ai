import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {openPostgresDatabase} from '../src/infrastructure/postgres.mjs';
import {createDeliveryUpdatesRepository} from '../src/modules/delivery-updates/repository.mjs';
import {createDeliveryUpdatesService} from '../src/modules/delivery-updates/service.mjs';
const connectionString=process.env.TAXI_AI_TEST_POSTGRES_URL;

test('PostgreSQL delivery inbox is atomic across replicas and leases road ETA/push exactly once per attempt',{skip:!connectionString},async()=>{
  const schema=`test_delivery_updates_${randomUUID().replaceAll('-','')}`;
  const db=await openPostgresDatabase({connectionString,schema,max:3,migrate:true});let secondDb;
  try {
    const user={id:randomUUID(),role:'customer',capabilities:['customer']},sessionId=randomUUID(),targetId=randomUUID();
    let now=1_000_000,phase='picked_up',estimateCalls=0,entered,release;
    const ready=new Promise(resolve=>{entered=resolve;}),estimateWait=new Promise(resolve=>{release=resolve;});
    await db.prepare('INSERT INTO users(id,email,name,password_hash,role,created_at) VALUES(?,?,?,?,?,?)')
      .run(user.id,'delivery-postgres@example.test','Delivery test','unused','customer',now);
    await db.prepare(`INSERT INTO device_sessions(id,user_id,name,access_hash,access_expires_at,created_at,refreshed_at,expires_at,idle_expires_at)
      VALUES(?,?,?,?,?,?,?,?,?)`).run(sessionId,user.id,'Fixture device','unused-access-hash',now+60000,now,now,now+60000,now+60000);
    const sent=[],token='ExpoPushToken[postgres_fixture_no_real_destination]';
    const provider={enabled:true,send:async data=>{sent.push(data);return {status:'ticket',ticket:`fixture-ticket-${sent.length}`};},receipt:async()=>({status:'ok'})};
    function service(database) { return createDeliveryUpdatesService({repository:createDeliveryUpdatesRepository(database),getAccount:async id=>id===user.id?user:null,
      targetIds:async()=>[user.id],access:async(_user,kind,id)=>kind==='food' && id===targetId ? {screen:'food-order',id} : null,
      phaseFor:async()=>phase,familyTargets:async()=>[{sessionId,token}],validTarget:async job=>job.sessionId===sessionId && job.token===token,
      disableTarget:async()=>{},provider,estimateEta:async()=>{estimateCalls++;entered();await estimateWait;return {source:'road',durationSeconds:1260};},
      unitOfWork:run=>database.transaction(run),tokens:{id:randomUUID},clock:()=>now}); }
    secondDb=await openPostgresDatabase({connectionString,schema,max:3});const first=service(db),second=service(secondDb);
    const milestone=()=>({kind:'food',targetId,customerId:user.id,phase,eventKey:`order:${targetId}:${phase}`,now,
      route:{from:{lat:9.08,lng:7.4},to:{lat:9.085,lng:7.405}}});
    await assert.rejects(db.transaction(async()=>{await first.publish(milestone());throw Error('rollback fixture');}),/rollback fixture/);
    assert.equal((await db.prepare('SELECT count(*) AS n FROM delivery_updates').get()).n,0);
    await Promise.all([db.transaction(()=>first.publish(milestone())),secondDb.transaction(()=>second.publish(milestone()))]);
    assert.equal((await db.prepare('SELECT count(*) AS n FROM delivery_updates').get()).n,1);
    assert.equal((await db.prepare('SELECT count(*) AS n FROM delivery_update_push_jobs').get()).n,1);
    const enriching=first.deliverPending();await ready;await second.deliverPending();assert.equal(estimateCalls,1);assert.equal(sent.length,0);
    release();await enriching;assert.equal(sent.length,1);
    const pickup=await first.forTarget(user.id,'food',targetId);
    assert.equal(pickup.etaMinutes,21);assert.equal((await db.prepare('SELECT route_json FROM delivery_updates').get()).route_json,null);
    assert.ok((await db.prepare('SELECT revision FROM account_revisions WHERE user_id=?').get(user.id)).revision>=2);
    now++;phase='arrived';
    await Promise.all([db.transaction(()=>first.publish(milestone())),secondDb.transaction(()=>second.publish(milestone()))]);
    await Promise.all([first.deliverPending(),second.deliverPending()]);assert.equal(sent.length,2);
    assert.match(sent[1].deliveryBody,/has arrived/);
    const arrival=await first.forTarget(user.id,'food',targetId);assert.equal(arrival.phase,'arrived');
    assert.deepEqual(await first.open(user.id,arrival.id),{target:{screen:'food-order',id:targetId}});
    assert.equal((await first.list(user.id)).unread,1);
    await db.prepare('DELETE FROM device_sessions WHERE id=?').run(sessionId);
    assert.equal((await db.prepare('SELECT count(*) AS n FROM delivery_update_push_jobs').get()).n,0);
  } finally {if(secondDb)await secondDb.close();await db.exec(`DROP SCHEMA "${schema}" CASCADE`);await db.close();}
});
