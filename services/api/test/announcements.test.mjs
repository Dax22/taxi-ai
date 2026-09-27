import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { harness, participants } from './helpers.mjs';
import { createPushProvider } from '../src/infrastructure/push-provider.mjs';

const base='/api/admin/console/announcements';
const must=(result,status=200)=>{assert.equal(result.status,status,JSON.stringify(result.body));return result.body;};
async function draft(admin,data={},key=randomUUID()){
  const result=must(await admin.post(base,{title:'Service update',body:'Taxi Ai has an important service update for this test.',audience:'all',priority:'important',expiresInHours:'24',...data},key));
  return {result,key};
}
async function version(admin,id){return must(await admin.send(base)).items.find(item=>item.id===id);}

test('staff broadcasts are draft-first, private to staff until publish, readable by users and cancellable',async t=>{
  const h=await harness(t),{admin,customer,driver}=await participants(h);
  assert.equal((await customer.send(base)).status,403);
  const {result,key}=await draft(admin);assert.ok(result.id);assert.equal(result.replayed,false);
  assert.equal(must(await admin.post(base,{title:'Service update',body:'Taxi Ai has an important service update for this test.',audience:'all',priority:'important',expiresInHours:'24'},key)).replayed,true);
  assert.equal(must(await customer.send('/api/announcements')).items.length,0);
  const saved=await version(admin,result.id);assert.equal(saved.status,'draft');assert.equal(saved.version,1);
  must(await admin.post(`${base}/${result.id}/publish`,{expectedVersion:1,reason:'Fictional release approval for integration testing.'}));
  for(const actor of [customer,driver]){
    const feed=must(await actor.send('/api/announcements'));assert.equal(feed.items.length,1);assert.equal(feed.items[0].id,result.id);
    assert.equal(feed.items[0].priority,'important');assert.equal(feed.items[0].readAt,null);
  }
  must(await customer.post(`/api/announcements/${result.id}/read`,{}));
  const read=must(await customer.send('/api/announcements')).items[0];assert.ok(Number.isSafeInteger(read.readAt));
  const published=await version(admin,result.id);assert.equal(published.version,2);assert.equal(published.status,'published');
  must(await admin.post(`${base}/${result.id}/cancel`,{expectedVersion:2,reason:'Fictional cancellation after the test notice was reviewed.'}));
  assert.equal(must(await customer.send('/api/announcements')).items.length,0);
  assert.equal((await version(admin,result.id)).status,'cancelled');
  const events=h.db.prepare("SELECT kind FROM audit_events WHERE subject_id=? ORDER BY id").all(result.id).map(row=>row.kind);
  assert.deepEqual(events,['admin.announcement_created','admin.announcement_published','admin.announcement_cancelled']);
});

test('audience targeting excludes driver-capable accounts from customer-only broadcasts and rejects changed idempotent retries',async t=>{
  const h=await harness(t),{admin,customer,driver}=await participants(h);
  const key=randomUUID(),created=await draft(admin,{audience:'customers',priority:'normal'},key);
  const id=created.result.id;
  const reused=await admin.post(base,{title:'Changed title',body:'A different body cannot reuse the same command key.',audience:'customers',priority:'normal',expiresInHours:'24'},key);
  assert.equal(reused.status,409);assert.equal(reused.body.error.code,'KEY_REUSED');
  must(await admin.post(`${base}/${id}/publish`,{expectedVersion:1,reason:'Publish to customer-only fixture accounts.'}));
  assert.equal(must(await customer.send('/api/announcements')).items.some(item=>item.id===id),true);
  assert.equal(must(await driver.send('/api/announcements')).items.some(item=>item.id===id),false);
  assert.equal(h.db.prepare('SELECT count(*) AS n FROM announcement_push_jobs WHERE announcement_id=?').get(id).n,0);
});

test('announcement input is bounded and expired or stale broadcasts cannot be published',async t=>{
  const h=await harness(t),{admin}=await participants(h);
  for(const data of [
    {title:'x',body:'Valid body',audience:'all',priority:'normal'},
    {title:'Valid title',body:'x'.repeat(501),audience:'all',priority:'normal'},
    {title:'Valid title',body:'Valid body',audience:'everyone',priority:'normal'},
    {title:'Valid title',body:'Valid body',audience:'all',priority:'emergency'},
  ]) assert.equal((await admin.post(base,data)).status,400);
  const {result}=await draft(admin,{expiresInHours:'1'});h.advance(60*60_000);
  assert.equal((await admin.post(`${base}/${result.id}/publish`,{expectedVersion:1,reason:'This fixture is intentionally expired.'})).status,409);
});

test('Expo broadcast payload contains only bounded announcement content and an opaque announcement ID',async()=>{
  const requests=[],projectId='00000000-0000-4000-8000-000000000001',token='ExpoPushToken[announcement_fixture_token]';
  const provider=createPushProvider({env:{TAXI_AI_PUSH_ENABLED:'true',TAXI_AI_EXPO_PROJECT_ID:projectId},fetchImpl:async(_url,options)=>{
    requests.push(JSON.parse(options.body));return Response.json({data:{status:'ok',id:'announcement-ticket'}});
  }});
  const id='00000000-0000-4000-8000-000000000099';
  assert.deepEqual(await provider.send({token,announcementId:id,announcementTitle:'Maintenance',announcementBody:'Service resumes shortly.',announcementPriority:'critical'}),{status:'ticket',ticket:'announcement-ticket'});
  assert.deepEqual(requests[0].data,{kind:'announcement',announcementId:id});assert.equal(requests[0].channelId,'announcements');
  assert.equal(requests[0].ttl,86400);assert.equal(requests[0].title,'Taxi Ai · Maintenance');assert.equal(requests[0].body,'Service resumes shortly.');
});
