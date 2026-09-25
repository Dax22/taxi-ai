import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { openDatabase } from '../src/infrastructure/database.mjs';
import { asAsyncDatabase } from '../src/infrastructure/async-database.mjs';
import { createFamilyRepository } from '../src/modules/family/repository.mjs';
import { createFamilyService } from '../src/modules/family/service.mjs';
import { familyRoutes } from '../src/modules/family/routes.mjs';

test('every family HTTP adapter rechecks the exact signed-in identity after awaited data or commands',async()=>{
  const owner={id:randomUUID()},other={id:randomUUID()},seen=[];
  const service={get:async()=>{seen.push('get');return {};},trip:async()=>{seen.push('trip');return {};},command:async()=>{seen.push('command');return {};}};
  const routes=familyRoutes(service);
  for(const route of routes) {
    const context={user:owner,match:['',randomUUID()],data:{},key:randomUUID(),query:new URLSearchParams(),reauthenticate:async()=>other};
    await assert.rejects(route.handle(context),error=>error.code==='UNAUTHENTICATED');
    context.reauthenticate=async()=>{throw new Error('Session revoked during request');};
    await assert.rejects(route.handle(context),/Session revoked during request/);
  }
  assert.deepEqual(seen,['get','get','trip','trip','command','command']);
  await assert.rejects(routes[0].handle({user:owner,query:new URLSearchParams('userId=another'),reauthenticate:async()=>owner}),error=>error.code==='INVALID_FIELDS');
});

test('family invitation maintenance expires at most 200 due invitations and preserves accepted contacts',async()=>{
  const raw=openDatabase(':memory:'),db=asAsyncDatabase(raw),owner=randomUUID(),now=1_000_000,touched=[];
  try {
    raw.prepare("INSERT INTO users(id,email,name,password_hash,role,created_at) VALUES (?,?,?,'test','customer',0)").run(owner,'owner@example.test','Owner');
    const add=raw.prepare('INSERT INTO family_contacts(id,owner_id,observer_id,invited_email,status,created_at,expires_at,updated_at) VALUES (?,?,NULL,?,?,0,?,0)');
    for(let i=0;i<205;i++) add.run(randomUUID(),owner,`person${i}@example.test`,'pending',now);
    const active=randomUUID(); add.run(active,owner,'active@example.test','active',now-1);
    const future=randomUUID(); add.run(future,owner,'future@example.test','pending',now+1);
    const service=createFamilyService({repository:createFamilyRepository(db),clock:()=>now,unitOfWork:run=>db.transaction(run),publish:async ids=>touched.push(...ids)});
    await service.sweep();
    assert.equal(raw.prepare("SELECT count(*) AS n FROM family_contacts WHERE status='expired'").get().n,200);
    assert.equal(raw.prepare("SELECT count(*) AS n FROM family_contacts WHERE status='pending'").get().n,6);
    assert.equal(raw.prepare('SELECT status FROM family_contacts WHERE id=?').get(active).status,'active');
    assert.equal(raw.prepare('SELECT status FROM family_contacts WHERE id=?').get(future).status,'pending');
    assert.deepEqual(touched,[owner]);
    await service.sweep();
    assert.equal(raw.prepare("SELECT count(*) AS n FROM family_contacts WHERE status='expired'").get().n,205);
    assert.equal(raw.prepare("SELECT count(*) AS n FROM family_contacts WHERE status='pending'").get().n,1);
  } finally { raw.close(); }
});
