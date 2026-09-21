import test from 'node:test';
import assert from 'node:assert/strict';
import { setImmediate as settle } from 'node:timers/promises';
import { SafetyController } from '../src/safety/controller.ts';
import { readSafety, readSafetyResult, readContacts } from '../src/safety/contracts.ts';
import type { SafetyTrip, SafetyResult } from '../src/safety/contracts.ts';
const id='00000000-0000-4000-8000-000000000001', env={apiVersion:1,serverNow:1000};
const base:SafetyTrip={rideId:id,canRaise:true,share:null,location:null,incidents:[],serverNow:1000};
function fixture(){let key=0;const calls:Array<{path:string;data:Record<string,unknown>;key:string}>=[];
 const api:ConstructorParameters<typeof SafetyController>[0]={safetyContacts:async()=>[],safetyTrip:async()=>structuredClone(base),safetyCommand:async(path,data,key)=>{calls.push({path,data:structuredClone(data),key});return{serverNow:1000,replayed:false};}};
 return{api,calls,c:new SafetyController(api,id,()=>`key-${++key}`)};
}
async function start(f:ReturnType<typeof fixture>){f.c.activate();await settle();}
test('uncertain safety mutations retain original key and payload through navigation, without auto retry',async()=>{
 const f=fixture();await start(f);f.api.safetyCommand=async(path,data,key)=>{f.calls.push({path,data:structuredClone(data),key});if(f.calls.length===1)throw new Error('lost response');return{serverNow:1000,replayed:true};};
 const data={kind:'need_help',note:'original',contactIds:[]};await f.c.command(`rides/${id}/incidents`,data);data.note='changed';
 assert.equal(f.c.snapshot().uncertain,true);f.c.pause();f.c.activate();await settle();assert.equal(f.calls.length,1);
 await f.c.command('contacts',{name:'Another',phone:'+2348000000001'});assert.equal(f.calls.length,1);
 await f.c.retry();assert.deepEqual(f.calls[1],f.calls[0]);assert.equal(f.c.snapshot().uncertain,false);
});
test('a late read or mutation cannot restore private data after disposal',async()=>{
 const f=fixture();await start(f);let resolve!:(v:SafetyResult)=>void;f.api.safetyCommand=()=>new Promise(r=>{resolve=r;});
 const pending=f.c.command(`rides/${id}/links`,{minutes:15,expectedShareId:null});f.c.dispose();resolve({serverNow:1000,replayed:false,token:'a'.repeat(64),share:{id,active:true,version:0,expiresAt:50000}});await pending;
 assert.equal(f.c.snapshot().token,null);assert.deepEqual(f.c.snapshot().contacts,[]);assert.equal(f.c.snapshot().trip,null);
});
test('share replay offers explicit replacement, and backgrounding clears a private URL',async()=>{
 const f=fixture();await start(f);const share={id,active:true,version:0,expiresAt:50000};f.api.safetyTrip=async()=>({...base,share});
 f.api.safetyCommand=async()=>({serverNow:1000,replayed:false,share,token:'a'.repeat(64)});
 await f.c.command(`rides/${id}/links`,{minutes:15,expectedShareId:null});assert.equal(f.c.snapshot().token,'a'.repeat(64));f.c.pause();assert.equal(f.c.snapshot().token,null);
 f.c.activate();await settle();f.api.safetyCommand=async()=>({serverNow:1000,replayed:true,share,token:null});await f.c.command(`rides/${id}/links`,{minutes:15,expectedShareId:id});assert.equal(f.c.snapshot().token,null);assert.match(f.c.snapshot().notice,/explicitly replace/);
});
test('wire readers reject malformed private links, contacts, coordinates and claimed real notifications',()=>{
 assert.equal(readSafety({...env,...base}).rideId,id);
 assert.throws(()=>readSafety({...env,...base,location:{lat:999,lng:0,stale:false,capturedAt:1000}}));
 assert.throws(()=>readSafetyResult({...env,replayed:false,token:'https://attacker.test'}));
 assert.throws(()=>readContacts({...env,contacts:[{id,name:'A',phone:'+2348000000001',version:0,verified:true}]}));
 assert.throws(()=>readSafety({...env,...base,incidents:[{id,kind:'need_help',status:'open',note:'',createdAt:0,updatedAt:0,notifications:[{id,recipientName:'Contact',status:'delivered',mode:'real'}]}]}));
});
test('replacement during create cannot pair the old secret with the new link',async()=>{
 const f=fixture();await start(f);f.api.safetyCommand=async()=>({serverNow:1000,replayed:false,share:{id,active:true,version:0,expiresAt:50000},token:'a'.repeat(64)});
 f.api.safetyTrip=async()=>({...base,share:{id:'00000000-0000-4000-8000-000000000002',active:true,version:0,expiresAt:50000}});
 await f.c.command(`rides/${id}/links`,{minutes:15,expectedShareId:null});assert.equal(f.c.snapshot().token,null);
});
test('successful but incomplete mutation responses are not accepted as saved',()=>{
 for(const path of ['contacts',`contacts/${id}/edit`,`rides/${id}/incidents`,`rides/${id}/links`,`links/${id}/revoke`])assert.throws(()=>readSafetyResult({...env,replayed:false},path));
 assert.equal(readSafetyResult({...env,replayed:false,contact:null},`contacts/${id}/remove`).contact,null);
});
