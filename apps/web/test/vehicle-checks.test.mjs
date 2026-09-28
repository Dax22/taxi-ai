import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { setImmediate as settle } from 'node:timers/promises';
import { VEHICLE_PHOTO_CONSENT } from '../../../packages/shared/src/vehicle-checks.mjs';
const source=(await readFile(new URL('../public/dashboard/vehicle-checks.mjs',import.meta.url),'utf8')).replace(/from\s+'([^']+)'/g,(_,s)=>
  `from '${s.startsWith('/shared/')?new URL('../../../packages/shared/src/'+s.slice(8),import.meta.url):new URL('../public/dashboard/'+s,import.meta.url)}'`);
const {createVehiclePhotoCheck}=await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
const html=await readFile(new URL('../public/dashboard.html',import.meta.url),'utf8');
const rideId='00000000-0000-4000-8000-000000000001',checkId='00000000-0000-4000-8000-000000000002';
const user={id:'rider',role:'customer'},ride={id:rideId,status:'arrived',customer:user,driver:{id:'driver'}};
const checked={id:checkId,rideId,createdAt:1000,expiresAt:2000,current:true,outcome:'possible_mismatch',fields:[{key:'plate',expected:'ABC123',observed:'DEF456',status:'different'}],reasons:['plate_differs']};
function setup(t){const old=globalThis.document,nodes=new Map();
  class Element{constructor(){this.handlers={};this.children=[];this.value='';this.checked=false;this.dataset={};this.width=0;this.textContent='';}
    addEventListener(k,f){this.handlers[k]=f;}append(...children){this.children.push(...children);}replaceChildren(...children){this.children=children;}
    getContext(){return{drawImage(){}};}}
  for(const [,id]of html.matchAll(/\bid="([^"]+)"/g))nodes.set(id,new Element());
  const node=id=>{assert.ok(nodes.has(id),id);return nodes.get(id);};globalThis.document={getElementById:node,createElement:()=>new Element()};t.after(()=>{globalThis.document=old;});
  const calls=[],reports=[];let checks=[];
  const client={request:async(path,options)=>{if(options){calls.push({path,options});checks=[checked];return{check:checked};}
    return{rideId,enabled:true,canCheck:true,provider:'OpenAI',consentVersion:VEHICLE_PHOTO_CONSENT,checks};}};
  let readPhoto=async()=>({image:{mimeType:'image/jpeg',base64:'private-fixture'},preview:{width:640,height:480}});
  const view=createVehiclePhotoCheck({client,makeKey:()=>checkId,onReport:(...args)=>reports.push(args),readPhoto:(file)=>readPhoto(file)});
  view.reset();return{node,view,calls,reports,setReader:r=>{readPhoto=r;}};
}
test('web photo flow requires review and consent, shows a comparison, reports explicitly and clears private drafts',async(t)=>{
  const f=setup(t);f.view.context(user,ride);await settle();assert.equal(f.node('vehicle-check-panel').hidden,false);
  f.node('vehicle-check-file').files=[{name:'vehicle.jpg'}];await f.node('vehicle-check-file').handlers.change();
  assert.equal(f.node('vehicle-check-submit').disabled,true);assert.equal(f.calls.length,0);
  f.node('vehicle-check-consent').checked=true;f.node('vehicle-check-consent').handlers.change();assert.equal(f.node('vehicle-check-submit').disabled,false);
  f.node('vehicle-check-form').handlers.submit({preventDefault(){}});await settle();
  assert.equal(f.calls.length,1);assert.equal(f.calls[0].options.data.consentVersion,VEHICLE_PHOTO_CONSENT);
  assert.equal(f.node('vehicle-check-preview').hidden,true);assert.equal(f.node('vehicle-check-consent').checked,false);
  assert.equal(f.node('vehicle-check-result').children[0].textContent,'Possible different vehicle');assert.equal(f.reports.length,0);
  f.node('vehicle-check-report').onclick();assert.deepEqual(f.reports,[[rideId,checkId]]);
  f.view.context({id:'other',role:'customer'},ride);assert.equal(f.node('vehicle-check-panel').hidden,true);assert.equal(f.node('vehicle-check-result').children.length,0);
});
test('invalid photos explain the problem and a late file read cannot populate a different account',async(t)=>{
  const f=setup(t);f.view.context(user,ride);await settle();
  f.setReader(async()=>{throw new Error('Photo too large');});f.node('vehicle-check-file').files=[{}];await f.node('vehicle-check-file').handlers.change();assert.equal(f.node('vehicle-check-error').textContent,'Photo too large');
  let resolve;f.setReader(()=>new Promise(r=>{resolve=r;}));const choosing=f.node('vehicle-check-file').handlers.change();f.view.reset();
  resolve({image:{mimeType:'image/jpeg',base64:'secret'},preview:{width:640,height:480}});await choosing;
  assert.equal(f.node('vehicle-check-preview').hidden,true);assert.equal(f.calls.length,0);
});
