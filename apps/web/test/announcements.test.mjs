import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

test('web account includes a safe announcement banner and serves its isolated controller',()=>{
  const html=readFileSync(new URL('../public/dashboard.html',import.meta.url),'utf8');
  const script=readFileSync(new URL('../public/dashboard/announcements.mjs',import.meta.url),'utf8');
  const server=readFileSync(new URL('../server.mjs',import.meta.url),'utf8');
  assert.match(html,/id="announcement-banner"/);assert.match(html,/id="announcement-dismiss"/);
  assert.match(script,/\/api\/announcements/);assert.match(script,/textContent/);assert.doesNotMatch(script,/innerHTML/);
  assert.match(script,/readAt===null/);assert.match(server,/\/dashboard\/announcements\.mjs/);
});
