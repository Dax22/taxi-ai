import test from 'node:test';import assert from 'node:assert/strict';
import {MATCHING_SCALE_PROFILES,scaleProfile} from '../matching-scale-profile.mjs';
test('staged matching profiles increase load without exceeding benchmark safety limits',()=>{
 assert.deepEqual(Object.keys(MATCHING_SCALE_PROFILES),['smoke','city','regional','million-cardinality']);
 const smoke=scaleProfile('smoke'),city=scaleProfile('city'),regional=scaleProfile('regional'),million=scaleProfile('million-cardinality');
 assert.ok(smoke.rate<city.rate&&city.rate<regional.rate);assert.ok(smoke.actors<city.actors&&city.actors<regional.actors);
 for(const profile of [smoke,city,regional,million]){assert.equal(profile.fastPath,true);assert.ok((profile.apiInstances+profile.workers)*profile.poolSize<=80);}
 assert.equal(million.idleAccounts,1000000);assert.equal(regional.idleAccounts,0);assert.throws(()=>scaleProfile('invented'));
});
