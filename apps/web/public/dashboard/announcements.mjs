export function createAnnouncementsPanel({ client, root, title, body, meta, dismiss }) {
  let identity=null,generation=0,busy=false;
  const priorityLabel={normal:'Announcement',important:'Important announcement',critical:'Critical service notice'};
  function hide(){root.hidden=true;root.dataset.priority='';title.textContent='';body.textContent='';meta.textContent='';dismiss.disabled=false;}
  function render(items){
    const item=items.find((value)=>value.readAt===null);
    if(!item){hide();return;}
    root.dataset.priority=item.priority;title.textContent=item.title;body.textContent=item.body;
    meta.textContent=`${priorityLabel[item.priority]??'Announcement'} · visible until ${new Date(item.expiresAt).toLocaleString()}`;
    dismiss.dataset.id=item.id;root.hidden=false;
  }
  async function poll(){
    if(!identity||busy)return;
    const epoch=generation;busy=true;
    try{const result=await client.request('/api/announcements');if(epoch===generation)render(result.items??[]);}
    catch{if(epoch===generation)hide();}
    finally{if(epoch===generation)busy=false;}
  }
  async function read(){
    const id=dismiss.dataset.id;if(!identity||busy||!/^[a-f0-9-]{36}$/.test(id??''))return;
    const epoch=generation;busy=true;dismiss.disabled=true;
    try{await client.request(`/api/announcements/${id}/read`,{method:'POST',data:{}});if(epoch===generation){hide();busy=false;await poll();}}
    catch{if(epoch===generation)dismiss.disabled=false;}
    finally{if(epoch===generation)busy=false;}
  }
  dismiss.addEventListener('click',()=>void read());
  return Object.freeze({
    context(next){if(identity===next)return;generation++;identity=next;busy=false;hide();if(identity)void poll();},
    poll,
    reset(){generation++;identity=null;busy=false;hide();}
  });
}
