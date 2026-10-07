import test from 'node:test';import assert from 'node:assert/strict';
import {openDatabase,SCHEMA_VERSION} from '../src/infrastructure/database.mjs';
import {asAsyncDatabase} from '../src/infrastructure/async-database.mjs';
import {createDispatchPerformanceRepository} from '../src/modules/dispatch/repository.mjs';
import {createDispatchPerformanceService} from '../src/modules/dispatch/performance.mjs';
test('dispatch profiler samples persist only bounded aggregate fields and expire',async()=>{
 const db=asAsyncDatabase(openDatabase(':memory:'));let id=0,now=2_000_000_000;
 try{
  assert.equal(SCHEMA_VERSION,58);const service=createDispatchPerformanceService({repository:createDispatchPerformanceRepository(db),tokens:{id:()=>`sample-${++id}`},clock:()=>now,retentionDays:30});
  await service.record({region:'ng:181:148',sampleEvery:10,durationMs:12.5,queryCount:8,queryMs:3.5,queryErrors:0,transactions:2,retries:1,failed:false,phases:{discovery:4,routing:2,commit:5},queries:[{fingerprint:'secret'}]});
  const row=await db.prepare('SELECT * FROM dispatch_profile_samples').get();assert.equal(row.region,'ng:181:148');assert.equal(row.query_count,8);assert.equal(row.retries,1);
  assert.equal(Object.hasOwn(row,'queries'),false);assert.equal(Object.values(row).includes('secret'),false);
  now+=31*24*60*60_000;assert.equal(await service.sweep(),1);assert.equal((await db.prepare('SELECT count(*) AS n FROM dispatch_profile_samples').get()).n,0);
 }finally{await db.close();}
});
