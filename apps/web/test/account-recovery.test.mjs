import test from 'node:test';
import assert from 'node:assert/strict';
import { consumeEmailAction, createAccountRecovery } from '../public/dashboard/account-recovery-controller.mjs';

function fixture(initial, request) {
  const seen={mode:'',error:'',busy:false,success:'',clears:0}, calls=[];
  const view={mode:v=>{seen.mode=v;},error:v=>{seen.error=v;},busy:v=>{seen.busy=v;},success:v=>{seen.success=v;},clear:()=>{seen.clears++;}};
  const client={reset(){},request:async(path,options)=>{calls.push({path,options}); return request?.(path,options) ?? {enabled:true};}};
  return {seen,calls,controller:createAccountRecovery({client,view,initial})};
}
test('email link parsing strips URL fragments and never accepts tokens from query parameters or malformed links', () => {
  let next;
  const history={replaceState:(_a,_b,value)=>{next=value;}};
  const token='a'.repeat(64);
  assert.deepEqual(consumeEmailAction({href:`https://taxi.example.test/account-recovery#reset=${token}`},history),{mode:'reset',token});
  assert.equal(next,'/account-recovery');
  assert.equal(consumeEmailAction({href:`https://taxi.example.test/account-recovery?token=${token}`},history).token,null);
  for(const hash of ['#verify=bad',`#reset=${token}&email=someone`,`#admin=${token}`]) assert.equal(consumeEmailAction({href:'https://taxi.example.test/account-recovery'+hash},history).mode,'invalid');
});
test('opening an email link performs no verification, reset or token check until explicit submission', async () => {
  const initial={mode:'verify',token:'a'.repeat(64)}, f=fixture(initial,()=>({verified:true}));
  assert.equal(initial.token,null); await f.controller.load(); assert.equal(f.calls.length,0);
  await f.controller.submit(); assert.equal(f.calls.length,1); assert.equal(f.calls[0].path,'/api/auth/email/verify');
  assert.equal(f.calls[0].options.data.token,'a'.repeat(64)); assert.equal(f.seen.success,'verify');
  await f.controller.submit(); assert.equal(f.calls.length,1);
});
test('password confirmation and duplicate submissions cannot create multiple reset requests', async () => {
  let finish; const f=fixture({mode:'reset',token:'b'.repeat(64)},()=>new Promise(resolve=>{finish=resolve;}));
  await f.controller.load(); await f.controller.submit({password:'one',confirmation:'two'}); assert.equal(f.calls.length,0); assert.match(f.seen.error,/do not match/);
  const data={password:'A new fixture password',confirmation:'A new fixture password'}, pending=f.controller.submit(data);
  await f.controller.submit(data); assert.equal(f.calls.length,1); assert.equal(f.seen.busy,true);
  finish({reset:true}); await pending; assert.equal(f.seen.success,'reset'); assert.equal(f.seen.busy,false);
});
test('page exit discards tokens and ignores late responses; expired links cannot be retried', async () => {
  let finish; const f=fixture({mode:'reset',token:'c'.repeat(64)},()=>new Promise(resolve=>{finish=resolve;}));
  const pending=f.controller.submit({password:'fixture password',confirmation:'fixture password'});
  f.controller.clear(); finish({reset:true}); await pending; assert.equal(f.seen.success,''); assert.equal(f.seen.mode,'invalid');
  await f.controller.submit({password:'fixture password',confirmation:'fixture password'}); assert.equal(f.calls.length,1);
  const g=fixture({mode:'verify',token:'d'.repeat(64)},()=>{throw Object.assign(new Error('Expired link'),{code:'INVALID_EMAIL_LINK'});});
  await g.controller.submit(); await g.controller.submit(); assert.equal(g.calls.length,1); assert.equal(g.seen.mode,'invalid');
});
test('disabled delivery blocks requests and an enabled request confirms acceptance without revealing account existence', async () => {
  const f=fixture({mode:'request',token:null},()=>({enabled:false})); await f.controller.load(); await f.controller.submit({email:'fixture@example.test'});
  assert.equal(f.calls.length,1); assert.equal(f.seen.busy,true); assert.match(f.seen.error,/not available/);
  const g=fixture({mode:'request',token:null}); await g.controller.load(); await g.controller.submit({email:'missing@example.test'});
  assert.equal(g.calls[1].path,'/api/auth/password/request'); assert.deepEqual(g.calls[1].options.data,{email:'missing@example.test'}); assert.equal(g.seen.success,'request');
});
