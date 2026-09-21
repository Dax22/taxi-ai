import test from 'node:test';
import assert from 'node:assert/strict';
import { setImmediate as settle } from 'node:timers/promises';
import { JourneyController } from '../src/journeys/controller.ts';
import { WorkController } from '../src/work/controller.ts';
import { parseJourney, parseWork, parseThread, parseNotifications } from '../../../packages/shared/src/mobile-journeys.mjs';
import type { Journey, JourneyResult, Work, Availability, AvailabilityResult, Position, Thread } from '../../../packages/shared/src/mobile-journeys.mjs';
const id='00000000-0000-4000-8000-000000000001',env={apiVersion:1 as const,serverNow:1_000_000};
const base:Journey={id,version:1,status:'negotiating',vehicleCategory:'standard',delivery:null,pickup:'Wuse',destination:'Maitama',suggestedFareKobo:450000,fareKobo:null,expiresAt:null,canCancel:true,driver:null,
  mode:'customer',customerName:'Fixture',offer:{id:`${id}:offer:1`,amountKobo:450001,expiresAt:env.serverNow+120000,fromYou:false},allowedActions:['accept','propose','cancel'],chatReady:true,pickupPin:null,pinBlockedUntil:null};
const chat:Thread={...env,rideId:id,messages:[],hasMore:false,nextAfter:0,lastSequence:0,readThrough:0,unread:0,reportedMessageIds:[],canSend:true};
function deferred<T>(){let resolve!:(v:T)=>void,reject!:(e:Error)=>void;const promise=new Promise<T>((a,b)=>{resolve=a;reject=b;});return{resolve,reject,promise};}
function journey(){
  let now=0,key=0,ride=structuredClone(base);
  const calls:Array<{action:string;data:unknown;key:string}>=[],messages:Array<{body:string;key:string}>=[];
  const api:ConstructorParameters<typeof JourneyController>[0]={journey:async()=>({...env,ride:structuredClone(ride)}),thread:async()=>structuredClone(chat),
    journeyCommand:async(_id,action,data,key)=>{calls.push({action,data,key});ride={...ride,version:ride.version+1};return{...env,ride};},
    sendMessage:async(_id,body,key)=>{messages.push({body,key});return{...env,message:{id,sequence:1,body,createdAt:env.serverNow,fromYou:true}};},
    readMessages:async()=>({...env,readThrough:2,unread:0}),reportMessage:async()=>({...env}),};
  const c=new JourneyController(api,id,()=>`key-number-${++key}`,()=>now);
  return{c,api,calls,messages,advance:(ms:number)=>{now+=ms;},replace:(next:Journey)=>{ride=next;}};
}
async function start(f:ReturnType<typeof journey>){f.c.activate();await settle();}

test('acceptance pins exact displayed offer/version and uses server time, even before a timer tick',async()=>{
  const f=journey();await start(f);await f.c.act('accept',f.c.snapshot().ride!);
  assert.deepEqual(f.calls[0].data,{expectedVersion:1,offerId:base.offer!.id});
  const g=journey();await start(g);g.advance(120000);await g.c.act('accept');assert.equal(g.calls.length,0);assert.match(g.c.snapshot().error,/no longer/);
  const h=journey();await start(h);const shown=h.c.snapshot().ride!;h.replace({...base,version:2,offer:{...base.offer!,id:'another-offer'}});await h.c.refresh();await h.c.act('accept',shown);assert.equal(h.calls.length,0);assert.match(h.c.snapshot().error,/changed/);
});

test('interrupted fare writes retain immutable consent and one key across refresh, navigation and retry',async()=>{
  const f=journey();await start(f);const pending=deferred<JourneyResult>();
  f.api.journeyCommand=async(_id,action,data,key)=>{f.calls.push({action,data,key});return pending.promise;};
  const first=f.c.act('accept');await f.c.act('cancel');f.c.edit('amount','99');assert.equal(f.calls.length,1);
  pending.reject(new Error('Network lost'));await first;assert.equal(f.c.snapshot().uncertain,true);
  f.c.pause();f.replace({...base,version:2,status:'agreed',allowedActions:['confirm','cancel']});f.c.activate();await settle();
  await f.c.act('cancel');assert.equal(f.calls.length,1);
  f.api.journeyCommand=async(_id,action,data,key)=>{f.calls.push({action,data,key});return{...env,ride:{...base,version:2,status:'agreed'}};};
  await f.c.retry();assert.deepEqual(f.calls[0],f.calls[1]);assert.equal(f.c.snapshot().uncertain,false);
});

