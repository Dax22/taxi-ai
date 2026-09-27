import test from 'node:test';
import assert from 'node:assert/strict';
import { parseNotifications } from '../../../packages/shared/src/mobile-journeys.mjs';
import { pushTarget } from '../src/notifications/push-target.ts';

const id='00000000-0000-4000-8000-000000000099';
const env={apiVersion:1,serverNow:1_000_000};
const announcement={id,title:'Service update',body:'Taxi Ai service information.',audience:'all',priority:'important',status:'published',version:2,
  createdAt:900_000,publishedAt:910_000,expiresAt:2_000_000,readAt:null};
const response={...env,notifications:[],announcements:[announcement],unread:1,nextBefore:null,push:{enabled:false,projectId:null,registered:false}};

test('mobile Updates contract accepts bounded announcements and rejects unsafe shapes',()=>{
  assert.equal(parseNotifications(structuredClone(response)).announcements[0].id,id);
  for(const changed of [
    {...announcement,id:'bad'},
    {...announcement,body:'x'.repeat(501)},
    {...announcement,audience:'admins'},
    {...announcement,priority:'emergency'},
    {...announcement,status:'draft'},
    {...announcement,expiresAt:900_000},
  ]) assert.throws(()=>parseNotifications({...response,announcements:[changed]}));
});

test('announcement push payloads select only an opaque review target',()=>{
  assert.deepEqual(pushTarget({kind:'announcement',announcementId:id}),{kind:'announcement',announcementId:id});
  assert.equal(pushTarget({kind:'announcement',announcementId:'bad'}),null);
  const target=pushTarget({kind:'announcement',announcementId:id,title:'untrusted'});
  assert.equal(target?.kind,'announcement');
  if(target?.kind==='announcement')assert.equal(target.announcementId,id);
});
