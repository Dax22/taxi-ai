import test from 'node:test';
import assert from 'node:assert/strict';
import { createVehicleCheckController } from '../src/vehicle-check-controller.mjs';
import { readVehicleChecks,VEHICLE_PHOTO_CONSENT } from '../src/vehicle-checks.mjs';
const rideId='00000000-0000-4000-8000-000000000001',id='00000000-0000-4000-8000-000000000002';
const result={id,rideId,createdAt:1000,expiresAt:2000,outcome:'inconclusive',current:true,fields:[],reasons:['unclear_photo']};
const listing={rideId,enabled:true,provider:'OpenAI',canCheck:true,consentVersion:VEHICLE_PHOTO_CONSENT,checks:[]};
const image={mimeType:'image/jpeg',base64:'private-photo'};
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return{promise,resolve,reject};};
function setup(){let saved=[],calls=[];const api={load:async()=>({...listing,checks:saved}),submit:async(...args)=>{calls.push(args);saved=[result];return{check:result};}};
  const c=createVehicleCheckController({rideId,api,makeKey:()=>id});return{c,api,calls,save:checks=>{saved=checks;}};}
test('photo controller sends explicit consent once, reloads saved results, and does not keep the photo in state',async()=>{
  const f=setup();assert.equal(await f.c.analyse(image),false);await f.c.activate();
  await f.c.analyse(image);assert.deepEqual(f.calls,[[rideId,{image,consentVersion:VEHICLE_PHOTO_CONSENT},id]]);
  assert.equal(f.c.snapshot().value.checks[0].id,id);assert.equal(JSON.stringify(f.c.snapshot()).includes('private-photo'),false);
});
test('pending work prevents duplicate submits and navigation discards old account results',async()=>{
  const f=setup(),gate=deferred();await f.c.activate();f.api.submit=async(...args)=>{f.calls.push(args);return gate.promise;};
  const first=f.c.analyse(image);assert.equal(await f.c.analyse(image),false);assert.equal(f.calls.length,1);
  f.c.pause();gate.resolve({check:result});assert.equal(await first,false);assert.equal(f.c.snapshot().value,null);
  await f.c.activate();f.save([{...result,outcome:'pending'}]);await f.c.load();assert.equal(await f.c.analyse(image),false);
});
test('a lost POST reply recovers the persisted result through GET without resending the photo',async()=>{
  const f=setup();await f.c.activate();f.api.submit=async(...args)=>{f.calls.push(args);f.save([result]);throw new Error('Reply lost');};
  assert.equal(await f.c.analyse(image),false);assert.equal(f.calls.length,1);assert.equal(f.c.snapshot().value.checks[0].id,id);
  assert.match(f.c.snapshot().error,/Reply lost/);assert.equal(JSON.stringify(f.c.snapshot()).includes(image.base64),false);
});
test('failed refresh removes stale comparisons and malformed/cross-trip contracts are rejected',async()=>{
  const f=setup();f.save([result]);await f.c.activate();f.api.load=async()=>{throw new Error('Offline');};await f.c.load();assert.equal(f.c.snapshot().value,null);
  assert.throws(()=>readVehicleChecks({...listing,rideId:id},rideId));
  assert.throws(()=>readVehicleChecks({...listing,checks:[{...result,rideId:id}]},rideId));
  assert.throws(()=>readVehicleChecks({...listing,checks:[{...result,outcome:'verified_safe'}]},rideId));
  assert.throws(()=>readVehicleChecks({...listing,checks:[{...result,fields:[{key:'plate',expected:'ABC',observed:'A\nBC',status:'match'}]}]},rideId));
});