test('stale rejections require a new review, while decimal fares retain exact kobo',async()=>{
  const f=journey();await start(f);f.c.edit('amount','1234.01');await f.c.act('propose');assert.deepEqual(f.calls[0].data,{expectedVersion:1,amountKobo:123401});await settle();
  f.api.journeyCommand=async()=>{throw Object.assign(new Error('Review again'),{status:409,code:'STALE_VERSION'});};
  await f.c.act('cancel');assert.equal(f.c.snapshot().stale,true);assert.equal(f.c.snapshot().uncertain,false);
  const count=f.calls.length;await f.c.act('accept');assert.equal(f.calls.length,count);
});

test('pickup and drop-off verification send the reviewed code, preserve retries and clear visible PIN after backgrounding',async()=>{
  const f=journey();f.replace({...base,mode:'work',status:'in_progress',canCancel:false,allowedActions:['complete'],vehicleCategory:'van',delivery:{description:'Test box',weightKg:1,recipientName:'Test recipient',pickupInstructions:'',dropoffInstructions:'',verifiedAt:null,pinBlockedUntil:null}});
  await start(f);f.c.edit('pin','123');await f.c.act('complete');assert.equal(f.calls.length,0);
  f.c.edit('pin','012345');await f.c.act('complete');assert.deepEqual(f.calls[0].data,{expectedVersion:1,deliveryPin:'012345'});
  f.c.edit('pin','999999');f.c.pause();assert.equal(f.c.snapshot().pin,'');
});

test('lost chat responses keep one message key and do not skip unread incoming messages on refresh',async()=>{
  const f=journey();await start(f);f.c.edit('draft','Original message');f.api.sendMessage=async(_id,body,key)=>{f.messages.push({body,key});throw new Error('Lost reply');};
  await f.c.send();f.c.edit('draft','Replacement');assert.equal(f.c.snapshot().draft,'Original message');
  f.api.sendMessage=async(_id,body,key)=>{f.messages.push({body,key});return{...env,message:{id,sequence:2,body,createdAt:env.serverNow,fromYou:true}};};
  let requested=-1;f.api.thread=async(_id,after=0)=>{requested=after;return{...chat,nextAfter:2,lastSequence:2,unread:1,messages:[{id,sequence:1,body:'Earlier incoming',fromYou:false,createdAt:env.serverNow},{id:'00000000-0000-4000-8000-000000000002',sequence:2,body:'Original message',fromYou:true,createdAt:env.serverNow}]};};
  await f.c.retry();await settle();assert.deepEqual(f.messages[0],f.messages[1]);assert.equal(requested,0);assert.equal(f.c.snapshot().messages[0].body,'Earlier incoming');
  let reads=0;f.api.readMessages=async()=>{reads++;return{...env,readThrough:2,unread:3};};await f.c.markRead();assert.equal(reads,1);assert.equal(f.c.snapshot().thread?.unread,3);f.c.pause();await f.c.markRead();assert.equal(reads,1);
});

test('late reads and pending writes cannot populate a disposed account or trigger follow-up requests',async()=>{
  const f=journey(),pending=deferred<JourneyResult>();f.api.journey=()=>pending.promise;f.c.activate();f.c.dispose();pending.resolve({...env,ride:base});await settle();assert.equal(f.c.snapshot().ride,null);
  const g=journey();await start(g);const write=deferred<JourneyResult>();g.api.journeyCommand=()=>write.promise;const promise=g.c.act('accept');g.c.dispose();write.resolve({...env,ride:{...base,version:8}});await promise;assert.equal(g.c.snapshot().ride?.version,1);
});
const lease:Availability={id,online:true,owned:true,mode:'sample',areaId:'wuse-ii',sequence:1,updatedAt:env.serverNow,expiresAt:env.serverNow+30000,reason:null};
function work(){
  let value:Work={...env,availability:null,settings:{allowSimulation:true,heartbeatSeconds:10,leaseSeconds:30,freshPositionSeconds:30},areas:[{id:'wuse-ii',name:'Wuse II'}],current:[],activeElsewhere:[],available:[]};
  const calls:Array<{kind:string;data:unknown;key?:string}>=[];
  const api:ConstructorParameters<typeof WorkController>[0]={work:async()=>structuredClone(value),online:async(_client,data,key)=>{calls.push({kind:'online',data,key});value={...value,availability:lease};return{...env,availability:lease};},
    offline:async(_client,id,key)=>{calls.push({kind:'offline',data:id,key});value={...value,availability:null};return{...env,availability:{...lease,online:false,owned:false,expiresAt:null,reason:'offline'}};},
    heartbeat:async(_client,id,sequence,position)=>{calls.push({kind:'heartbeat',data:{id,sequence,position}});return{...env,availability:{...lease,sequence}};},
    journeyCommand:async(_id,action,data,key)=>{calls.push({kind:action,data,key});return{...env,ride:{...base,mode:'work'}};}};
  const position:Position={lat:9.08,lng:7.4,accuracy:10,capturedAt:env.serverNow};
  const f={api,calls,position,value,set:(w:Partial<Work>)=>{value={...value,...w};}};
  return f;
}

