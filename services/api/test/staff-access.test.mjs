import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { openDatabase } from '../src/infrastructure/database.mjs';
import { asAsyncDatabase } from '../src/infrastructure/async-database.mjs';
import { createAudit } from '../src/infrastructure/audit.mjs';
import { tokens } from '../src/infrastructure/tokens.mjs';
import { createStaffFactor, totpCode } from '../src/infrastructure/staff-factor.mjs';
import { createStaffAccessRepository } from '../src/modules/staff-access/repository.mjs';
import { createStaffAccessService } from '../src/modules/staff-access/service.mjs';

const KEY='12'.repeat(32), PASSWORD='staff fixture password only';
async function fixture(t,{required=false,key=KEY}={}) {
  const raw=openDatabase(':memory:'),db=asAsyncDatabase(raw),repository=createStaffAccessRepository(db);t.after(()=>db.close());
  let now=1_750_000_000_000;
  const owner={id:randomUUID(),email:'owner@example.test',name:'Owner',role:'admin'},support={id:randomUUID(),email:'support@example.test',name:'Support',role:'customer'};
  for(const account of [owner,support])raw.prepare('INSERT INTO users(id,email,name,role,password_hash,created_at) VALUES (?,?,?,?,?,?)').run(account.id,account.email,account.name,account.role,'fixture',now);
  async function getAccount(id){return await db.prepare('SELECT id,email,name,role FROM users WHERE id=?').get(id)??null;}
  const factor=createStaffFactor({key,required}),service=createStaffAccessService({repository,getAccount,getAccountByEmail:async(email)=>await db.prepare('SELECT id,email,name,role FROM users WHERE email=?').get(email)??null,
    verifyPassword:async(_id,password)=>password===PASSWORD,
    sessionOwner:async(token)=>(await db.prepare('SELECT user_id FROM sessions WHERE token_hash=? AND expires_at>?').get(tokens.digest(token),now))?.user_id??null,
    revokeSessions:async(id)=>await db.prepare('DELETE FROM sessions WHERE user_id=?').run(id),tokens,unitOfWork:(run)=>db.transaction(run),audit:createAudit(db),clock:()=>now,factor});
  async function session(userId){const token=tokens.generate();await db.prepare('INSERT INTO sessions(token_hash,user_id,csrf_token,expires_at) VALUES (?,?,?,?)').run(tokens.digest(token),userId,tokens.generate(),now+12*60*60_000);return token;}
  const command=(action,data,key=randomUUID(),userId=owner.id)=>service.command({userId,action,data,key});
  return {raw,db,repository,service,factor,owner,support,command,session,get now(){return now;},advance(ms){now+=ms;}};
}

