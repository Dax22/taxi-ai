import test from 'node:test';import assert from 'node:assert/strict';import {randomUUID} from 'node:crypto';
import {openDatabase,SCHEMA_VERSION} from '../src/infrastructure/database.mjs';import {asAsyncDatabase} from '../src/infrastructure/async-database.mjs';
import {createMobileOperationsRepository} from '../src/modules/mobile-operations/repository.mjs';import {createMobileOperationsService} from '../src/modules/mobile-operations/service.mjs';
import {heartbeatInput,routeClass,readMobileReleasePolicy} from '../src/modules/mobile-operations/domain.mjs';

test('mobile heartbeat stores only bounded build/capability metadata and updates one device row',async t=>{
 assert.equal(SCHEMA_VERSION,58);const db=asAsyncDatabase(openDatabase(':memory:'));t.after(()=>db.close());const user=randomUUID(),session=randomUUID(),now=1_800_000_000_000;
 await db.prepare('INSERT INTO users(id,email,name,role,password_hash,created_at) VALUES(?,?,?,?,?,?)').run(user,'mobile@example.test','Mobile Tester','customer','fixture',now);
 await db.prepare('INSERT INTO device_sessions(id,user_id,name,access_hash,access_expires_at,created_at,refreshed_at,expires_at,idle_expires_at) VALUES(?,?,?,?,?,?,?,?,?)')
  .run(session,user,'iPhone test','a'.repeat(64),now+600000,now,now,now+30*86400000,now+7*86400000);
 let clock=now;const service=createMobileOperationsService({repository:createMobileOperationsRepository(db),clock:()=>clock,sampleEvery:2});
 const data={platform:'ios',appVersion:'0.9.0',nativeBuild:14,easBuildId:randomUUID(),buildProfile:'acceptance',gitCommit:'a'.repeat(40),osVersion:'18.1',locationPermission:'granted',backgroundLocationPermission:'denied',notificationPermission:'granted'};
 await service.heartbeat({userId:user,sessionId:session},data);clock+=5000;await service.heartbeat({userId:user,sessionId:session},{...data,nativeBuild:15,notificationPermission:'denied'});
 const row=await db.prepare('SELECT * FROM mobile_device_health WHERE session_id=?').get(session);assert.equal(row.native_build,15);assert.equal(row.first_seen_at,now);assert.equal(row.last_seen_at,clock);assert.equal(row.notification_permission,'denied');
 const serialized=JSON.stringify(row);for(const secret of ['access_hash','refreshToken','pushToken','latitude','longitude','position_json'])assert.equal(serialized.includes(secret),false);
 await assert.rejects(service.heartbeat({userId:user,sessionId:session},{...data,platform:'web'}),{code:'INVALID_INPUT'});
});

test('mobile API sampling keeps all errors, samples successes, classifies only coarse routes and expires old rows',async t=>{
 const db=asAsyncDatabase(openDatabase(':memory:'));t.after(()=>db.close());let now=2_000_000_000_000;const repository=createMobileOperationsRepository(db),service=createMobileOperationsService({repository,clock:()=>now,sampleEvery:3});
 await service.recordApi({path:'/booking/requests/secret-ride-id?token=private',method:'POST',statusCode:200,durationMs:120});
 await service.recordApi({path:'/booking',method:'GET',statusCode:200,durationMs:80});
 await service.recordApi({path:'/booking/search?q=private-address',method:'POST',statusCode:200,durationMs:90});
 await service.recordApi({path:'/journeys/secret/messages',method:'GET',statusCode:500,durationMs:40});
 const rows=(await db.prepare('SELECT route_class,method,status_code,duration_ms,sample_weight FROM mobile_api_samples ORDER BY id').all()).map(row=>({...row}));
 assert.deepEqual(rows,[{route_class:'booking',method:'POST',status_code:200,duration_ms:90,sample_weight:3},{route_class:'journey',method:'GET',status_code:500,duration_ms:40,sample_weight:1}]);
 assert.equal(routeClass('/tracking/rides/secret?clientId=private'),'tracking');assert.equal(JSON.stringify(rows).includes('secret'),false);
 now+=8*86400000;await service.sweep();assert.equal((await db.prepare('SELECT count(*) AS n FROM mobile_api_samples').get()).n,0);
});

test('mobile release policy is monitor-only configuration and fails closed on malformed values',()=>{
 assert.deepEqual(readMobileReleasePolicy({TAXI_AI_MOBILE_MIN_IOS_BUILD:'12',TAXI_AI_MOBILE_MIN_ANDROID_VERSION:'0.9.0'}),{ios:{minimumBuild:12,minimumVersion:null},android:{minimumBuild:null,minimumVersion:'0.9.0'}});
 assert.throws(()=>readMobileReleasePolicy({TAXI_AI_MOBILE_MIN_IOS_BUILD:'zero'}),{code:'INVALID_MOBILE_RELEASE_POLICY'});
 assert.equal(heartbeatInput({platform:'android',appVersion:'0.9.0',nativeBuild:1,easBuildId:null,buildProfile:null,gitCommit:null,osVersion:'15',locationPermission:'undetermined',backgroundLocationPermission:'denied',notificationPermission:'granted'}).locationPermission,'unknown');
});