test('backgrounding during online confirmation closes the lease, never resumes tracking or silently returns online',async()=>{
  const f=work(),c=new WorkController(f.api,()=>id,async()=>f.position);c.activate();await settle();
  const pending=deferred<AvailabilityResult>();f.api.online=async()=>pending.promise;const online=c.online('wuse-ii');await settle();c.pause();pending.resolve({...env,availability:lease});await online;
  assert.equal(f.calls.filter((v)=>v.kind==='offline').length,1);assert.equal(c.snapshot().availability?.online,false);
  c.activate();await settle();await c.heartbeat();assert.equal(f.calls.filter((v)=>v.kind==='heartbeat').length,0);
});

test('location results arriving after leaving the app cannot create an online lease',async()=>{
  const f=work(),location=deferred<Position>(),c=new WorkController(f.api,()=>id,()=>location.promise);c.activate();await settle();const online=c.online();c.pause();location.resolve(f.position);await online;assert.equal(f.calls.length,0);
});

test('uncertain job claim retains the original job and key across refresh and blocks a second job',async()=>{
  const f=work(),job={id,version:1,vehicleCategory:'standard' as const,pickup:'Wuse',destination:'Maitama',suggestedFareKobo:450000,expiresAt:env.serverNow+300000,approximateDistanceKm:null};f.set({available:[job],availability:lease});
  const c=new WorkController(f.api,()=>id,async()=>f.position);c.activate();await settle();
  f.api.journeyCommand=async(_id,action,data,key)=>{f.calls.push({kind:action,data,key});throw new Error('Lost confirmation');};await c.claim(job);assert.equal(c.snapshot().uncertain,true);
  f.set({available:[],availability:null});await c.refresh();await c.online('wuse-ii');assert.equal(f.calls.length,1);
  f.api.journeyCommand=async(_id,action,data,key)=>{f.calls.push({kind:action,data,key});return{...env,ride:{...base,mode:'work'}};};await c.retry();assert.deepEqual(f.calls[0],f.calls[1]);assert.equal(c.snapshot().journey?.id,id);
});

test('runtime contracts reject private code leakage, malformed chat, invalid categories and arbitrary notification titles',()=>{
  parseJourney({...env,ride:base});
  assert.throws(()=>parseJourney({...env,ride:{...base,mode:'work',pickupPin:'123456'}}));
  assert.throws(()=>parseJourney({...env,ride:{...base,vehicleCategory:'spaceship'}}));
  assert.throws(()=>parseThread({...chat,messages:[{id,sequence:2,body:'Future',fromYou:false,createdAt:0}]}));
  assert.throws(()=>parseWork({...work().value,available:[{id}]}));
  assert.throws(()=>parseNotifications({...env,unread:0,nextBefore:null,push:{enabled:false,projectId:null,registered:false},notifications:[{id:1,rideId:id,kind:'message',title:'PIN 123456',mode:'customer',createdAt:0,readAt:null}]}));
});

test('arrival inbox details accept older servers but only allow bounded rider arrival text and a current-state flag',()=>{
  const page={...env,unread:1,nextBefore:null,push:{enabled:false,projectId:null,registered:false}};
  const note={id:1,rideId:id,kind:'arrive',title:'Driver has arrived',mode:'customer',createdAt:0,readAt:null};
  parseNotifications({...page,notifications:[note]});
  parseNotifications({...page,notifications:[{...note,body:'Driver · plate TEST · Yellow Toyota Corolla',arrivalActive:true}]});
  for(const change of [{mode:'work'},{kind:'message',title:'New journey message'},{body:'x'.repeat(501)},{arrivalActive:'yes'}]) {
    assert.throws(()=>parseNotifications({...page,notifications:[{...note,body:'Arrival details',arrivalActive:true,...change}]}));
  }
});
