import test from 'node:test';
import assert from 'node:assert/strict';
import {createSignalDetector,signalQualifies,nearbyZones,routeWarnings} from '../src/safety-monitoring.mjs';
import {createMonitoringController} from '../src/safety-monitoring-controller.mjs';

test('impact requires recent travelling speed, high g and a subsequent stop; phone drops alone do not qualify',()=>{
 const events=[],d=createSignalDetector(s=>events.push(s));
 d.motion(8,1000);d.speed(0,2000);assert.equal(events.length,0);
 d.speed(12,3000);d.motion(5,3100);d.speed(1,5100);assert.equal(events.length,1);assert.equal(events[0].kind,'impact');
 d.speed(12,6000);d.motion(5,6100);d.speed(0,8000);assert.equal(events.length,1,'cooldown');
 const stale=createSignalDetector(s=>events.push(s));stale.speed(12,0);stale.motion(6,6000);stale.speed(0,8000);assert.equal(events.length,1);
 assert.equal(signalQualifies({kind:'impact',capturedAt:0,peakG:Infinity,speedBefore:10,speedAfter:0,windowMs:1000}),false);
});
test('distress requires sustained loud input and resets across silence or missing samples',()=>{
 const events=[],d=createSignalDetector(s=>events.push(s));
 for(let n=0;n<20;n++)d.audio(-5,n*100);assert.equal(events.length,0);
 d.audio(-80,2000);for(let n=21;n<45;n++)d.audio(-5,n*100);assert.equal(events.length,0);
 d.audio(-5,8000);assert.equal(events.length,0,'missing audio breaks continuity');
 for(let n=81;n<=106;n++)d.audio(-5,n*100);assert.equal(events.length,1);assert.equal(events[0].kind,'distress');
});
test('location warnings find a zone between route vertices and ignore expired or distant reports',()=>{
 const zones=[{id:'near',lat:9,lng:7.01,radiusM:100,expiresAt:100},{id:'far',lat:10,lng:8,radiusM:100,expiresAt:100},{id:'expired',lat:9,lng:7.01,radiusM:100,expiresAt:1}];
 assert.deepEqual(routeWarnings(zones,[[7,9],[7.02,9]],50).map(z=>z.id),['near']);
 assert.deepEqual(nearbyZones(zones,[{lat:9,lng:7.01}],50).map(z=>z.id),['near']);
});
function fixture(overrides={}) {
 const data={version:0,canMonitor:true,serverNow:1000,preferences:{enabled:true},alerts:[],warnings:[]};let stopped=0,started=0,emit;
 const c=createMonitoringController({read:async()=>data,write:async()=>data,makeKey:()=> 'immutable-key',onChange:()=>{},clock:()=>1000,
  sensors:{start:async(_,callback)=>{started++;emit=callback;return()=>{stopped++;};}},...overrides});
 return {c,data,get stopped(){return stopped;},get started(){return started;},signal:()=>emit({kind:'manual',capturedAt:1000})};
}
const options={consent:true,contactIds:['family'],crash:true,distress:false,emergency:false};
test('sensors never start without consent; hidden/closed clients release sensors and do not automatically restart',async()=>{
 const f=fixture();await f.c.refresh();await f.c.start({...options,consent:false});assert.equal(f.started,0);
 await f.c.start(options);assert.equal(f.c.snapshot().active,true);f.c.pause();assert.equal(f.stopped,1);
 await f.c.refresh();assert.equal(f.started,1);assert.equal(f.c.snapshot().active,false);f.c.close();
});
test('an uncertain write pauses sensors, preserves its exact request/key and needs explicit retry',async()=>{
 const calls=[];let fail=false;const f=fixture({write:async(action,data,key)=>{calls.push({action,data,key});if(fail)throw new Error('offline');return f.data;}});
 await f.c.refresh();await f.c.start(options);fail=true;await f.c.panic();assert.equal(f.c.snapshot().uncertain,true);assert.equal(f.c.snapshot().active,false);
 await f.c.refresh();assert.equal(calls.length,2,'poll does not retry writes');fail=false;await f.c.retry();assert.deepEqual(calls[1],calls[2]);
 assert.equal(f.c.snapshot().uncertain,false);
});
test('late permission results after account teardown clean up without saving consent',async()=>{
 let resolve,stops=0,writes=0;
 const f=fixture({sensors:{start:()=>new Promise(r=>{resolve=r;})},write:async()=>{writes++;return f.data;}});
 await f.c.refresh();const start=f.c.start(options);f.c.close();resolve(()=>{stops++;});await start;assert.equal(stops,1);assert.equal(writes,0);
});
test('an older poll cannot replace a newer settings write or stop its sensors',async()=>{
 let delay=false,resolve;const f=fixture({read:async()=>delay?new Promise(r=>{resolve=r;}):f.data});
 await f.c.refresh();delay=true;const poll=f.c.refresh();await f.c.start(options);
 resolve({...f.data,preferences:{enabled:false},version:0});await poll;
 assert.equal(f.c.snapshot().active,true);assert.equal(f.c.snapshot().data.preferences.enabled,true);
});
test('a cookie-switched response clears private state and pauses sensors',async()=>{
 let switched=false;const f=fixture({viewerId:'owner',rideId:'ride',read:async()=>({...f.data,viewerId:switched?'other':'owner',rideId:'ride'}),write:async()=>({...f.data,viewerId:'owner',rideId:'ride'})});
 await f.c.refresh();await f.c.start(options);switched=true;await f.c.refresh();
 assert.equal(f.c.snapshot().data,null);assert.equal(f.c.snapshot().active,false);assert.equal(f.stopped,1);
});
