import { el, link, panel, cards, table, filterForm, detailsList, date, count, money } from './ui.mjs';
import { actionForm } from './forms.mjs';

export function insights(data,route){
 const body=el('div');body.append(filterForm(route,[{name:'service',label:'Service',options:[['all','All services'],['ride','Rides'],['courier','Courier'],['food','Food']]},{name:'from',label:'From (WAT)',type:'date'},{name:'to',label:'Through (WAT)',type:'date'}]));
 body.append(cards([['Transactions',count(data.summary.total),'Full filtered cohort',true],['Completed',count(data.summary.groups.reduce((n,g)=>n+g.completed,0)),'Rides complete / food delivered'],['Active',count(data.summary.groups.reduce((n,g)=>n+g.active,0)),'At last refresh']]));
 body.append(table(['Service','Payment mode','Transactions','Completed','Cancelled / rejected / expired','Active','Source amounts','Missing amounts'],data.summary.groups.map(g=>[g.service,g.paymentMode,g.transactions,g.completed,g.cancelled,g.active,money(g.amountKobo),g.unknownAmounts]),'No payment modes are combined into one revenue total.'),el('p',data.summary.basis,'definition-note'),el('p',data.cohort,'definition-note'));return body;
}
export function brief(data){
 const body=el('div'),box=panel('Operational briefing',data.method);for(const finding of data.findings){const p=el('p');p.append(el('span',finding.text+' '),link('Inspect records',finding.href));box.append(p);}body.append(box);
 const observations=panel('Supporting observations');observations.append(detailsList([['Fresh GPS availability records',data.observations.freshAvailabilityRecords],['Overdue review tasks',data.observations.overdueReviews]]),table(['Food stage unchanged for 30 minutes','Count'],data.observations.foodStageAlerts.map(a=>[a.status,a.count])));body.append(observations);for(const note of data.limitations)body.append(el('p',note,'definition-note'));return body;
}
export function platform(data){
 const box=panel('Platform configuration and acceptance status',data.notice);
 box.append(detailsList([['Application database query',data.database.reachable?'Reachable':'Unavailable'],['Map mode',data.configuration.maps],['Calling mode',data.configuration.calls],['Payments',data.configuration.payments],['Account email enabled',data.configuration.accountEmail?'Yes':'No'],['Push enabled',data.configuration.push?'Yes':'No'],['Staff MFA configuration available',data.configuration.staffMfaConfigured?'Yes':'No'],['Passenger requests paused',data.configuration.passengerRides?.paused?'Yes':'No'],['Passenger coverage',data.configuration.passengerRides?.coverage||'Not recorded'],['External provider connectivity checks',data.externalProviderTests],['Latest phone audio acceptance test',data.lastPhoneCallTest||'Not recorded'],['Latest complete delivery acceptance test',data.lastEndToEndDeliveryTest||'Not recorded']]));return box;
}
export function savedReports(data){
 const body=el('div'),box=panel('Saved report definitions',data.notice);
 for(const item of data.items){const row=panel(item.title,`Created ${date(item.createdAt)}`);row.append(link('Run report with fresh records','/admin/transactions?'+new URLSearchParams(item.filters),'button secondary'),actionForm({title:'Remove this saved definition',action:'/api/admin/console/reports/'+item.id+'/remove',data:{expectedVersion:item.version},submit:'Remove definition',danger:true}));box.append(row);}body.append(box);
 body.append(actionForm({title:'Save a reusable report',action:'/api/admin/console/reports',submit:'Save filters',fields:[{name:'title',label:'Report title',min:3,max:120},{name:'service',label:'Service',options:[['all','All services'],['ride','Rides'],['courier','Courier'],['food','Food']]},{name:'status',label:'Status',options:['all','active','completed','delivered','cancelled','expired'].map(s=>[s,s])},{name:'from',label:'From (WAT), or leave both dates empty',type:'date',required:false},{name:'to',label:'Through (WAT)',type:'date',required:false}]}));return body;
}
export function campaigns(data){
 const body=el('div'),box=panel('Promotion planning',data.notice);
 box.append(table(['Draft','Service','Budget','Discount','Status','Note'],data.items.map(i=>[i.title,i.service,money(i.budgetKobo),money(i.discountKobo),i.status,i.note])));
 for(const item of data.items.filter(i=>i.status==='draft'))box.append(actionForm({title:'Archive '+item.title,action:'/api/admin/console/campaigns/'+item.id+'/archive',data:{expectedVersion:item.version},submit:'Archive draft'}));body.append(box);
 body.append(actionForm({title:'Create a draft — no customer discount is activated',action:'/api/admin/console/campaigns',submit:'Save planning draft',fields:[{name:'title',label:'Title',min:3,max:120},{name:'service',label:'Service',options:['ride','courier','food'].map(s=>[s,s])},{name:'budgetKobo',label:'Budget in whole kobo',type:'number'},{name:'discountKobo',label:'Per-use discount in whole kobo',type:'number'},{name:'note',label:'Planning notes',min:10,max:1000,multiline:true}]}));return body;
}
export function accessAudit(data,route){
 const box=panel('Sensitive operational access','Audited location-purpose and export events. Existing staff and domain audit records remain in Staff activity.');
 box.append(table(['Action','Actor ID','Subject ID','Purpose / filters','Time'],data.items.map(i=>[i.action,i.actorId,i.subjectId,i.detail,date(i.createdAt)])));
 if(data.nextBefore){const q=new URLSearchParams(route.query);q.set('before',data.nextBefore);box.append(link('Older access events',route.path+'?'+q,'button secondary'));}return box;
}
