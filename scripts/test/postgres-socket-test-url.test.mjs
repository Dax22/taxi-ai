import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:net';
import { once } from 'node:events';
import { randomUUID } from 'node:crypto';
import { mkdirSync, chmodSync, rmSync } from 'node:fs';
import { homedir, userInfo } from 'node:os';
import { join } from 'node:path';
import { validatePrivatePostgresTestUrl } from '../postgres-socket-test-url.mjs';

test('private PostgreSQL test transport rejects production names, TCP fallback and shared socket paths',async t=>{
 const base=join(homedir(),`taxi-ai-pg-acceptance-${randomUUID()}`),socket=join(base,'socket');
 mkdirSync(base,{mode:0o700});mkdirSync(socket,{mode:0o700});
 const server=createServer();server.listen(join(socket,'.s.PGSQL.55439'));await once(server,'listening');
 t.after(async()=>{await new Promise(resolve=>server.close(resolve));rmSync(base,{recursive:true,force:true});});
 const url=`postgresql://${userInfo().username}@localhost:55439/taxi_ai_test?host=${socket}`;
 assert.equal(validatePrivatePostgresTestUrl(url),url);
 for(const candidate of [url.replace('/taxi_ai_test?','/taxi_ai_production?'),url.split('?')[0],url+'&sslmode=disable',url+'&host=/tmp',url.replace(socket,'/tmp'),url.replace('localhost','127.0.0.1')])
  assert.throws(()=>validatePrivatePostgresTestUrl(candidate));
 chmodSync(socket,0o755);assert.throws(()=>validatePrivatePostgresTestUrl(url));chmodSync(socket,0o700);
});
