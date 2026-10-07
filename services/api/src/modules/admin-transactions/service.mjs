import { check } from '../../shared/errors.mjs';
import { fields } from '../../shared/validation.mjs';
import { filters, recordId, cursor, project, summarize, csv, KINDS, CLOSED } from './domain.mjs';

const parse = text => text ? JSON.parse(text) : null;
const pick = (value, keys) => Object.fromEntries(keys.filter(k => value?.[k] !== undefined).map(k => [k,value[k]]));
export function createAdminTransactionsService({ repository, requirePermission, audit, unitOfWork, clock,
  locationFor = async () => null, deliveryStateFor = () => null, mapSettings = () => ({enabled:false,tiles:null}), restrictionScopes = async () => [], isStoreRestricted = async () => false, driverProfile = async () => null }) {
  const withStaff = (user,permission,run) => unitOfWork(async()=>{await requirePermission(user.id,permission);return {...await run(clock()),viewerId:user.id,asOf:clock()};});
  async function report(query,now) {
    const filter=filters(query,now), rows=await repository.list(filter,now), items=rows.slice(0,filter.limit).map(project);
    return { items,nextBefore:rows.length>filter.limit?cursor(rows[filter.limit-1]):null,
      summary:await summarize(repository.facts({...filter,before:null},now)),
      filters:query,timeZone:'Africa/Lagos',basis:'creation date; status is current at observation time' };
  }
  async function detail(kind,id,now) {
    check(KINDS.includes(kind),'INVALID_INPUT','Invalid service.'); recordId(id);
    const row=await repository.one(kind,id,now);check(row,'NOT_FOUND','Transaction not found.');
    const extra=await repository.details(kind,id), item=project(row), vehicle=parse(extra?.vehicleJson);
    let timeline=[], contents=[], recipient=null, fareEvents=[];
    if(kind==='food') {
      const snapshot=parse(extra.snapshotJson) || {};
      contents=(snapshot.lines || []).map(line=>pick(line,['itemId','name','quantity','priceKobo','unitPriceKobo','totalKobo','allergens']));
      recipient=pick(snapshot.recipient,['kind','name']);
      item.destination=snapshot.address?.line || item.destination;
      item.fulfillment=snapshot.fulfillment || 'delivery';
      item.totals=pick(snapshot.totals,['subtotalKobo','deliveryFeeKobo','totalKobo','currency']);
      timeline=(parse(extra.eventsJson) || []).map(event=>({type:event.status,createdAt:event.at,reason:event.reason || null,actorName:null}));
    } else {
      timeline=await repository.timeline(id); const delivery=parse(extra.deliveryJson);
      contents=delivery?[pick(delivery,['description','weightKg','quantity'])]:[];
      recipient=delivery?{kind:'recipient',name:delivery.recipientName || null}:extra.passengerName?{kind:'guest_passenger',name:extra.passengerName}:{kind:'self',name:item.customer.name};
      fareEvents=(await repository.fares(id)).map(event=>({version:event.version,type:event.type,...pick(parse(event.payload),['amountKobo','proposedBy','offerId','expiresAt'])}));
      item.times=pick(extra,['bookedAt','departedAt','arrivedAt','startedAt','completedAt']);
    }
    const group=kind==='food'?await repository.checkout(id,now):null;
    const checkout=group?{id:group.id,orders:group.orders.map(project),amountKobo:String(group.orders.reduce((sum,row)=>sum+BigInt(row.amountKobo||0),0n))}:null;
    return { item,contents,recipient,checkout,vehicle:pick(vehicle?.vehicle || vehicle,['make','model','modelName','plate','colour','category','year']),timeline,fareEvents,
      deliveryState:kind==='courier'?deliveryStateFor(await repository.deliveryEvents(id),item.status):null,
      calls:kind==='food'?[]:await repository.calls(id),
      proofOfDelivery:kind==='courier'?await repository.deliveryEvidence(id):null,
      deliveryEvents:kind==='courier'?await repository.deliveryEvents(id):[],
      evidenceNotice:'Only recorded handover evidence is shown. No photograph, signature, audio recording or historical route is invented.',
      paymentNotice:'A source order amount is not a charge. Combined food checkout payments are linked by target ID and not counted again for each kitchen.' };
  }
  return Object.freeze({
    list:(user,query)=>withStaff(user,'transactions.read',now=>report(query,now)),
    detail:(user,kind,id)=>withStaff(user,'transactions.read',async now=>{
      const result=await detail(kind,id,now);await audit.record(user.id,'admin.transaction_viewed',id,now);return result;
    }),
    export:(user,query)=>withStaff(user,'transactions.export',async now=>{
      const filter=filters(query,now);check(!filter.before,'INVALID_INPUT','Export the full filtered cohort, not a page cursor.');
      const items=[]; for await (const row of repository.facts(filter,now)) {check(items.length<10000,'EXPORT_TOO_LARGE','Narrow the filters to at most 10,000 transactions. No partial export was created.');items.push(project(row));}
      await repository.recordAccess(user.id,'transactions.export','cohort',JSON.stringify(query),now);
      return {csv:csv(items),filename:'taxi-ai-transactions-'+new Date(now).toISOString().slice(0,10)+'.csv',rowCount:items.length,truncated:false,filters:query,generatedAt:now,timeZone:'Africa/Lagos'};
    }),
    people:(user,query={})=>withStaff(user,'people.read',async()=>{
      fields(query,['q','before','limit','type'],[]);const q=(query.q||'').trim().toLowerCase(),limit=Number(query.limit||25);check(q.length<=100&&Number.isInteger(limit)&&limit>0&&limit<=100,'INVALID_INPUT','Invalid directory filters.');
      const type=query.type||'all';check(['all','customer','driver','vendor'].includes(type),'INVALID_INPUT','Invalid account type.');
      const before=query.before?recordId(query.before):null,rows=await repository.profiles(q,before,limit,type);
      return {items:await Promise.all(rows.slice(0,limit).map(async({email,...row})=>({...row,email:email.replace(/^(.).*(@.*)$/,'$1***$2'),restrictedScopes:await restrictionScopes(row.id)}))),nextBefore:rows.length>limit?rows[limit-1].id:null};
    }),
    person:(user,id,query={})=>withStaff(user,'people.read',async now=>{
      recordId(id);const account=await repository.profile(id);check(account,'NOT_FOUND','Account not found.');
      account.restrictedScopes=await restrictionScopes(id);
      const driver=await driverProfile(id);await audit.record(user.id,'admin.person_viewed',id,now);
      const transactions=await report({...query,accountId:id},now);
      const lifetime=await summarize(repository.facts(filters({accountId:id},now),now));
      const participation={};
      for(const role of ['customer','worker','vendor'])participation[role]=await summarize(repository.facts(filters({accountId:id,participation:role},now),now));
      return {account,driver:driver?pick(driver,['status','vehicle','eligibility']):null,transactions,lifetime,participation};
    }),
    stores:(user,query={})=>withStaff(user,'businesses.read',async()=>{
      fields(query,['q','before','limit'],[]);const q=(query.q||'').trim().toLowerCase(),limit=Number(query.limit||25);check(q.length<=100&&Number.isInteger(limit)&&limit>0&&limit<=100,'INVALID_INPUT','Invalid store filters.');
      const rows=await repository.stores(q,query.before?recordId(query.before):null,limit);
      return {items:await Promise.all(rows.slice(0,limit).map(async row=>({...row,restricted:await isStoreRestricted(row.id)}))),nextBefore:rows.length>limit?rows[limit-1].id:null};
    }),
    store:(user,id,query={})=>withStaff(user,'businesses.read',async now=>{
      recordId(id);const row=await repository.store(id);check(row,'NOT_FOUND','Store not found.');const profile=parse(row.detailsJson);
      await audit.record(user.id,'admin.business_viewed',id,now);
      return {store:{restricted:await isStoreRestricted(id),...pick(row,['id','status','version','isOpen','createdAt','updatedAt']),...pick(profile,['name','sellerType','areaId','cuisine','description','prepMinutes','deliveryEnabled','pickupEnabled'])},
        menu:await repository.menu(id),transactions:await report({...query,storeId:id},now),privateAddressHidden:true};
    }),
    location:(user,kind,id,purpose)=>withStaff(user,'operations.location',async now=>{
      check(['delivery_support','safety_review','lost_contact'].includes(purpose),'INVALID_INPUT','Choose a recorded access purpose.');
      const row=await repository.one(kind,recordId(id),now);check(row&&KINDS.includes(kind),'NOT_FOUND','Transaction not found.');
      await repository.recordAccess(user.id,'transaction.location',id,purpose,now);
      const reported=CLOSED.includes(row.status)?null:await locationFor(kind,id);
      const position=reported?{...reported,stale:reported.stale===true||!Number.isFinite(reported.capturedAt)||now-reported.capturedAt>=30000}:null;
      return {item:project(row),position:position?pick(position,['lat','lng','accuracy','capturedAt','source','stale']):null,
        status:!position?'unavailable':position.stale?'stale':'fresh',historyAvailable:false,map:pick(mapSettings(),['enabled','tiles']),
        notice:'Latest device-reported position only. Refresh to observe changes. No historical route is recorded by this view.'};
    }),
    diagnosis:(user,kind,id)=>withStaff(user,'operations.read',async now=>{
      const row=await repository.one(kind,recordId(id),now);check(row,'NOT_FOUND','Transaction not found.');
      return {item:project(row),offers:kind==='food'?[]:await repository.dispatch(id,now),
        explanation:row.status==='requested'?'Request is waiting. Offer history below is evidence, not a count of currently eligible nearby drivers.':`Recorded transaction stage: ${row.status}.`,
        unknowns:['Current nearby eligible-driver count is not established by this report.','Missing offer rows alone do not prove a matching failure.'],automatedActionTaken:false};
    }),
  });
}
