import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { openPostgresDatabase, migratePostgres, POSTGRES_MIGRATIONS } from '../src/infrastructure/postgres.mjs';
import { auditTrackingTransition } from '../../../scripts/tracking-transition-audit.mjs';

const connectionString=process.env.TAXI_AI_TEST_POSTGRES_URL;
for (const priorVersion of [20, 21]) test(`populated PostgreSQL v${priorVersion} upgrades without rewriting live invitations, trips or verification`, {skip:!connectionString}, async t=>{
 const schema=`test_${randomUUID().replaceAll('-','')}`;
 const db=await openPostgresDatabase({connectionString,schema,max:2,verify:false});
 try{
  await db.transaction(async()=>{
   await db.exec(`CREATE SCHEMA "${schema}"`);
   await db.exec('CREATE EXTENSION IF NOT EXISTS postgis WITH SCHEMA public; CREATE EXTENSION IF NOT EXISTS citext WITH SCHEMA public;');
   await db.exec('CREATE TABLE taxi_schema_migrations(version INTEGER PRIMARY KEY,name TEXT NOT NULL UNIQUE,checksum TEXT NOT NULL,applied_at BIGINT NOT NULL)');
   for(let index=0;index<priorVersion;index++){
    const name=POSTGRES_MIGRATIONS[index],sql=await readFile(new URL(`../migrations/postgres/${name}`,import.meta.url),'utf8');
    await db.exec(sql);
    await db.prepare('INSERT INTO taxi_schema_migrations VALUES(?,?,?,?)').run(index+1,name,createHash('sha256').update(sql).digest('hex'),Date.now());
   }
  });
  const now=Date.now(),sender=randomUUID(),driver=randomUUID(),recipient=randomUUID(),ride=randomUUID(),link=randomUUID();
  await db.transaction(async()=>{
   for(const [id,role] of [[sender,'customer'],[driver,'driver'],[recipient,'customer']])
    await db.prepare('INSERT INTO users(id,email,name,password_hash,role,created_at) VALUES(?,?,?,?,?,?)').run(id,`${id}@example.test`,'Synthetic test account','not-a-login-hash',role,now);
   await db.prepare('INSERT INTO drivers(user_id,vehicle_model,vehicle_plate) VALUES(?,?,?)').run(driver,'Test vehicle','TEST-PG');
   await db.prepare("INSERT INTO rides(id,customer_id,driver_id,pickup_id,destination_id,suggested_fare_kobo,status,created_at,updated_at,matched_at) VALUES(?,?,?,'wuse-ii','maitama',100000,'agreed',?,?,?)").run(ride,sender,driver,now,now,now);
   await db.prepare("INSERT INTO ride_trips(ride_id,customer_id,driver_id,status,fare_kobo,booked_at,started_at,departed_at,arrived_at) VALUES(?,?,?,'in_progress',100000,?,?,?,?)").run(ride,sender,driver,now,now,now,now);
   await db.prepare('INSERT INTO delivery_orders(ride_id,details_json) VALUES(?,?)').run(ride,JSON.stringify({description:'Synthetic parcel',weightKg:1,recipientName:'Test recipient'}));
   await db.prepare('INSERT INTO parcel_tracking_links(id,ride_id,owner_id,token_hash,recipient_id,claimed_at,created_at,expires_at) VALUES(?,?,?,?,?,?,?,?)').run(link,ride,sender,'a'.repeat(64),recipient,now,now,now+86400000);
  });
  const beforeTrip=await db.prepare('SELECT * FROM ride_trips WHERE ride_id=?').get(ride);
  const beforeLink=await db.prepare('SELECT * FROM parcel_tracking_links WHERE id=?').get(link);
  const before=await auditTrackingTransition(db);
  assert.equal(before.bindingColumnsPresent,false);assert.equal(before.legacyActiveGrants,1);assert.equal(before.drainRequired,true);
  await migratePostgres(db);await migratePostgres(db);
  assert.equal(await db.healthy(),true);
  assert.deepEqual(await db.prepare('SELECT * FROM ride_trips WHERE ride_id=?').get(ride),beforeTrip);
  const afterLink=await db.prepare('SELECT * FROM parcel_tracking_links WHERE id=?').get(link);
  assert.deepEqual(afterLink,{...beforeLink,intended_email_hash:null,recipient_verified_at:null});
  assert.equal((await db.prepare('SELECT count(*) AS n FROM account_email_verifications').get()).n,0,'Migration must not invent mailbox verification');
  assert.equal((await auditTrackingTransition(db)).legacyActiveGrants,1,'Audit must not revoke the active invitation');
  const second=await openPostgresDatabase({connectionString,schema,max:1});
  try{
   const insert=who=>who.transaction(()=>who.prepare("INSERT INTO delivery_exception_events(id,ride_id,actor_id,kind,note,created_at,version,command_key,fingerprint) VALUES(?,?,?,'recipient_unavailable','Fixture',?,1,?,?)").run(randomUUID(),ride,sender,now,randomUUID(),'fixture'));
   const outcomes=await Promise.allSettled([insert(db),insert(second)]);
   assert.equal(outcomes.filter(r=>r.status==='fulfilled').length,1,'Independent pools cannot duplicate the same event version');
   assert.equal((await db.prepare('SELECT count(*) AS n FROM delivery_exception_events').get()).n,1);
  }finally{await second.close();}
  await db.transaction(async()=>{await db.exec('SET TRANSACTION READ ONLY');assert.equal((await auditTrackingTransition(db)).drainRequired,true);});
  t.diagnostic('Synthetic in-progress parcel preserved; rollout remains blocked until it is safely drained. No real account was modified.');
 }finally{await db.exec(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);await db.close();}
});
