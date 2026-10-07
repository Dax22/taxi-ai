import { createApiClient } from './dashboard/api-client.mjs';

const client=createApiClient(), content=document.getElementById('notice-content');
const status=document.getElementById('notice-status'), error=document.getElementById('notice-error');
const button=document.getElementById('notice-refresh');
let generation=0,busy=false,identity=null,selected=null;
const node=(tag,text)=>{const value=document.createElement(tag);if(text!==undefined)value.textContent=text;return value;};
const link=(text,path)=>{const value=node('a',text);value.href=path;return value;};
const date=value=>value?new Date(value).toLocaleString('en-NG',{timeZone:'Africa/Lagos'})+' WAT':'Manual review';
const key=session=>session.user?session.user.id+':'+session.csrfToken:null;
function clear(){generation++;identity=null;selected=null;client.reset();content.replaceChildren();status.textContent='';error.textContent='';busy=false;button.disabled=false;}
async function load(){
 if(busy)return;busy=true;button.disabled=true;const epoch=++generation;
 content.replaceChildren();error.textContent='';status.textContent='Loading your notices…';
 try{
  const first=await client.request('/api/session');if(epoch!==generation)return;identity=key(first);
  if(!first.user){status.textContent='Sign in to view your notices.';content.append(link('Sign in','/app'));return;}
  client.setCsrf(first.csrfToken);const query=new URLSearchParams(location.search),id=query.get('id');
  if(id&&!/^[a-f0-9-]{36}$/.test(id))throw new Error('This notice reference is invalid.');
  const path=id?'/api/account/notices/'+id:'/api/account/notices'+(query.get('before')?'?before='+encodeURIComponent(query.get('before')):'');
  const result=await client.request(path),last=await client.request('/api/session');if(epoch!==generation)return;
  if(key(last)!==identity){clear();void load();return;}
  status.textContent='Signed in as '+last.user.name+'. Times shown in Nigeria time.';
  if(id){selected=result.restriction;renderDetail(result);}else renderList(result);
 }catch(cause){if(epoch===generation){content.replaceChildren();error.textContent=cause.message;status.textContent='Notices could not be loaded.';}}
 finally{if(epoch===generation){busy=false;button.disabled=false;}}
}
function card(r){const box=node('section');box.className='panel';box.append(node('h2',r.scope+' · '+r.kind),node('p',r.notice),node('p','Status: '+r.status+' · Review: '+date(r.reviewAt)+' · Expires: '+date(r.expiresAt)));return box;}
function renderList(data){
 if(!data.items.length)content.append(node('p','No account notices have been recorded.'));
 for(const r of data.items){const box=card(r);box.append(link('Open notice and appeal','/account-notices?id='+encodeURIComponent(r.id)));content.append(box);}
 if(data.nextBefore)content.append(link('Older notices','/account-notices?before='+encodeURIComponent(data.nextBefore)));
}
function renderDetail(data){
 const r=data.restriction,box=card(r);box.append(link('All notices','/account-notices'));content.append(box);
 if(data.appeal){const a=data.appeal,section=node('section');section.className='panel';section.append(node('h2','Your appeal'),node('p',a.body),node('p','Status: '+a.status),node('p',a.decisionNote||'Your appeal is awaiting review.'));content.append(section);return;}
 if(r.kind!=='suspension'||r.status!=='active')return;
 const form=node('form');form.className='action-form';
 const label=node('label','Explain your appeal'),input=node('textarea'),submit=node('button','Submit appeal');
 input.required=true;input.minLength=10;input.maxLength=2000;input.id='appeal-body';label.htmlFor=input.id;
 submit.type='submit';submit.className='button primary';form.append(label,input,submit);content.append(form);
 form.addEventListener('submit',event=>sendAppeal(event,r,input,submit));
}
async function sendAppeal(event,r,input,submit){
 event.preventDefault();if(busy||selected?.id!==r.id)return;busy=true;submit.disabled=true;
 const epoch=generation,expected=identity;error.textContent='';
 try{
  const session=await client.request('/api/session');if(epoch!==generation)return;
  if(key(session)!==expected){clear();void load();return;}
  client.setCsrf(session.csrfToken);
  await client.command('/api/account/notices/'+r.id+'/appeal',{body:input.value});
  if(epoch!==generation)return;status.textContent='Your appeal was saved.';busy=false;await load();
 }catch(cause){if(epoch===generation)error.textContent=cause.message;}
 finally{if(epoch===generation){busy=false;submit.disabled=false;}}
}
button.addEventListener('click',load);
document.addEventListener('visibilitychange',()=>{if(document.hidden)clear();else void load();});
window.addEventListener('pagehide',clear);
window.addEventListener('pageshow',event=>{if(event.persisted)void load();});
void load();
