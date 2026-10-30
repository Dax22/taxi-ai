import { el, link, panel, table, detailsList, filterForm, date, badge, empty } from './ui.mjs';
import { actionForm } from './forms.mjs';

const kinds = {
  tracking_gap_after_arrival: 'Location sharing gap after arrival',
  cancelled_after_arrival: 'Cancellation after arrival',
};

export function rideIntegrity(data, route) {
  const body=el('div');
  body.append(el('p',data.notice,'definition-note'));
  body.append(filterForm(route,[{name:'state',label:'Review status',options:[['open','Open'],['reviewed','Reviewed'],['dismissed','Dismissed'],['all','All observations']]}]));
  const queue=panel('Ride-integrity observations','Signals are preliminary. Network loss is not proof that the driver switched off data deliberately.');
  if(!data.items.length) queue.append(empty('No matching observations','The monitor has not recorded any observations for this filter.'));
  else queue.append(table(['Observed','Ride','Driver','Signal','Review'],data.items.map(item=>[
    date(item.observedAt),link(item.rideId.slice(0,8),'/admin/transactions/ride/'+item.rideId),
    link(item.driverId.slice(0,8),'/admin/people/'+item.driverId),
    link(kinds[item.kind]??item.kind,'/admin/ride-integrity/'+item.id),badge(item.reviewStatus)])));
  if(data.nextBefore){const q=new URLSearchParams(route.query);q.set('before',data.nextBefore);queue.append(link('Older observations','/admin/ride-integrity?'+q,'button secondary'));}
  body.append(queue);return body;
}

export function rideIntegrityDetail(data,route,staff) {
  const s=data.signal,body=el('div');
  body.append(link('← Ride integrity queue','/admin/ride-integrity','text-link'));
  const card=panel(kinds[s.kind]??s.kind,'This does not establish an off-platform trip or misconduct.');
  card.append(detailsList([['Ride',link(s.rideId,'/admin/transactions/ride/'+s.rideId)],
    ['Driver',link(s.driverId,'/admin/people/'+s.driverId)],
    ['Recorded arrival',date(s.arrivedAt)],['Observation',date(s.observedAt)],
    ['Last shared GPS update',s.lastLocationAt==null?'Not part of this observation':date(s.lastLocationAt)],
    ['Cancellation initiated by',s.cancellationActorId??'Not applicable'],['Cancellation reason',s.cancellationReason??'Not applicable'],
    ['Review status',s.reviewStatus],['Review version',s.version],['Review note',s.reviewNote??'Not reviewed'],
    ['Reviewed by',s.reviewedBy??'—'],['Reviewed at',s.reviewedAt?date(s.reviewedAt):'—']]));
  body.append(card,el('p',data.notice,'definition-note'));
  if(staff?.permissions?.includes('moderation.manage'))body.append(actionForm({
    title:'Record a human review',action:'/api/admin/console/ride-integrity/'+s.id+'/review',
    data:{expectedVersion:s.version},submit:'Save review',fields:[
      {name:'state',label:'Review outcome',options:[['reviewed','Reviewed — follow up separately if needed'],['dismissed','Dismissed — legitimate/insufficient evidence'],['open','Reopen for review']].filter(([state])=>state!==s.reviewStatus)},
      {name:'note',label:'Evidence and reasoning (internal only)',min:10,max:500,multiline:true},
    ]}));
  return body;
}
