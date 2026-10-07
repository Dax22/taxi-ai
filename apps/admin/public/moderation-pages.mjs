import { el, link, panel, table, detailsList, filterForm, date } from './ui.mjs';
import { actionForm } from './forms.mjs';

const scopeLabels={customer:'Customer bookings and orders',driver:'Driving and courier work',vendor:'Vendor ordering',vehicle:'Registered-vehicle work',account:'All new services + end existing sessions (no active jobs)',store:'This store only'};
const stamp=time=>new Date(time+3600000).toISOString().slice(0,16);
const subjectLink=(type,id)=>'/admin/'+(type==='store'?'businesses':'people')+'/'+id;
export function restrictions(data,route){
 const body=el('div'),get={...route,path:'/admin/restriction-impact',query:route.query};
 body.append(filterForm(get,[{name:'subjectType',label:'Review restriction impact for',options:[['account','Account'],['store','Store']]},{name:'subjectId',label:'Account or store ID',type:'search'}]));
 const box=panel('Restrictions and warnings','Only scopes permitted for your staff role are returned. Expiry is evaluated at the current time.');
 box.append(table(['Record','Subject','Scope','Kind','State','Review due','Expiry'],data.items.map(r=>[link(r.id.slice(0,8).toUpperCase(),'/admin/restrictions/'+r.id),link(r.subjectId.slice(0,8),subjectLink(r.subjectType,r.subjectId)),scopeLabels[r.scope],r.kind,r.status,date(r.reviewAt),r.expiresAt?date(r.expiresAt):'Manual review'])));
 if(data.nextBefore){const q=new URLSearchParams(route.query);q.set('before',data.nextBefore);box.append(link('Older records','/admin/restrictions?'+q,'button secondary'));}body.append(box);return body;
}
export function restrictionImpact(data){
 const body=el('div'),box=panel('Review the effect before applying',data.subject.name||data.subject.id);
 box.append(detailsList([['Subject type',data.subjectType],['Subject ID',data.subject.id],['Active rides / parcels',data.impact.activeJourneys],['Active food orders',data.impact.activeFoodOrders]]),el('p',data.impact.policy,'definition-note'),link('Open participant history',subjectLink(data.subjectType,data.subject.id)));body.append(box);
 const scopes=data.allowedScopes.filter(s=>s!=='account'||data.impact.total===0);
 body.append(actionForm({title:'Issue warning or suspend new service activity',action:'/api/admin/console/restrictions',submit:'Apply reviewed restriction',danger:true,
  data:{subjectType:data.subjectType,subjectId:data.subject.id},fields:[
   {name:'scope',label:'Affected capability',options:scopes.map(s=>[s,scopeLabels[s]])},
   {name:'kind',label:'Action',options:[['warning','Warning only — no service blocked'],['suspension','Suspend new activity in the selected scope']]},
   {name:'reasonCode',label:'Reason category',options:['safety','fraud_review','conduct','documents','service_quality','security','other'].map(s=>[s,s.replaceAll('_',' ')])},
   {name:'reason',label:'Internal explanation',min:10,max:1000,multiline:true},
   {name:'notice',label:'Notice shown to the affected person',min:10,max:500,multiline:true},
   {name:'caseReference',label:'Case or evidence reference',min:3,max:160},
   {name:'reviewAt',label:'Required review (Nigeria time), within 30 days',type:'datetime-local',convert:'wat',value:stamp(data.asOf+86400000)},
   {name:'expiresAt',label:'Optional automatic expiry (Nigeria time)',type:'datetime-local',convert:'wat',required:false},
   {name:'confirmation',label:'Type CONFIRM after reviewing active work',min:7,max:7},
  ]}));
 body.append(el('p','A warning does not block service. Scoped suspension preserves existing job support and fulfilment. All-services suspension is refused while active work exists. Reinstatement never approves documents or changes earnings.','definition-note'));
 return body;
}
export function restrictionDetail(data){
 const body=el('div'),r=data.restriction,box=panel('Restriction record',r.id);
 box.append(detailsList([['Subject',link(data.subject.name||r.subjectId,subjectLink(r.subjectType,r.subjectId))],['Scope',scopeLabels[r.scope]],['Kind',r.kind],['State',r.status],['Version',r.version],['Reason category',r.reasonCode],['Internal explanation',r.privateReason],['Account notice',r.notice],['Case reference',r.caseReference],['Review due',date(r.reviewAt)],['Expiry',r.expiresAt?date(r.expiresAt):'Manual review']]));body.append(box);
 const events=panel('Moderation audit trail');events.append(table(['Action','Recorded by','Time','Details'],data.events.map(e=>[e.kind,e.actorId,date(e.createdAt),JSON.stringify(e.detail)])));body.append(events);
 if(r.status==='active')body.append(actionForm({title:'Reinstate this capability',action:'/api/admin/console/restrictions/'+r.id+'/lift',data:{expectedVersion:r.version},submit:'Reinstate',fields:[{name:'reason',label:'Reason for reinstatement',min:10,max:1000,multiline:true},{name:'confirmation',label:'Type REINSTATE',min:9,max:9}]}));
 if(data.appeal){const a=data.appeal,appeal=panel('Account appeal',a.body);appeal.append(detailsList([['Status',a.status],['Submitted',date(a.createdAt)],['Decision',a.decisionNote||'Awaiting review']]));
  if(a.status==='submitted')appeal.append(actionForm({title:'Record appeal decision',action:'/api/admin/console/restrictions/'+r.id+'/appeal-decision',data:{expectedVersion:a.version,restrictionVersion:r.version},submit:'Record decision',fields:[{name:'decision',label:'Outcome',options:[['upheld','Uphold restriction'],['overturned','Overturn and reinstate this restriction']]},{name:'note',label:'Decision explanation shown to the appellant',min:10,max:1000,multiline:true}]}));body.append(appeal);
 }else body.append(el('p','No appeal has been submitted.'));
 body.append(el('p',data.notice,'definition-note'));return body;
}
