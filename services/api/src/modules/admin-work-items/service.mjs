import { check } from '../../shared/errors.mjs';
import { createInput, updateInput, filters, id, key, PERMISSION, TERMINAL } from './domain.mjs';

export function createAdminWorkService({repository,requirePermission,listEligible,unitOfWork,tokens,audit,clock}) {
 const authorize=async(user,category)=>{await requirePermission(user.id,'work.manage');await requirePermission(user.id,PERMISSION[category]);};
 const stamp=user=>({viewerId:user.id,asOf:clock(),notice:'Operational review records only. Closing a review does not change a delivery, refund money, reassign a driver, suspend an account, or contact emergency services.'});
 async function read(user,recordId) {
  const item=await repository.find(id(recordId));check(item,'NOT_FOUND','Work item not found.');
  await authorize(user,item.category);
  return {...stamp(user),item,events:await repository.events(item.id),assignees:await listEligible(PERMISSION[item.category])};
 }
 async function save(user,commandKey,fingerprint,run) {
  key(commandKey);return unitOfWork(async()=>{
   await requirePermission(user.id,'work.manage');
   const previous=await repository.command(user.id,commandKey);
   if(previous){check(previous.fingerprint===fingerprint,'KEY_REUSED','This action key belongs to a different request.');const result=JSON.parse(previous.resultJson);return {...await read(user,result.id),replayed:true};}
   const recordId=await run();await repository.saveCommand(user.id,commandKey,fingerprint,{id:recordId},clock());
   return {...await read(user,recordId),replayed:false};
  });
 }
 return Object.freeze({
  verifyAccess: authorize,
  list:(user,input)=>unitOfWork(async()=>{
   const staff=await requirePermission(user.id,'work.manage');
   const defaultCategory=Object.keys(PERMISSION).find(category=>staff.permissions.includes(PERMISSION[category]));
   const f=filters({...input,category:input.category||defaultCategory});await authorize(user,f.category);const rows=await repository.list(f);
   return {...stamp(user),items:rows.slice(0,f.limit),nextBefore:rows.length>f.limit?rows[f.limit-1].id:null,counts:await repository.counts(f.category,clock()),category:f.category,filters:input};
  }),
  detail:(user,recordId)=>unitOfWork(()=>read(user,recordId)),
  create:(user,data,commandKey)=>{
   const input=createInput(data,clock()), fingerprint=tokens.digest(JSON.stringify(['work.create',{...input,dueAt:undefined}]));
   return save(user,commandKey,fingerprint,async()=>{
    await authorize(user,input.category);check(await repository.exists(input.entityType,input.entityId),'NOT_FOUND','Linked record not found.');
    const now=clock(),recordId=tokens.id();await repository.insert({...input,id:recordId,createdBy:user.id,createdAt:now});
    await repository.event({id:tokens.id(),workId:recordId,actorId:user.id,action:'created',body:input.description,createdAt:now});
    await audit.record(user.id,'admin.work_created',recordId,now);return recordId;
   });
  },
  update:(user,recordId,data,commandKey)=>{
   id(recordId);const input=updateInput(data),fingerprint=tokens.digest(JSON.stringify(['work.update',recordId,input]));
   return save(user,commandKey,fingerprint,async()=>{
    const {item,events}=await read(user,recordId),now=clock();check(item.version===input.expectedVersion,'STALE_VERSION','This work item changed. Refresh before editing.');
    check(events.length<200,'INVALID_INPUT','This case has reached its event limit; open a linked follow-up.');
    if(input.action==='assign'){
     if(input.assigneeId){await requirePermission(input.assigneeId,'work.manage');await requirePermission(input.assigneeId,PERMISSION[item.category]);}
     item.assigneeId=input.assigneeId;
    }
    if(input.action==='status'){
     if(TERMINAL.includes(item.status))check(input.status==='open','INVALID_INPUT','Reopen the review before changing it.');
     if(input.status==='open'&&TERMINAL.includes(item.status)){item.dueAt=now+86400000;item.resolvedAt=null;item.firstRespondedAt=null;}
     else if(input.status!=='open')item.firstRespondedAt??=now;
     if(TERMINAL.includes(input.status))item.resolvedAt=now;
     item.status=input.status;
    }
    item.updatedAt=now;check(await repository.update(item,input.expectedVersion),'STALE_VERSION','The record changed concurrently.');
    await repository.event({id:tokens.id(),workId:recordId,actorId:user.id,action:input.action,body:input.action==='status'?`Status: ${item.status}. ${input.note}`:input.action==='assign'?`Assignee: ${item.assigneeId||'unassigned'}. ${input.note}`:input.note,createdAt:now});
    await audit.record(user.id,'admin.work_'+input.action,recordId,now);return recordId;
   });
  },
 });
}