test('TOTP matches RFC 6238 SHA-1 vectors including post-2038 time',()=>{
  const secret='GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';
  for(const [seconds,code] of [[59,'94287082'],[1111111109,'07081804'],[1111111111,'14050471'],[1234567890,'89005924'],[2000000000,'69279037'],[20000000000,'65353130']]) {
    assert.equal(totpCode(secret,seconds*1000,8),code);
  }
});
test('factor encryption binds account, detects tampering, and requires persistent configured key',()=>{
  const factor=createStaffFactor({key:KEY}),setup=factor.create('owner','owner@example.test'),now=1_750_000_000_000,code=totpCode(setup.secret,now);
  assert.equal(setup.secret.length,32);assert.equal(setup.secretEncrypted.includes(setup.secret),false);
  assert.equal(factor.verify('owner',setup.secretEncrypted,code,now),Math.floor(now/30_000));
  assert.equal(factor.verify('owner',setup.secretEncrypted,code,now,Math.floor(now/30_000)),null);
  assert.throws(()=>factor.verify('another',setup.secretEncrypted,code,now),{code:'MFA_UNAVAILABLE'});
  const parts=setup.secretEncrypted.split('.');parts[3]=(parts[3][0]==='A'?'B':'A')+parts[3].slice(1);
  assert.throws(()=>factor.verify('owner',parts.join('.'),code,now),{code:'MFA_UNAVAILABLE'});
  assert.throws(()=>createStaffFactor({required:true}),{code:'INVALID_STAFF_MFA_KEY'});
});
test('staff permissions separate customer capability, fresh revocation and idempotent versioned mutations',async(t)=>{
  const f=await fixture(t);await assert.rejects(f.service.requirePermission(f.support.id,'cases.support'),{code:'FORBIDDEN'});
  const key=randomUUID(),data={email:f.support.email,role:'support',expectedVersion:0,reason:'Pilot support staffing'};
  const assigned=await f.command('assign',data,key);assert.equal(assigned.replayed,false);
  assert.equal((await f.service.describe(f.support.id)).role,'support');
  assert.equal(f.raw.prepare('SELECT role FROM users WHERE id=?').get(f.support.id).role,'customer');
  await f.service.requirePermission(f.support.id,'cases.support');
  for(const permission of ['staff.manage','legacy.review','cases.safety','analytics.read'])await assert.rejects(f.service.requirePermission(f.support.id,permission),{code:'FORBIDDEN'});
  assert.equal((await f.command('assign',data,key)).replayed,true);
  await assert.rejects(f.command('assign',{...data,role:'safety'},key),{code:'KEY_REUSED'});
  await assert.rejects(f.command('assign',{...data,role:'safety'}),{code:'STALE_VERSION'});
  await assert.rejects(f.command('assign',{...data,role:'owner',expectedVersion:1}),{code:'OWNER_BOOTSTRAP_REQUIRED'});
  const token=await f.session(f.support.id);
  await f.command('revoke',{userId:f.support.id,expectedVersion:1,reason:'End pilot shift'});
  await assert.rejects(f.service.describe(f.support.id),{code:'FORBIDDEN'});
  assert.equal(f.raw.prepare('SELECT 1 FROM sessions WHERE token_hash=?').get(tokens.digest(token)),undefined);
  assert.equal((await f.command('assign',data,key)).replayed,true); // old success replay cannot regrant
  await assert.rejects(f.service.requirePermission(f.support.id,'cases.support'),{code:'FORBIDDEN'});
  assert.deepEqual(await f.service.listEligible('cases.support'),[{id:f.owner.id,name:'Owner'}]);
});
test('last owner cannot be revoked/demoted and explicit revoked membership overrides legacy role',async(t)=>{
  const f=await fixture(t);
  await assert.rejects(f.command('revoke',{userId:f.owner.id,expectedVersion:1,reason:'Remove owner'}),{code:'LAST_OWNER'});
  await assert.rejects(f.command('assign',{email:f.owner.email,role:'support',expectedVersion:1,reason:'Demote owner'}),{code:'LAST_OWNER'});
  await f.repository.ensureLegacyOwner(f.owner.id,f.now);
  await f.db.prepare("UPDATE staff_memberships SET status='revoked',version=2 WHERE user_id=?").run(f.owner.id);
  await assert.rejects(f.service.requirePermission(f.owner.id,'legacy.review'),{code:'FORBIDDEN'});
});
test('staff audit includes existing case/read events with literal bounded search and no credential material',async(t)=>{
  const f=await fixture(t);await f.command('assign',{email:f.support.email,role:'support',expectedVersion:0,reason:'Pilot support 100% approved'});
  await createAudit(f.db).record(f.support.id,'admin.case_opened','case-id',f.now);
  const all=await f.service.auditLog(f.owner.id,{});assert.equal(all.items.length,2);
  assert.equal(all.items.some((item)=>item.action==='admin.case_opened'),true);
  const search=await f.service.auditLog(f.owner.id,{q:'100%'});assert.equal(search.items.length,1);assert.equal(search.items[0].detail.reason,'Pilot support 100% approved');
  const first=await f.service.auditLog(f.owner.id,{limit:'1'}),second=await f.service.auditLog(f.owner.id,{limit:'1',before:String(first.nextBefore)});
  assert.notEqual(first.items[0].id,second.items[0].id);
  assert.equal(JSON.stringify(all).includes('fixture password'),false);
  await assert.rejects(f.service.auditLog(f.support.id,{}),{code:'FORBIDDEN'});
});
test('MFA enrollment requires password, same live browser session and fresh single-use codes',async(t)=>{
  const f=await fixture(t,{required:true}),sessionToken=await f.session(f.owner.id),other=await f.session(f.owner.id);
  assert.equal((await f.service.describe(f.owner.id,{sessionToken})).mfa.needsVerification,true);
  await assert.rejects(f.service.authorize(f.owner.id,'staff.manage',{sessionToken}),{code:'MFA_SETUP_REQUIRED'});
  await assert.rejects(f.service.enroll({userId:f.owner.id,sessionToken,data:{password:'wrong password length'}}),{code:'INVALID_CREDENTIALS'});
  const setup=(await f.service.enroll({userId:f.owner.id,sessionToken,data:{password:PASSWORD}})).setup;
  assert.equal(JSON.stringify(await f.service.describe(f.owner.id,{sessionToken})).includes(setup.secret),false);
  await assert.rejects(f.service.confirm({userId:f.owner.id,sessionToken:other,data:{code:totpCode(setup.secret,f.now)}}),{code:'MFA_SETUP_EXPIRED'});
  await f.service.confirm({userId:f.owner.id,sessionToken,data:{code:totpCode(setup.secret,f.now)}});
  await f.service.authorize(f.owner.id,'staff.manage',{sessionToken});
  await assert.rejects(f.service.authorize(f.owner.id,'staff.manage',{sessionToken:other}),{code:'MFA_REQUIRED'});
  await assert.rejects(f.service.verify({userId:f.owner.id,sessionToken:other,data:{code:totpCode(setup.secret,f.now)}}),{code:'INVALID_MFA_CODE'});
  f.advance(30_000);await f.service.verify({userId:f.owner.id,sessionToken:other,data:{code:totpCode(setup.secret,f.now)}});
  await f.service.authorize(f.owner.id,'staff.manage',{sessionToken:other});
  f.advance(15*60_000);await assert.rejects(f.service.authorize(f.owner.id,'staff.manage',{sessionToken:other}),{code:'MFA_REQUIRED'});
  assert.equal(f.raw.prepare('SELECT secret_encrypted FROM staff_mfa WHERE user_id=?').get(f.owner.id).secret_encrypted.includes(setup.secret),false);
  const audit=await f.service.auditLog(f.owner.id,{});assert.equal(JSON.stringify(audit).includes(setup.secret),false);assert.equal(JSON.stringify(audit).includes(PASSWORD),false);
});
test('optional deployment still gates enrolled staff and removed encryption key fails closed',async(t)=>{
  const f=await fixture(t),sessionToken=await f.session(f.owner.id);
  const setup=(await f.service.enroll({userId:f.owner.id,sessionToken,data:{password:PASSWORD}})).setup;
  await f.service.confirm({userId:f.owner.id,sessionToken,data:{code:totpCode(setup.secret,f.now)}});f.advance(16*60_000);
  await assert.rejects(f.service.authorize(f.owner.id,'staff.manage',{sessionToken}),{code:'MFA_REQUIRED'});
  const noKey=await fixture(t,{key:''});await noKey.db.prepare('INSERT INTO staff_mfa(user_id,secret_encrypted,enabled_at,last_counter,version) VALUES (?,?,?,?,1)').run(noKey.owner.id,'sealed-old',noKey.now,0);
  await assert.rejects(noKey.service.authorize(noKey.owner.id,'staff.manage',{sessionToken:await noKey.session(noKey.owner.id)}),{code:'MFA_UNAVAILABLE'});
});

