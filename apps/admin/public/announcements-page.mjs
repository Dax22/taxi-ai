import { el, panel, badge, table, empty, date } from './ui.mjs';
import { actionForm, reasonField } from './forms.mjs';

const audienceLabel = {all:'All users',customers:'Customers',drivers:'Drivers / delivery workers',eats_sellers:'Eats sellers'};
export function announcements(data) {
  const fragment=el('div');
  const composer=panel('Create announcement','Save a draft first. Publishing is a separate confirmed staff action.');
  composer.append(actionForm({title:'New broadcast',action:'/api/admin/console/announcements',submit:'Save draft',fields:[
    {name:'title',label:'Title',min:2,max:80,placeholder:'Scheduled maintenance'},
    {name:'body',label:'Message',min:2,max:500,multiline:true,placeholder:'Tell users what is changing and what they need to know.'},
    {name:'audience',label:'Audience',options:data.audiences.map(item=>[item.id,item.label])},
    {name:'priority',label:'Priority',options:data.priorities.map(item=>[item.id,item.label])},
    {name:'expiresInHours',label:'Keep visible for',options:[['24','24 hours'],['72','3 days'],['168','7 days'],['720','30 days']]},
  ]}));
  composer.append(el('p',data.pushEnabled
    ? 'Publishing stores the announcement in Taxi Ai and also queues phone alerts for users who have opted into push notifications.'
    : 'Publishing stores the announcement in Taxi Ai. Phone alerts are currently disabled on this server, so users will see it in-app only.','definition-note'));
  fragment.append(composer);

  const box=panel('Announcement history','Newest drafts and broadcasts first. Cancelling removes an active announcement from user feeds and stops pending phone alerts.');
  if(!data.items.length)box.append(empty('No announcements yet','Save a draft above when Taxi Ai needs to communicate with users.'));
  else box.append(table(['Announcement','Audience','Priority','Status','Timing','Action'],data.items.map(item=>{
    const copy=el('div');copy.append(el('strong',item.title),el('span',item.body,'subtext'));
    const timing=el('div');timing.append(el('span',(item.publishedAt?'Published ':'Drafted ')+date(item.publishedAt??item.createdAt)),el('span','Expires '+date(item.expiresAt),'subtext'));
    let action='—';
    if(item.status==='draft')action=actionForm({title:'Publish draft',action:'/api/admin/console/announcements/'+item.id+'/publish',submit:'Publish now',
      data:{expectedVersion:item.version},fields:[{...reasonField,label:'Publishing reason / reference'}]});
    else if(item.status==='published')action=actionForm({title:'Stop broadcast',action:'/api/admin/console/announcements/'+item.id+'/cancel',submit:'Cancel announcement',
      data:{expectedVersion:item.version},danger:true,fields:[{...reasonField,label:'Cancellation reason'}]});
    return [copy,audienceLabel[item.audience]??item.audience,badge(item.priority),badge(item.status),timing,action];
  }),'Announcements · staff-authored content'));
  fragment.append(box,el('p','Broadcasts are operational communications, not emergency dispatch. Push delivery is best-effort; the in-app record remains the source of truth while the announcement is active.','definition-note'));
  return fragment;
}
