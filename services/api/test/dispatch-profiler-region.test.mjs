import test from 'node:test';import assert from 'node:assert/strict';
import {createDispatchProfiler} from '../src/infrastructure/dispatch-profiler.mjs';
test('dispatch profiler carries only validated coarse region metadata',async()=>{
 const reports=[],profile=createDispatchProfiler({sampleEvery:1,report:value=>reports.push(value)});
 await profile.cycle(async()=>{}, {region:'ng:181:148'});
 await new Promise(resolve=>setImmediate(resolve));
 assert.equal(reports[0].region,'ng:181:148');
 await profile.cycle(async()=>{}, {region:'not/a/region'});
 await new Promise(resolve=>setImmediate(resolve));
 assert.equal(reports[1].region,null);
});