test('withSession rejects revoked or cross-account sessions before invoking a write callback',async(t)=>{
  const f=await fixture(t),sessionToken=await f.session(f.owner.id);let entered=false;
  await f.db.prepare('DELETE FROM sessions WHERE token_hash=?').run(tokens.digest(sessionToken));
  await assert.rejects(f.service.withSession(f.owner.id,sessionToken,async()=>{entered=true;}),{code:'UNAUTHENTICATED'});
  assert.equal(entered,false);
  const other=await f.session(f.support.id);
  await assert.rejects(f.service.withSession(f.owner.id,other,async()=>{entered=true;}),{code:'UNAUTHENTICATED'});
  assert.equal(entered,false);
  const fresh=await f.session(f.owner.id);
  await f.repository.ensureLegacyOwner(f.owner.id,f.now);
  await f.db.prepare("UPDATE staff_memberships SET status='revoked' WHERE user_id=?").run(f.owner.id);
  await assert.rejects(f.service.withSession(f.owner.id,fresh,async()=>{entered=true;}),{code:'FORBIDDEN'});
  assert.equal(entered,false);
});
test('own session revocation is explicit and leaves the current session intact',async(t)=>{
  const f=await fixture(t),sessionToken=await f.session(f.owner.id);
  await assert.rejects(f.command('revoke-sessions',{userId:f.owner.id,expectedVersion:1,reason:'End all owner sessions'}),{code:'FORBIDDEN'});
  assert.ok(f.raw.prepare('SELECT 1 FROM sessions WHERE token_hash=?').get(tokens.digest(sessionToken)));
});
