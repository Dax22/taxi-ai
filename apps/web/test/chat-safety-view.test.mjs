import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
let source = await readFile(new URL('../public/dashboard/conversation-view.mjs', import.meta.url), 'utf8');
for (const name of ['demo-booking','trip-lifecycle','chat-safety']) source = source.replaceAll(`'/shared/${name}.mjs'`, `'${new URL(`../../../packages/shared/src/${name}.mjs`,import.meta.url)}'`);
for (const name of ['dom','conversation-model']) source = source.replaceAll(`'./${name}.mjs'`, `'${new URL(`../public/dashboard/${name}.mjs`,import.meta.url)}'`);
const { createConversationView } = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
class Node {
  constructor(tag='div'){this.tag=tag;this.children=[];this.dataset={};this.handlers={};this.textContent='';this.value='';this.classList={add:()=>{}};this.scrollHeight=0;this.scrollTop=0;this.clientHeight=0;}
  append(...nodes){this.children.push(...nodes);}
  replaceChildren(...nodes){this.children=nodes;}
  addEventListener(event, fn){this.handlers[event]=fn;}
  querySelectorAll(tag){return this.children.flatMap(n=>[...(n.tag===tag?[n]:[]),...n.querySelectorAll(tag)]);}
  focus(){}
}
test('received hints keep text and manual reporting, cause no actions and clear on reset', t=>{
  const oldDocument=globalThis.document, oldWindow=globalThis.window, nodes=new Map(), calls=[];
  const get=id=>{if(!nodes.has(id))nodes.set(id,new Node());return nodes.get(id);};
  globalThis.document={getElementById:get,createElement:tag=>new Node(tag)};
  globalThis.window={addEventListener(){}};
  t.after(()=>{globalThis.document=oldDocument;globalThis.window=oldWindow;});
  const view=createConversationView({onSend:()=>calls.push('send'),onReport:data=>calls.push(data),onAccept:()=>calls.push('accept'),onRead:()=>calls.push('read'),serverNow:()=>1000});
  const body='Send your PIN before I arrive <img src=x onerror=alert(1)>';
  const context={user:{id:'c'},ride:{id:'r',version:1,status:'negotiating',customer:{id:'c',name:'Customer'},driver:{id:'d',name:'Driver'}},thread:{canSend:true,unread:1,reportedMessageIds:[]},messages:[{id:'m',sequence:1,createdAt:1000,senderId:'d',body}]};
  view.render(context);
  const entry=get('chat-feed').children[0];
  assert.ok(entry.children.some(n=>n.textContent===body));
  assert.ok(entry.children.some(n=>n.className==='chat-safety-hint'));
  assert.deepEqual(calls,[]);
  entry.querySelectorAll('button')[0].handlers.click();
  assert.deepEqual(calls,[],'opening the report form does not submit it');
  get('chat-report-reason').value='unsafe_request';
  get('chat-report-form').handlers.submit({preventDefault(){}});
  assert.equal(calls[0].messageId,'m');
  view.render({...context,ride:{...context.ride,version:2},messages:[{...context.messages[0],senderId:'c'}]});
  assert.equal(get('chat-feed').children[0].children.filter(n=>n.className==='chat-safety-hint').length,0);
  view.reset();assert.deepEqual(get('chat-feed').children,[]);
});
